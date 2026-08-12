import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { prisma } from '../db';
import { Prisma } from '../generated/prisma';
import { saveUploadedFile } from '../uploads';
import { notifyPortal } from '../notify';
import { bundleStatusFromShared, serializeBundleWithDetails } from '../serializers';
import {
  intentFileExists,
  isKbizConfigured,
  loadKbizPaymentContext,
  newPaymentIntentId,
  readIntentState,
  readKbizFavorites,
  readPayeeHandlesManifest,
  withdrawQueuedIntent,
  writeIntent,
  writeVoucherHtml,
  type KbizQueuedIntent,
} from '../kbiz';
import { getKbizCategoryMapping, getKbizPayees } from '../settings';
import { sumReceiptAmounts } from '../money';
import { renderVoucherHtml } from '../voucher';
import {
  buildKbizMemo,
  KBIZ_BANKS,
  resolveKbizCategoryId,
  type BundleStatus,
  type KbizBank,
  type KbizDestination,
} from '@reimbursement/shared';

const SHARED_BUNDLE_STATUSES: readonly BundleStatus[] = [
  'draft',
  'pending',
  'approved',
  'paying',
  'paid',
  'rejected',
];

function isSharedBundleStatus(value: string): value is BundleStatus {
  return (SHARED_BUNDLE_STATUSES as readonly string[]).includes(value);
}

/** One of KBIZ's own destination-bank options, matched verbatim by the bot. */
function isKbizBank(value: string): value is KbizBank {
  return (KBIZ_BANKS as readonly string[]).includes(value);
}

/**
 * The destination as the AUDIT TRAIL records it — the one place a typed account
 * number is deliberately dropped.
 *
 * The full number is needed exactly once, by the bot, and so lives only in the
 * queue file it reads — which `archiveQueueFile` redacts the moment that file is
 * filed away. The database keeps the last four, which is all anyone reading the
 * history back needs in order to recognise the account.
 */
function auditDestination(destination: KbizDestination): Record<string, string> {
  switch (destination.kind) {
    case 'handle':
      return { kind: 'handle', handle: destination.handle };
    case 'favorite':
      return {
        kind: 'favorite',
        nickname: destination.nickname,
        bank: destination.bank,
        accountLast4: destination.accountLast4,
        ...(destination.accountName ? { accountName: destination.accountName } : {}),
      };
    case 'custom':
      return {
        kind: 'custom',
        bank: destination.bank,
        accountLast4: destination.accountNo.slice(-4),
        ...(destination.accountName ? { accountName: destination.accountName } : {}),
      };
  }
}

/** Enough to fill a long screen without another round trip; a caller that wants
 *  more asks for it explicitly. */
const DEFAULT_PAGE_SIZE = 50;
/** Ceiling so a stray ?limit=100000 cannot resurrect the original problem. */
const MAX_PAGE_SIZE = 200;

export const bundleRoutes = new Elysia({ prefix: '/bundles' })
  .use(auth)

  .get(
    '/',
    async ({ user, query, status }) => {
      // Requests are visible to every signed-in employee, in every status.
      //
      // This is a small hotel team that already discusses these expenses out
      // loud, and hiding each other's requests actively got in the way: work
      // could not be handed over, because the person picking it up could not
      // see it. `?mine=1` still gives the personal view that "คำขอของฉัน"
      // renders. Acting on a request is unchanged and still restricted —
      // approve/reject/pay remain approver-only, and editing a receipt still
      // requires owning it.
      const mine = query.mine === '1' || query.mine === 'true';
      const filters: Record<string, unknown> = {};

      if (mine) {
        filters.userId = user.id;
      }

      if (query.status !== undefined) {
        if (!isSharedBundleStatus(query.status)) {
          return status(400, { message: `Unknown status: ${query.status}` });
        }
        filters.status = bundleStatusFromShared(query.status);
      }
      // No default status filter: the approver UI builds its pending/approved/
      // paid/rejected tabs client-side from the unfiltered list, so forcing
      // PENDING here would leave every non-pending tab permanently empty.

      // Include receipts + approver so list items are full BundleWithDetails —
      // the UI sums receipt amounts and shows the approver, so omitting these
      // produced an undefined `receipts` crash once real bundles existed.
      // Paginated. Production holds ~1,500 bundles, each joined to its
      // receipts, submitter and approver; returning all of them was several MB
      // per request, and the client fetched the list twice on boot. A phone on
      // hotel wifi spent that entire download before first paint.
      //
      // Counts and totals now come from /api/bundles/stats, so a caller never
      // needs the whole array just to render a number.
      const take = Math.min(Math.max(Number(query.limit ?? DEFAULT_PAGE_SIZE) || DEFAULT_PAGE_SIZE, 1), MAX_PAGE_SIZE);
      const skip = Math.max(Number(query.offset ?? 0) || 0, 0);

      // Whether KBIZ payment is live is read once for the whole page, not once
      // per bundle — `kbizPayable` is a per-row answer built from a per-request
      // fact.
      const [bundles, kbiz] = await Promise.all([
        prisma.bundle.findMany({
          where: filters,
          include: { receipts: true, user: true, approver: true },
          orderBy: { submittedAt: 'desc' },
          take,
          skip,
        }),
        loadKbizPaymentContext(),
      ]);

      return bundles.map((bundle) => serializeBundleWithDetails(bundle, kbiz));
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        mine: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  /**
   * Everything the UI needs as a NUMBER, without shipping the rows.
   *
   * Sidebar counts, the approval-box totals and the whole ภาพรวม page used to be
   * derived in the browser from the complete bundle array — which is why the
   * client downloaded all ~1,500 of them (twice) before it could render "1".
   * Postgres does this in one round trip over indexed columns; the response is
   * a couple of KB regardless of how big the archive grows.
   */
  .get(
    '/stats',
    async ({ user, query }) => {
      const mine = query.mine === '1' || query.mine === 'true';
      const scope = mine ? { userId: user.id } : {};

      const [byStatus, sums, drafts, catRows, submitterRows, propRows, monthRows] =
        await Promise.all([
        prisma.bundle.groupBy({ by: ['status'], where: scope, _count: { _all: true } }),
        // Bundles carry no total of their own — transferAmount is only written
        // at pay time — so the money has to come from the receipts joined to
        // each status.
        prisma.$queryRaw<Array<{ status: string; total: string | null }>>`
          SELECT b."status"::text AS status, SUM(r."amount")::text AS total
          FROM bundles b JOIN receipts r ON r."bundleId" = b.id
          ${mine ? Prisma.sql`WHERE b."userId" = ${user.id}` : Prisma.empty}
          GROUP BY b."status"
        `,
        prisma.receipt.count({ where: { userId: user.id, bundleId: null } }),

        // ── ภาพรวม aggregates ────────────────────────────────────────────
        // These are the charts. Computing them in the browser is what forced
        // the whole archive down the wire in the first place.
        prisma.$queryRaw<Array<{ category: string; total: string }>>`
          SELECT r."category" AS category, SUM(r."amount")::text AS total
          FROM receipts r
          GROUP BY r."category" ORDER BY SUM(r."amount") DESC LIMIT 6
        `,
        prisma.$queryRaw<Array<{ name: string; total: string }>>`
          SELECT u."name" AS name, SUM(r."amount")::text AS total
          FROM receipts r
          JOIN bundles b ON r."bundleId" = b.id
          JOIN users u ON b."userId" = u.id
          GROUP BY u."name" ORDER BY SUM(r."amount") DESC LIMIT 5
        `,
        prisma.$queryRaw<Array<{ property: string; total: string }>>`
          SELECT r."property" AS property, SUM(r."amount")::text AS total
          FROM receipts r GROUP BY r."property"
        `,
        // Paid baht per calendar month for the trailing year, bucketed on
        // paidAt — when the money actually left.
        prisma.$queryRaw<Array<{ month: string; total: string }>>`
          SELECT to_char(date_trunc('month', b."paidAt"), 'YYYY-MM') AS month,
                 SUM(r."amount")::text AS total
          FROM bundles b JOIN receipts r ON r."bundleId" = b.id
          WHERE b."status" = 'PAID' AND b."paidAt" >= (now() - interval '12 months')
          GROUP BY 1 ORDER BY 1
        `,
      ]);

      const counts: Record<string, number> = {};
      for (const row of byStatus) counts[row.status.toLowerCase()] = row._count._all;

      const totals: Record<string, number> = {};
      for (const row of sums) totals[row.status.toLowerCase()] = Number(row.total ?? 0);

      const pick = (s: string) => ({ count: counts[s] ?? 0, total: totals[s] ?? 0 });

      return {
        pending: pick('pending'),
        approved: pick('approved'),
        /** In flight at the bank — the KBIZ bot owns these right now. */
        paying: pick('paying'),
        paid: pick('paid'),
        rejected: pick('rejected'),
        /** Loose receipts — always the caller's own, whatever the scope. */
        drafts,
        byCategory: catRows.map((r) => ({ label: r.category, amount: Number(r.total) })),
        bySubmitter: submitterRows.map((r) => ({ label: r.name, amount: Number(r.total) })),
        byProperty: {
          'hf-hotel': Number(propRows.find((r) => r.property === 'hf-hotel')?.total ?? 0),
          'hf-ville': Number(propRows.find((r) => r.property === 'hf-ville')?.total ?? 0),
        },
        paidByMonth: monthRows.map((r) => ({ month: r.month, amount: Number(r.total) })),
      };
    },
    { query: t.Object({ mine: t.Optional(t.String()) }) },
  )

  .post(
    '/',
    async ({ user, body, status }) => {
      const { name, receiptIds, note } = body;

      if (receiptIds.length === 0) {
        return status(400, { message: 'receiptIds must not be empty' });
      }

      const receipts = await prisma.receipt.findMany({
        where: { id: { in: receiptIds } },
      });

      if (receipts.length !== receiptIds.length) {
        return status(400, { message: 'One or more receiptIds do not exist' });
      }

      for (const receipt of receipts) {
        if (receipt.userId !== user.id) {
          return status(403, { message: 'Cannot bundle receipts owned by another user' });
        }
        if (receipt.bundleId !== null) {
          return status(400, {
            message: `Receipt ${receipt.id} is already attached to a bundle`,
          });
        }
      }

      const submittedAt = new Date();

      const created = await prisma.$transaction(async (tx) => {
        const bundle = await tx.bundle.create({
          data: {
            userId: user.id,
            name,
            note: note ?? '',
            status: 'PENDING',
            submittedAt,
          },
        });

        await tx.receipt.updateMany({
          where: { id: { in: receiptIds } },
          data: { bundleId: bundle.id },
        });

        await tx.auditEvent.create({
          data: {
            type: 'submit',
            bundleId: bundle.id,
            actorId: user.id,
          },
        });

        return tx.bundle.findUniqueOrThrow({
          where: { id: bundle.id },
          include: { receipts: true, user: true, approver: true },
        });
      });

      // Tell the approvers. Fire-and-forget by construction: a submission that
      // succeeded must not fail because a notification did.
      const total = sumReceiptAmounts(created.receipts);
      notifyPortal({
        title: 'คำขอเบิกใหม่',
        body: `${created.user.name} · ${name} · ฿${total.toLocaleString('en-US', {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`,
        path: '/',
        // One notification per request, so a retry cannot ring twice.
        tag: `reimbursement:bundle:${created.id}`,
        // Only people who can approve it — the portal fails closed to nobody
        // rather than everybody if that set is empty.
        audience: 'managers',
      });

      return serializeBundleWithDetails(created);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        receiptIds: t.Array(t.String(), { minItems: 1 }),
        note: t.Optional(t.String()),
      }),
    },
  )

  .get('/:id', async ({ params, status }) => {
    const [bundle, kbiz] = await Promise.all([
      prisma.bundle.findUnique({
        where: { id: params.id },
        include: { receipts: true, user: true, approver: true },
      }),
      loadKbizPaymentContext(),
    ]);

    if (!bundle) {
      return status(404, { message: 'Bundle not found' });
    }

    // Readable by any signed-in employee — same reasoning as the list above.
    // The actions on this bundle are still gated below.
    return serializeBundleWithDetails(bundle, kbiz);
  })

  .post('/:id/approve', async ({ user, params, status }) => {
    if (user.role !== 'APPROVER') {
      return status(403, { message: 'Only approvers can approve bundles' });
    }

    const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
    if (!bundle) {
      return status(404, { message: 'Bundle not found' });
    }
    if (bundle.status !== 'PENDING') {
      return status(409, {
        message: `Cannot approve a ${bundle.status.toLowerCase()} bundle; only pending bundles can be approved`,
      });
    }

    const approvedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bundle.update({
        where: { id: params.id },
        data: {
          status: 'APPROVED',
          approvedAt,
          approvedById: user.id,
        },
        include: { receipts: true, user: true, approver: true },
      });

      await tx.auditEvent.create({
        data: {
          type: 'approve',
          bundleId: params.id,
          actorId: user.id,
        },
      });

      return result;
    });

    // The approver's next possible action is "จ่ายผ่าน KBIZ", so the response
    // has to carry whether that action is available on this bundle.
    return serializeBundleWithDetails(updated, await loadKbizPaymentContext());
  })

  /**
   * Pull a still-pending request back for more edits.
   *
   * Submitting used to be one-way: the only route back out of PENDING was for
   * an approver to reject it, which leaves a rejected record and a reason for
   * something that was never actually wrong. Someone who spots their own
   * mistake should be able to take the request back themselves.
   *
   * The receipts return to the draft pool exactly as they do on reject, and the
   * bundle is removed rather than parked in some withdrawn state — there is no
   * such status, and inventing one would put an entry in every approver's list
   * that nobody needs to act on. The audit event is what records that it
   * happened.
   */
  .post('/:id/withdraw', async ({ user, params, status }) => {
    const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
    if (!bundle) {
      return status(404, { message: 'Bundle not found' });
    }

    // The submitter, or an approver acting on their behalf.
    if (bundle.userId !== user.id && user.role !== 'APPROVER') {
      return status(403, { message: 'Forbidden' });
    }

    // Only while it is still pending. Once approved or paid the money has
    // moved on and unpicking it is an approver decision, not a self-service one.
    if (bundle.status !== 'PENDING') {
      return status(409, {
        message: `ดึงกลับได้เฉพาะคำขอที่ยังรออนุมัติ (สถานะปัจจุบัน: ${bundle.status.toLowerCase()})`,
      });
    }

    await prisma.$transaction(async (tx) => {
      await tx.receipt.updateMany({
        where: { bundleId: params.id },
        data: { bundleId: null },
      });

      // Audit first: the row is about to disappear, and the event carries
      // bundleId with onDelete: Cascade, so writing it after the delete would
      // silently lose it.
      await tx.auditEvent.create({
        data: {
          type: 'withdraw',
          actorId: user.id,
          metadata: { bundleId: params.id, name: bundle.name },
        },
      });

      await tx.bundle.delete({ where: { id: params.id } });
    });

    return { ok: true as const };
  })

  .post(
    '/:id/reject',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can reject bundles' });
      }

      const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }
      if (bundle.status !== 'PENDING') {
        return status(409, {
          message: `Cannot reject a ${bundle.status.toLowerCase()} bundle; only pending bundles can be rejected`,
        });
      }

      const reason = body.reason?.trim() || null;

      const updated = await prisma.$transaction(async (tx) => {
        // Return the receipts to the submitter's draft pool so they can be
        // fixed and resubmitted — otherwise a rejection is a dead-end (the
        // receipts stay locked to the rejected bundle forever).
        await tx.receipt.updateMany({
          where: { bundleId: params.id },
          data: { bundleId: null },
        });

        const result = await tx.bundle.update({
          where: { id: params.id },
          data: { status: 'REJECTED', rejectReason: reason },
          include: { receipts: true, user: true, approver: true },
        });

        await tx.auditEvent.create({
          data: {
            type: 'reject',
            bundleId: params.id,
            actorId: user.id,
            metadata: reason ? { reason } : {},
          },
        });

        return result;
      });

      return serializeBundleWithDetails(updated);
    },
    {
      body: t.Object({ reason: t.Optional(t.String()) }),
    },
  )

  /**
   * Mark a bundle paid by hand, with the approver's own e-slip.
   *
   * Three bundles can arrive here:
   *
   *  - **APPROVED** — the ordinary manual transfer, unchanged since day one.
   *  - **PAYING with a `paymentError`** — the KBIZ bot could not tell whether
   *    its transfer landed. The approver was on their phone for the tap, so
   *    they know the answer and hold the e-slip; attaching it here is how an
   *    ambiguous payment is resolved forwards (ADR 0001, decision 7). Nothing
   *    resolves it automatically, ever.
   *  - **PAYING with no `paymentError`, with `force`** — the override. An
   *    in-flight bundle normally belongs to the bot and is deliberately not
   *    payable by hand. But the bot can die mid-transfer, or the deploy that
   *    was rolling when the intent was written can have eaten it: then no
   *    terminal result is ever written, nothing flags the bundle, and without
   *    this the employee could never be paid at all. `force` is the approver
   *    saying "I have checked K BIZ and I am holding the slip"; it is audited
   *    as an override, and clearing `paymentIntentId` stops any late bot result
   *    from landing on top of it.
   */
  .post(
    '/:id/pay',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can mark bundles as paid' });
      }

      const bundle = await prisma.bundle.findUnique({
        where: { id: params.id },
        include: { receipts: true },
      });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }

      // Multipart carries strings, so the flag is read the same way the query
      // parameters above are.
      const forced =
        bundle.status === 'PAYING' &&
        bundle.paymentError === null &&
        (body.force === '1' || body.force === 'true');
      const manualResolution =
        bundle.status === 'PAYING' && (bundle.paymentError !== null || forced);
      if (bundle.status !== 'APPROVED' && !manualResolution) {
        return status(409, {
          message:
            bundle.status === 'PAYING'
              ? 'คำขอนี้กำลังโอนผ่าน KBIZ อยู่ — ยืนยันว่าต้องการบันทึกจ่ายเองก่อน'
              : `Cannot pay a ${bundle.status.toLowerCase()} bundle; it must be approved first`,
        });
      }

      const transferProofPath = await saveUploadedFile(body.proof);
      const transferAmount = sumReceiptAmounts(bundle.receipts);
      const paidAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.bundle.update({
          where: { id: params.id },
          data: {
            status: 'PAID',
            paidAt,
            transferRef: body.transferRef,
            transferAmount,
            transferProofPath,
            // The intent is settled either way: clearing all three stops the
            // poller from ever reconciling a late bot result onto a bundle a
            // human has already closed, clears the needs-verification flag and
            // takes the bundle out of the stranded-payment watchdog's sight.
            paymentIntentId: null,
            paymentError: null,
            payingSince: null,
          },
          include: { receipts: true, user: true, approver: true },
        });

        await tx.auditEvent.create({
          data: {
            type: 'pay',
            bundleId: params.id,
            actorId: user.id,
            metadata: manualResolution
              ? {
                  transferRef: body.transferRef,
                  transferAmount,
                  manualResolution: true,
                  // `forced` marks the override: the bundle carried no error,
                  // so this human overruled an attempt the bot never finished
                  // reporting on.
                  forced,
                  intentId: bundle.paymentIntentId,
                }
              : { transferRef: body.transferRef, transferAmount },
          },
        });

        return result;
      });

      return serializeBundleWithDetails(updated, await loadKbizPaymentContext());
    },
    {
      body: t.Object({
        transferRef: t.String({ minLength: 1 }),
        proof: t.File(),
        /** '1' — pay a PAYING bundle by hand anyway (see the docblock). */
        force: t.Optional(t.String()),
      }),
      type: 'multipart/form-data',
    },
  )

  /**
   * "จ่ายผ่าน KBIZ" — hand this bundle to the bank bot.
   *
   * This is the only place in the app that starts money moving, so the order of
   * operations is the whole design:
   *
   *  1. Everything that can refuse, refuses first — feature off, a destination
   *     that does not check out, nothing to pay — while the bundle is still
   *     untouched.
   *  2. The atomic `UPDATE … WHERE status = 'APPROVED'` claims the bundle. That
   *     WHERE clause IS the double-pay guard: of two concurrent clicks exactly
   *     one matches a row, and the loser gets a 409 instead of a second intent.
   *  3. ONLY THEN are the voucher and the intent written. The bot picks up
   *     `queue/*.json`, so nothing may appear there before this app owns the
   *     bundle — a file written before the guard would be executed even if the
   *     guard then lost.
   *
   * Where the money goes is the approver's choice at pay time (`destination`),
   * and no body at all still means what it always did: the admin-mapped payee
   * handle, which the bot resolves against a saved, vetted KBIZ account. This
   * app persists no bank data (ADR 0001, decision 4) — a `custom` destination's
   * account number is typed once, travels in the queue file the bot consumes,
   * is redacted out of that file when it is archived, and is masked to its last
   * four everywhere else.
   */
  .post(
    '/:id/pay-via-kbiz',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can pay bundles' });
      }

      if (!(await isKbizConfigured())) {
        return status(503, {
          message: 'เซิร์ฟเวอร์นี้ยังไม่ได้เปิดใช้งานการจ่ายผ่าน KBIZ',
        });
      }

      const bundle = await prisma.bundle.findUnique({
        where: { id: params.id },
        include: { receipts: true, user: true, approver: true },
      });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }

      // ── where the money goes ──────────────────────────────────────────
      // Resolved here, with every other refusal, so a rejected destination can
      // never leave a bundle claimed into PAYING.
      //
      // Nothing the client sends is taken at face value: a handle has to be the
      // submitter's own mapping or one the bot has actually published, a
      // favorite is copied wholesale off the synced row (the request only picks
      // WHICH row), and a custom account — the single shape that carries a real
      // account number — is checked against KBIZ's own bank list and digit
      // rules before it can be typed into a bank form.
      const payees = await getKbizPayees();
      const mappedHandle = payees[bundle.userId] ?? null;
      const requested = body?.destination ?? null;
      let destination: KbizDestination;

      if (requested === null) {
        // No body: the pre-picker behaviour, unchanged.
        if (!mappedHandle) {
          return status(409, {
            message: `ยังไม่ได้ตั้งค่าบัญชีปลายทางของ ${bundle.user.name} — ตั้งค่าที่หน้าผู้ดูแลระบบก่อน`,
          });
        }
        destination = { kind: 'handle', handle: mappedHandle };
      } else if (requested.kind === 'handle') {
        const handle = requested.handle?.trim() ?? '';
        const known =
          handle.length > 0 &&
          (handle === mappedHandle ||
            ((await readPayeeHandlesManifest())?.handles.includes(handle) ?? false));
        if (!known) {
          return status(409, {
            message: 'ไม่พบบัญชีปลายทางนี้ในสมุดบัญชีของบอท',
          });
        }
        destination = { kind: 'handle', handle };
      } else if (requested.kind === 'favorite') {
        const synced = await readKbizFavorites();
        if (!synced) {
          return status(409, { message: 'ยังไม่ได้ซิงค์รายชื่อจาก KBIZ' });
        }

        // Nickname + last-4 is the same pair the bot re-verifies against the
        // live picker, and it demands exactly one hit there — so two saved
        // accounts wearing it are refused here rather than resolved by
        // ordering, which could hand the transfer a different bank entirely.
        //
        // BOTH sides are trimmed. A KBIZ display name reaches the manifest with
        // whatever whitespace the bot scraped out of the table cell, and
        // trimming only the request made such a row permanently unpayable:
        // offered by the picker, refused here, and a re-sync reproduces the
        // identical row. An empty pair matches nothing rather than a row whose
        // nickname is nothing but spaces. What is handed to the bot below is
        // still the synced row verbatim, so it re-verifies against exactly the
        // text it published.
        const nickname = requested.nickname?.trim() ?? '';
        const accountLast4 = requested.accountLast4?.trim() ?? '';
        const matches =
          nickname.length === 0 || accountLast4.length === 0
            ? []
            : synced.favorites.filter(
                (favorite) =>
                  favorite.nickname.trim() === nickname &&
                  favorite.accountLast4.trim() === accountLast4,
              );
        if (matches.length === 0) {
          return status(409, {
            message: 'ไม่พบบัญชีนี้ในรายชื่อที่ซิงค์จาก KBIZ — ซิงค์รายชื่อใหม่แล้วลองอีกครั้ง',
          });
        }
        if (matches.length > 1) {
          return status(409, {
            message: 'มีบัญชีชื่อนี้ซ้ำกันใน KBIZ — แก้ชื่อในธนาคารให้ไม่ซ้ำแล้วซิงค์ใหม่',
          });
        }

        // Bank and name come off the synced row, never off the request: the
        // client's copy could be stale, or edited.
        const match = matches[0];
        destination = {
          kind: 'favorite',
          nickname: match.nickname,
          bank: match.bank,
          accountLast4: match.accountLast4,
          accountName: match.accountName,
        };
      } else {
        const bank = requested.bank?.trim() ?? '';
        if (!isKbizBank(bank)) {
          return status(400, { message: 'ธนาคารปลายทางไม่ถูกต้อง' });
        }

        // Whatever the approver typed — spaces, dashes — reduced to the digits
        // KBIZ's own account field accepts.
        const accountNo = (requested.accountNo ?? '').replace(/\D/g, '');
        if (accountNo.length < 8 || accountNo.length > 15) {
          return status(400, { message: 'เลขที่บัญชีไม่ถูกต้อง — ต้องเป็นตัวเลข 8-15 หลัก' });
        }

        const accountName = requested.accountName?.trim() ?? '';
        if (accountName.length > 80) {
          return status(400, { message: 'ชื่อบัญชียาวเกิน 80 ตัวอักษร' });
        }

        destination = {
          kind: 'custom',
          bank,
          accountNo,
          ...(accountName.length > 0 ? { accountName } : {}),
        };
      }

      // Server-computed, exactly like /pay: the amount is Σ receipts and never
      // something the client sent.
      const amount = sumReceiptAmounts(bundle.receipts);
      if (amount <= 0) {
        return status(409, { message: 'คำขอนี้ไม่มียอดที่ต้องจ่าย' });
      }

      const memo = buildKbizMemo(bundle.name, bundle.id);
      const kbizCategoryId = resolveKbizCategoryId(
        bundle.receipts.map((receipt) => ({
          category: receipt.category,
          amount: Number(receipt.amount),
        })),
        await getKbizCategoryMapping(),
      );
      const intentId = newPaymentIntentId();

      const claimed = await prisma.bundle.updateMany({
        where: { id: params.id, status: 'APPROVED' },
        data: {
          status: 'PAYING',
          paymentIntentId: intentId,
          paymentError: null,
          // The clock the stranded-payment watchdog reads. Stamped by the claim
          // itself so it is set even if this process dies before the intent file
          // is written — that crash window is exactly what strands a bundle.
          payingSince: new Date(),
        },
      });
      if (claimed.count !== 1) {
        return status(409, { message: 'คำขอนี้ไม่อยู่ในสถานะที่จ่ายได้' });
      }

      try {
        const voucherFile = await writeVoucherHtml(
          intentId,
          renderVoucherHtml(bundle, bundle.receipts, bundle.user, bundle.approver),
        );

        const intent: KbizQueuedIntent = {
          id: intentId,
          app: 'reimbursement',
          type: 'transfer-other',
          status: 'approved',
          createdAt: new Date().toISOString(),
          bundleId: bundle.id,
          // Both fields, deliberately: `destination` is what a reader should
          // use, and `payee` keeps a handle transfer legible to a bot build
          // that predates the picker. A favorite or a typed account has no
          // handle to state, so it states none rather than a stale one.
          payee: destination.kind === 'handle' ? { handle: destination.handle } : null,
          destination,
          amount,
          memo,
          kbizCategoryId,
          voucherFile,
        };
        await writeIntent(intent);
      } catch (error) {
        console.error(`[kbiz] could not queue intent ${intentId}:`, error);

        // Release the claim only when we are certain nothing is queued. If the
        // intent file made it into queue/ the bot may already be driving the
        // bank, and flipping the bundle back to APPROVED would invite a second
        // transfer for the same money.
        if (await intentFileExists(intentId)) {
          return status(500, {
            message: 'ส่งคำสั่งจ่ายไม่สมบูรณ์ กรุณาตรวจสอบสถานะการโอนก่อนสั่งจ่ายซ้ำ',
          });
        }

        await prisma.bundle.updateMany({
          where: { id: params.id, status: 'PAYING', paymentIntentId: intentId },
          data: { status: 'APPROVED', paymentIntentId: null, paymentError: null, payingSince: null },
        });
        return status(500, { message: 'ส่งคำสั่งจ่ายไม่สำเร็จ คำขอกลับสู่สถานะอนุมัติแล้ว' });
      }

      await prisma.auditEvent.create({
        data: {
          type: 'pay-via-kbiz',
          bundleId: params.id,
          actorId: user.id,
          // `auditDestination` is what keeps a typed account number out of the
          // database — the history gets a last-4, the bot gets the number.
          metadata: {
            intentId,
            amount,
            memo,
            kbizCategoryId,
            destination: auditDestination(destination),
          },
        },
      });

      const [updated, kbiz] = await Promise.all([
        prisma.bundle.findUniqueOrThrow({
          where: { id: params.id },
          include: { receipts: true, user: true, approver: true },
        }),
        loadKbizPaymentContext(),
      ]);

      return serializeBundleWithDetails(updated, kbiz);
    },
    {
      /**
       * The destination, loosely typed here and narrowed by hand in the handler.
       *
       * A per-kind TypeBox union would turn every "wrong field for this kind"
       * into a 422 whose body is a schema error — unreadable, and untranslatable
       * into the Thai the approver actually needs. One permissive object plus
       * the manual narrowing in the handler keeps every refusal a Thai sentence,
       * and the handler re-derives every field from the payee mapping, the
       * synced favorites or KBIZ's own bank list regardless.
       */
      body: t.Optional(
        t.Object({
          destination: t.Optional(
            t.Object({
              kind: t.Union([t.Literal('handle'), t.Literal('favorite'), t.Literal('custom')]),
              handle: t.Optional(t.String()),
              nickname: t.Optional(t.String()),
              bank: t.Optional(t.String()),
              accountLast4: t.Optional(t.String()),
              accountNo: t.Optional(t.String()),
              accountName: t.Optional(t.String()),
            }),
          ),
        }),
      ),
    },
  )

  /**
   * "ยังไม่โอน" — release a payment that never moved money, so it can be paid
   * again.
   *
   * Three ways in, all of them still requiring `PAYING`:
   *
   *  1. **`paymentError` set** — the bot came back ambiguous and a human has
   *     checked K BIZ. Unchanged.
   *  2. **No error, but nothing was ever armed** — the queue itself proves it:
   *     no intent file at all (this app died between the atomic claim and the
   *     write), or one still sitting at `status: 'approved'` (kbiz-bot never
   *     started it). Both mean the bank has heard nothing, so the release is
   *     free; the untouched file is withdrawn into `queue/archive/` first so
   *     the bot can never pick it up afterwards.
   *  3. **No error and the bot owns it, with `force`** — the override, for the
   *     case where the bot died mid-flight and will never report. The approver
   *     asserts they have checked K BIZ and nothing moved. Audited as forced.
   *
   * Without 2 and 3 a bundle whose bot never answers has NO way out: the only
   * writer of `paymentError` is the poller reconciling a terminal result, so
   * "no result ever arrives" used to mean stuck forever, with the employee
   * unpaid and the approver unable to close it. Manual payment is the fallback
   * for every bundle, including a stuck one.
   *
   * The stuck intent id is always dropped rather than reused — the next attempt
   * writes a brand-new one, so a late result for the old intent can no longer
   * find a bundle to land on.
   */
  .post(
    '/:id/payment-retry',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can release a stuck payment' });
      }

      const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }
      if (bundle.status !== 'PAYING') {
        return status(409, { message: 'คำขอนี้ไม่อยู่ในสถานะที่ปล่อยกลับไปอนุมัติได้' });
      }

      const force = body?.force === true;
      let intentState: Awaited<ReturnType<typeof readIntentState>> | null = null;
      let provablyIdle = false;

      if (bundle.paymentError === null) {
        intentState = await readIntentState(bundle.paymentIntentId);

        // Nothing armed → release. Anything else needs the human to say so.
        provablyIdle =
          intentState === 'unqueued' ||
          (intentState === 'queued' &&
            bundle.paymentIntentId !== null &&
            (await withdrawQueuedIntent(bundle.paymentIntentId)));

        if (!provablyIdle && !force) {
          return status(409, {
            message:
              intentState === 'unknown'
                ? 'ตรวจสอบสถานะคำสั่งจ่ายไม่ได้ (ไม่พบคิว KBIZ) — เปิด K BIZ เพื่อดูว่าโอนไปแล้วหรือยัง แล้วยืนยันอีกครั้ง'
                : 'kbiz-bot กำลังทำรายการนี้อยู่ — เปิด K BIZ เพื่อดูว่าโอนไปแล้วหรือยัง แล้วยืนยันอีกครั้ง',
          });
        }
      }

      const released = await prisma.bundle.updateMany({
        // Guarded on the exact row this decision was made about: same status,
        // same intent, same error-or-not. A poller sweep or a second approver
        // landing in between matches zero rows instead of being overwritten.
        where: {
          id: params.id,
          status: 'PAYING',
          paymentIntentId: bundle.paymentIntentId,
          ...(bundle.paymentError === null ? { paymentError: null } : { NOT: { paymentError: null } }),
        },
        data: { status: 'APPROVED', paymentIntentId: null, paymentError: null, payingSince: null },
      });
      if (released.count !== 1) {
        return status(409, { message: 'คำขอนี้ไม่อยู่ในสถานะที่ปล่อยกลับไปอนุมัติได้' });
      }

      await prisma.auditEvent.create({
        data: {
          type: 'payment-retry',
          bundleId: params.id,
          actorId: user.id,
          metadata: {
            releasedIntentId: bundle.paymentIntentId,
            paymentError: bundle.paymentError,
            intentState,
            // True only when the human overruled an intent the bot still owned.
            forced: bundle.paymentError === null && !provablyIdle,
          },
        },
      });

      const [updated, kbiz] = await Promise.all([
        prisma.bundle.findUniqueOrThrow({
          where: { id: params.id },
          include: { receipts: true, user: true, approver: true },
        }),
        loadKbizPaymentContext(),
      ]);

      return serializeBundleWithDetails(updated, kbiz);
    },
    {
      body: t.Optional(t.Object({ force: t.Optional(t.Boolean()) })),
    },
  );
