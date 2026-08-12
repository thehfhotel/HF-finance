import { extname } from 'node:path';
import type { KbizPaymentIntent } from '@reimbursement/shared';
import { prisma } from './db';
import {
  KBIZ_POLL_MS,
  KBIZ_STALE_MS,
  archiveQueueFile,
  describeKbizQueue,
  inspectKbizQueue,
  listQueueFiles,
  readIntentState,
  readQueueFile,
  slipSourcePath,
  withdrawQueuedIntent,
  type KbizIntentState,
} from './kbiz';
import { sumReceiptAmounts } from './money';
import { notifyPortal, notifySlack } from './notify';
import { saveUploadedBytes } from './uploads';

/**
 * The slip-return half of the KBIZ pipeline: a loop that reads results out of
 * the shared queue directory and settles the bundles they belong to.
 *
 * Pull, not push (ADR 0001, decision 6). This app already has to mount the
 * shared dir in order to WRITE intents, so reading the bot's results back out
 * of the very same files adds no ingress, no token and no endpoint that could
 * be called by anything other than the bot.
 *
 * Three rules hold everything together:
 *
 *  1. **The bundle is the source of truth, not the file.** A result is only
 *     applied to a bundle that is still `PAYING` and still carries this intent
 *     id. Anything else — a human already resolved it, a stale file, a retry —
 *     is archived without touching the database.
 *  2. **Commit, then archive.** The file moves to `queue/archive/` only after
 *     the transaction succeeds. A crash in between re-reads the same file next
 *     sweep and finds a bundle that is no longer PAYING, which is a no-op.
 *  3. **Ambiguity is never resolved here.** An `unconfirmed` outcome leaves the
 *     bundle PAYING with `paymentError` set and alerts a human. This loop can
 *     mark a payment PAID and can release a confirmed failure, but it can never
 *     decide that a transfer it could not see probably went through.
 *
 * The same loop also runs a watchdog over bundles nobody ever reports on — see
 * `sweepStranded`. Silence is the one outcome a result-driven reconciler cannot
 * see, and it is exactly what a dead bot leaves behind.
 */

/** Queue states that mean the bot has stopped working on an intent. */
const TERMINAL_STATUSES: ReadonlySet<string> = new Set(['done', 'failed', 'needs-review']);

type KbizOutcome = 'success' | 'confirmed-failed' | 'unconfirmed';

/**
 * Is this queue file ours to act on?
 *
 * The directory is shared with the payroll stack, so most files in it belong to
 * somebody else and must be left exactly where they are. A file that fails this
 * check is never read again, never archived, never touched — including a file
 * that is simply mid-write and parsed as garbage.
 */
function isOurTerminalIntent(value: unknown): value is KbizPaymentIntent {
  if (typeof value !== 'object' || value === null) return false;
  const intent = value as Partial<KbizPaymentIntent>;
  return (
    intent.app === 'reimbursement' &&
    intent.type === 'transfer-other' &&
    typeof intent.id === 'string' &&
    intent.id.length > 0 &&
    typeof intent.status === 'string' &&
    TERMINAL_STATUSES.has(intent.status)
  );
}

/**
 * What actually happened, erring towards "a human should look at this".
 *
 * The bot classifies its own attempts; when it did not (a crash before it could
 * write `result`), only the contract's `failed` — defined as "finished, nothing
 * moved" — is treated as safely retryable. Every other unclassified terminal
 * state is ambiguous by definition, and ambiguous means human.
 */
function classifyOutcome(intent: KbizPaymentIntent): KbizOutcome {
  const outcome = intent.result?.outcome;
  if (outcome === 'success' || outcome === 'confirmed-failed' || outcome === 'unconfirmed') {
    return outcome;
  }
  return intent.status === 'failed' ? 'confirmed-failed' : 'unconfirmed';
}

/**
 * Copy the bot's captured e-slip into this app's own uploads.
 *
 * Returns null — rather than throwing — for every recoverable problem: no slip,
 * an unsafe filename, a file that is not there. The money has already moved at
 * this point, so a missing proof image must not block the bundle from being
 * marked paid; it is logged and the approver can attach their own slip later.
 */
async function importSlip(intent: KbizPaymentIntent): Promise<string | null> {
  const slipFile = intent.result?.slipFile;
  if (!slipFile) return null;

  const source = slipSourcePath(slipFile);
  if (!source) {
    console.error(`[kbiz] refusing unsafe slip filename ${JSON.stringify(slipFile)} on ${intent.id}`);
    return null;
  }

  const file = Bun.file(source);
  if (!(await file.exists())) {
    console.error(`[kbiz] slip ${slipFile} for ${intent.id} is not in the shared dir`);
    return null;
  }

  return saveUploadedBytes(file, extname(source).toLowerCase());
}

function formatBaht(amount: number): string {
  return `฿${amount.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * The row this result is allowed to touch: still PAYING, still this intent.
 *
 * The bundle is read first and written a few awaits later — an approver can
 * resolve it by hand in between (a crash before `archiveQueueFile` means a
 * result IS re-reconciled on the next boot, against a bundle that by then
 * legitimately carries a `paymentError` and so has both human buttons live).
 * Repeating the check as the WHERE clause makes the write conditional instead
 * of merely late: a payment somebody already closed matches zero rows rather
 * than being re-flagged as unverified.
 */
function ownedBy(bundleId: string, intent: KbizPaymentIntent) {
  return { id: bundleId, status: 'PAYING' as const, paymentIntentId: intent.id };
}

/** Apply one terminal intent to its bundle, then archive the file. */
async function reconcile(fileName: string, intent: KbizPaymentIntent): Promise<void> {
  const bundle = await prisma.bundle.findUnique({
    where: { paymentIntentId: intent.id },
    include: { receipts: true },
  });

  // Nobody is waiting for this result: the bundle was resolved by hand,
  // released for a retry, or never existed. Archive it as evidence — but a
  // SUCCESS (or an ambiguous outcome) landing here is exactly the double-pay
  // scenario: an approver force-released the bundle while the bot was still
  // mid-transfer, the transfer went through anyway, and if this archives
  // silently the approver re-pays with nobody the wiser. So an orphaned
  // non-failure SHOUTS before it is filed away.
  if (!bundle || bundle.status !== 'PAYING') {
    const orphanOutcome = classifyOutcome(intent);
    if (orphanOutcome !== 'confirmed-failed') {
      const label = bundle ? `${bundle.name} (${bundle.status})` : `bundle ${intent.bundleId ?? '?'}`;
      const reference = intent.result?.reference?.trim();
      notifyPortal({
        title: 'ผลโอน KBIZ ตกค้าง — ตรวจสอบด่วน',
        body: `${label} — บอทรายงานผลหลังจากรายการถูกปิด/ปล่อยไปแล้ว ตรวจสอบว่าโอนซ้ำหรือไม่`,
        path: '/',
        tag: `kbiz-orphan-${intent.id}`,
        audience: 'managers',
      });
      notifySlack(
        `🚨 ผลโอน KBIZ ตกค้าง (${orphanOutcome}) — ${label}` +
          `${reference ? `\nอ้างอิง: ${reference}` : ''}\n` +
          `intent ${intent.id} จบหลังจากรายการถูกปิดหรือปล่อยคืนแล้ว — ` +
          `ตรวจสอบใน K BIZ ว่ามีการโอนซ้ำหรือไม่ก่อนจ่ายใหม่`,
      );
      console.error(
        `[kbiz] ORPHANED ${orphanOutcome} result on ${intent.id} — no PAYING bundle owns it; alerted managers`,
      );
    } else {
      console.log(`[kbiz] ${intent.id} has no bundle waiting on it — archiving`);
    }
    await archiveQueueFile(fileName);
    return;
  }

  const outcome = classifyOutcome(intent);
  const error = intent.result?.error?.trim() || null;

  if (outcome === 'success') {
    const transferProofPath = await importSlip(intent);
    const transferAmount = sumReceiptAmounts(bundle.receipts);
    // The bank's own reference when we have it; the intent id is the fallback
    // handle, so `transferRef` is never empty on a paid bundle.
    const transferRef = intent.result?.reference?.trim() || intent.id;

    const applied = await prisma.$transaction(async (tx) => {
      const settled = await tx.bundle.updateMany({
        where: ownedBy(bundle.id, intent),
        data: {
          status: 'PAID',
          paidAt: new Date(),
          transferRef,
          transferAmount,
          transferProofPath,
          paymentError: null,
          payingSince: null,
        },
      });
      if (settled.count === 0) return false;

      await tx.auditEvent.create({
        data: {
          type: 'pay',
          bundleId: bundle.id,
          // The approver who fired "จ่ายผ่าน KBIZ" owns this payment; the bot
          // acted on their behalf, and `via` records that it was not typed by
          // hand. Falling back to the submitter would be a lie, but a bundle
          // cannot reach PAYING without an approver.
          actorId: bundle.approvedById ?? bundle.userId,
          metadata: { via: 'kbiz-bot', intentId: intent.id, reference: transferRef },
        },
      });
      return true;
    });

    await archiveQueueFile(fileName);
    console.log(
      applied
        ? `[kbiz] ${bundle.id} paid via kbiz-bot (${transferRef})`
        : `[kbiz] ${bundle.id} was closed by hand before ${intent.id} landed — archived, nothing changed`,
    );
    return;
  }

  if (outcome === 'confirmed-failed') {
    // KBIZ errored before the transfer armed: nothing moved, so the bundle goes
    // back to APPROVED and can simply be paid again.
    const applied = await prisma.$transaction(async (tx) => {
      const released = await tx.bundle.updateMany({
        where: ownedBy(bundle.id, intent),
        data: {
          status: 'APPROVED',
          paymentIntentId: null,
          paymentError: error ?? 'KBIZ ปฏิเสธรายการนี้',
          payingSince: null,
        },
      });
      if (released.count === 0) return false;

      await tx.auditEvent.create({
        data: {
          type: 'payment-failed',
          bundleId: bundle.id,
          actorId: bundle.approvedById ?? bundle.userId,
          metadata: { via: 'kbiz-bot', intentId: intent.id, error },
        },
      });
      return true;
    });

    await archiveQueueFile(fileName);
    if (!applied) {
      console.log(`[kbiz] ${bundle.id} was closed by hand before ${intent.id} landed — archived, nothing changed`);
      return;
    }

    notifyPortal({
      title: 'การจ่ายไม่สำเร็จ',
      body: `${bundle.name} — ลองใหม่ได้`,
      path: '/',
      tag: `kbiz-fail-${bundle.id}`,
      audience: 'managers',
    });
    notifySlack(
      `❌ จ่ายผ่าน KBIZ ไม่สำเร็จ — ${bundle.name} (${formatBaht(
        sumReceiptAmounts(bundle.receipts),
      )})${error ? `\n${error}` : ''}\nคำขอกลับสู่สถานะอนุมัติแล้ว ลองจ่ายใหม่ได้`,
    );
    return;
  }

  // unconfirmed — the tap may have landed as the bot gave up. The bundle STAYS
  // PAYING, flagged for verification, and only a human moves it from here.
  //
  // The bot's screenshot of whatever KBIZ last showed is the best evidence the
  // human deciding "did money move?" can get from this side — import it into
  // our uploads (it does NOT become transferProofPath; the bundle is not paid)
  // and record where it landed in the audit trail + alert.
  const evidenceSlipPath = await importSlip(intent);
  const applied = await prisma.$transaction(async (tx) => {
    const flagged = await tx.bundle.updateMany({
      where: ownedBy(bundle.id, intent),
      data: { paymentError: error ?? 'ไม่ทราบผลการโอน กรุณาตรวจสอบใน K BIZ' },
    });
    if (flagged.count === 0) return false;

    await tx.auditEvent.create({
      data: {
        type: 'payment-unconfirmed',
        bundleId: bundle.id,
        actorId: bundle.approvedById ?? bundle.userId,
        metadata: {
          via: 'kbiz-bot',
          intentId: intent.id,
          error,
          finalUrl: intent.result?.finalUrl ?? null,
          evidenceSlipPath,
        },
      },
    });
    return true;
  });

  await archiveQueueFile(fileName);
  if (!applied) {
    console.log(`[kbiz] ${bundle.id} was closed by hand before ${intent.id} landed — archived, nothing changed`);
    return;
  }

  notifyPortal({
    title: 'การจ่ายต้องตรวจสอบ',
    body: `${bundle.name} — ตรวจสอบใน K BIZ แล้วยืนยันในระบบ`,
    path: '/',
    tag: `kbiz-review-${bundle.id}`,
    audience: 'managers',
  });
  notifySlack(
    `⚠️ การจ่ายผ่าน KBIZ ต้องตรวจสอบ — ${bundle.name} (${formatBaht(
      sumReceiptAmounts(bundle.receipts),
    )})${error ? `\n${error}` : ''}${
      evidenceSlipPath ? `\nภาพหน้าจอสุดท้ายจากบอท: ${evidenceSlipPath}` : ''
    }\nเปิด K BIZ เพื่อดูว่าโอนสำเร็จหรือไม่ แล้วแนบสลิป หรือกด "ยังไม่โอน" ในระบบ`,
  );
}

const STALE_MINUTES = Math.round(KBIZ_STALE_MS / 60_000);

/** Have we already shouted about this exact attempt? */
async function alreadyReported(bundleId: string, intentId: string | null): Promise<boolean> {
  const last = await prisma.auditEvent.findFirst({
    where: { type: 'payment-stale', bundleId },
    orderBy: { createdAt: 'desc' },
  });
  if (!last) return false;
  const metadata = last.metadata as unknown as { intentId?: string | null } | null;
  return (metadata?.intentId ?? null) === intentId;
}

/**
 * The outcome no result can report: none at all.
 *
 * Every other path out of PAYING starts from a terminal intent the bot wrote.
 * If the bot never runs (down, not deployed, mounting a different path), dies
 * mid-flight (ADR invariant 2 — such an item is never resumed), or this api
 * process is rolled between the atomic claim and the queue write, nothing is
 * ever written back. The bundle then sits in PAYING forever: the employee is
 * not paid and the approver has nothing to click. This is the loop that
 * notices.
 *
 * Two cases, decided by what the queue can prove — never by a guess:
 *
 *  - **Nothing was ever armed** (no intent file, or one kbiz-bot never picked
 *    up): the untouched file is withdrawn so it cannot be started later, and
 *    the bundle is flagged `paymentError`. That is the existing
 *    needs-verification state, so the approver's two buttons — attach the slip,
 *    or release and retry — light up on their own.
 *  - **The bot owns it and has gone quiet**: this only alerts. Flagging would
 *    offer "ยังไม่ได้โอน" for a transfer that might still be armed on somebody's
 *    phone, and inviting a second transfer is the one thing this pipeline must
 *    never do. A human resolves it with the override actions.
 */
async function sweepStranded(): Promise<void> {
  const stranded = await prisma.bundle.findMany({
    where: {
      status: 'PAYING',
      paymentError: null,
      payingSince: { lt: new Date(Date.now() - KBIZ_STALE_MS) },
    },
    include: { receipts: true },
  });

  for (const bundle of stranded) {
    const state: KbizIntentState = await readIntentState(bundle.paymentIntentId);
    // The queue is unreadable right now (mount gone): nothing can be proved, so
    // nothing is claimed. The next sweep tries again.
    if (state === 'unknown') continue;

    const idle =
      state === 'unqueued' ||
      (state === 'queued' &&
        bundle.paymentIntentId !== null &&
        (await withdrawQueuedIntent(bundle.paymentIntentId)));

    const total = formatBaht(sumReceiptAmounts(bundle.receipts));

    if (!idle) {
      if (await alreadyReported(bundle.id, bundle.paymentIntentId)) continue;

      await prisma.auditEvent.create({
        data: {
          type: 'payment-stale',
          bundleId: bundle.id,
          actorId: bundle.approvedById ?? bundle.userId,
          metadata: { via: 'kbiz-poller', intentId: bundle.paymentIntentId, intentState: state, flagged: false },
        },
      });

      notifyPortal({
        title: 'การจ่ายค้างนาน',
        body: `${bundle.name} — ยังไม่มีผลจาก K BIZ`,
        path: '/',
        tag: `kbiz-stale-${bundle.id}`,
        audience: 'managers',
      });
      notifySlack(
        `⏳ การจ่ายผ่าน KBIZ ค้างเกิน ${STALE_MINUTES} นาที — ${bundle.name} (${total})\n` +
          'kbiz-bot ยังไม่รายงานผล เปิด K BIZ เพื่อดูว่าโอนไปแล้วหรือยัง แล้วปิดงานในระบบ',
      );
      console.error(`[kbiz] ${bundle.id} has been PAYING for over ${STALE_MINUTES}m with the bot holding it`);
      continue;
    }

    const message =
      state === 'unqueued'
        ? 'ไม่พบคำสั่งจ่ายในคิว KBIZ — คำสั่งไม่ได้ถูกส่งไปที่ธนาคาร ยังไม่มีการโอนเกิดขึ้น'
        : 'kbiz-bot ไม่ได้เริ่มทำรายการนี้ — ดึงคำสั่งออกจากคิวแล้ว ยังไม่มีการโอนเกิดขึ้น';

    const flagged = await prisma.bundle.updateMany({
      where: {
        id: bundle.id,
        status: 'PAYING',
        paymentIntentId: bundle.paymentIntentId,
        paymentError: null,
      },
      data: { paymentError: message },
    });
    if (flagged.count === 0) continue;

    await prisma.auditEvent.create({
      data: {
        type: 'payment-stale',
        bundleId: bundle.id,
        actorId: bundle.approvedById ?? bundle.userId,
        metadata: { via: 'kbiz-poller', intentId: bundle.paymentIntentId, intentState: state, flagged: true },
      },
    });

    notifyPortal({
      title: 'การจ่ายต้องตรวจสอบ',
      body: `${bundle.name} — ยังไม่มีการโอน สั่งจ่ายใหม่ได้`,
      path: '/',
      tag: `kbiz-stale-${bundle.id}`,
      audience: 'managers',
    });
    notifySlack(
      `⚠️ คำสั่งจ่ายผ่าน KBIZ ค้างเกิน ${STALE_MINUTES} นาที — ${bundle.name} (${total})\n${message}\n` +
        'กด "ยังไม่ได้โอน — ลองใหม่" ในระบบเพื่อสั่งจ่ายอีกครั้ง',
    );
    console.error(`[kbiz] ${bundle.id} flagged as stranded (${state}) after ${STALE_MINUTES}m`);
  }
}

/** Guard against a slow sweep overlapping the next tick. */
let sweeping = false;

async function sweep(): Promise<void> {
  if (sweeping) return;
  sweeping = true;
  try {
    for (const fileName of await listQueueFiles()) {
      const raw = await readQueueFile(fileName);

      // A finished favorites-sync is bookkeeping, not a payment: archive it so
      // sync_*.json files don't accumulate in the hot queue forever (one per
      // ซิงค์ click, each re-read by every 5s sweep otherwise).
      const item = raw as { app?: unknown; type?: unknown; status?: unknown } | null;
      if (
        item &&
        item.app === 'reimbursement' &&
        item.type === 'list-favorites' &&
        (item.status === 'done' || item.status === 'failed')
      ) {
        await archiveQueueFile(fileName).catch((error) =>
          console.error(`[kbiz] could not archive finished sync ${fileName}:`, error),
        );
        continue;
      }

      if (!isOurTerminalIntent(raw)) continue;

      try {
        await reconcile(fileName, raw);
      } catch (error) {
        // One bad intent must not stop the others; it stays in the queue and is
        // retried on the next sweep.
        console.error(`[kbiz] could not reconcile ${fileName}:`, error);
      }
    }

    // Results first, silence second: a bundle settled by the loop above is no
    // longer PAYING, so it can never be double-counted as stranded.
    await sweepStranded();
  } catch (error) {
    console.error('[kbiz] sweep failed:', error);
  } finally {
    sweeping = false;
  }
}

/**
 * Start polling, if this host is wired up for automated payment at all.
 *
 * Called once from index.ts. Without a provisioned queue directory the loop is
 * never started — no timer, no log spam, and the API behaves exactly as it did
 * before this feature existed. The reason is logged either way: "the mount is
 * there but nobody ran the runbook" is the failure ops will actually hit, and
 * it should not look identical to "this feature is off".
 */
export async function startKbizPoller(): Promise<void> {
  const state = await inspectKbizQueue();
  if (state !== 'ready') {
    console.log(`[kbiz] ${describeKbizQueue(state)}`);
    return;
  }

  console.log(
    `[kbiz] watching the payment queue every ${KBIZ_POLL_MS}ms ` +
      `(stranded after ${STALE_MINUTES}m)`,
  );
  setInterval(() => {
    void sweep();
  }, KBIZ_POLL_MS);
}
