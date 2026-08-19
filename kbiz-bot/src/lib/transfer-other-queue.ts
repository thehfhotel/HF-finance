import { basename, resolve } from "node:path";
import type { KbizDestination, KbizPaymentIntent } from "@reimbursement/shared";
import type { Payee } from "../flows/transfer-other-flow";
import type { TransferFailureOutcome } from "./approval-wait";
import { resolveRecipient, toPayee, type TransferConfig } from "./transfer-config";

/**
 * Where a payment goes, chosen by the approver at pay time — reimbursement's
 * `KbizDestination` (reimbursement/packages/shared/src/index.ts) ITSELF, under
 * the bot's own name.
 *
 *  - "handle": the admin-mapped payee; the bot's own gitignored payee book
 *    resolves it, exactly as before the picker existed.
 *  - "favorite": a synced KBIZ saved account. Carries NO full account number
 *    (the synced list is masked); the flow verifies nickname + bank + last-4
 *    against the live picker and requires exactly one match.
 *  - "custom": a typed destination — the one kind that must carry the full
 *    number, because the bot has to type it into KBIZ.
 *
 * NOTE this is the type of an ALREADY-VALIDATED destination. What arrives on
 * disk is `unknown` until parseDestination below has proved it; sharing the
 * type buys us the field names, never trust in the JSON.
 */
export type QueueDestination = KbizDestination;

/**
 * The `transfer-other` queue-item shape, written by reimbursement's apps/api
 * and driven forward by kbiz-bot: reimbursement's own `KbizPaymentIntent`
 * (reimbursement/packages/shared/src/index.ts), with the two deliberate
 * loosenings this side of the boundary needs, plus the bot's own bookkeeping
 * timestamps. Both processes now compile against ONE declaration — a renamed
 * field is a build failure, not a silently stranded intent. See
 * reimbursement/docs/adr/0001-kbiz-transfer-automation.md.
 *
 * The loosenings (both widenings — this end never narrows what it trusts):
 *  - `destination` stays `unknown`. A malformed destination must FAIL the item
 *    with a clear error (parseDestination, at resolve time), not make the whole
 *    file unreadable — an unparseable file is skipped by listApproved and would
 *    sit "approved" forever while reimbursement shows the bundle stuck in
 *    `paying`.
 *  - `kbizCategoryId` stays `string`, not the contract's `KbizCategoryId`
 *    union: KBIZ owns those anchor ids, and an id we don't know about yet must
 *    reach the picker (or fail there), not be rejected by our own type.
 */
export interface TransferOtherQueueRequest extends Omit<KbizPaymentIntent, "destination" | "kbizCategoryId"> {
  /** Untrusted until parseDestination proves it. See the note above. */
  destination?: unknown;
  /** One of KBIZ's picker anchor ids, e.g. "10". */
  kbizCategoryId: string;
  /** Bot-side bookkeeping, written back into the same file. Not in the contract. */
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
}

/**
 * Validate + narrow a raw queue-file JSON blob into a TransferOtherQueueRequest.
 * apps/api writes this file over a shared filesystem mount — this is the
 * defensive boundary where we stop trusting it blindly and throw a
 * descriptive error naming the missing/malformed field, rather than crashing
 * deep inside the Playwright flow (or worse, silently doing the wrong thing
 * with `undefined`).
 */
export function parseTransferOtherRequest(raw: unknown): TransferOtherQueueRequest {
  if (!raw || typeof raw !== "object") throw new Error("transfer-other queue item is not a JSON object");
  const r = raw as Record<string, unknown>;
  const tag = typeof r.id === "string" && r.id ? r.id : "<unknown id>";

  if (typeof r.id !== "string" || !r.id) throw new Error('transfer-other queue item is missing "id"');
  if (r.type !== "transfer-other") {
    throw new Error(`${tag}: "type" is ${JSON.stringify(r.type)}, expected "transfer-other"`);
  }
  if (typeof r.bundleId !== "string" || !r.bundleId) throw new Error(`${tag}: missing "bundleId"`);

  // A destination supersedes payee.handle, so payee may legitimately be null
  // whenever one is present — its own validation happens in parseDestination,
  // where a bad value fails the item instead of hiding the whole file.
  const payee = r.payee as { handle?: unknown } | null | undefined;
  const hasDestination = r.destination !== undefined && r.destination !== null;
  if (!hasDestination && (!payee || typeof payee !== "object" || typeof payee.handle !== "string" || !payee.handle)) {
    throw new Error(`${tag}: missing "payee.handle"`);
  }
  if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0) {
    throw new Error(`${tag}: "amount" must be a positive finite number, got ${JSON.stringify(r.amount)}`);
  }
  if (typeof r.memo !== "string") throw new Error(`${tag}: missing "memo"`);
  if (typeof r.kbizCategoryId !== "string" || !r.kbizCategoryId) {
    throw new Error(`${tag}: missing "kbizCategoryId"`);
  }
  if (r.voucherFile !== undefined && typeof r.voucherFile !== "string") {
    throw new Error(`${tag}: "voucherFile" must be a string when present`);
  }
  const STATUSES = new Set(["approved", "running", "done", "failed", "needs-review"]);
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) {
    throw new Error(`${tag}: "status" is ${JSON.stringify(r.status)}, expected one of ${[...STATUSES].join(", ")}`);
  }

  return r as unknown as TransferOtherQueueRequest;
}

/** KBIZ account numbers render with dashes/spaces; both are pure formatting. */
const ACCOUNT_SEPARATORS = /[\s-]+/g;

/**
 * Validate a typed ("custom") account number: 8–15 digits once the separators
 * are stripped, and nothing else. Thai account numbers are 10 digits (12 for
 * some banks), so this rejects a truncated paste or a mistyped field without
 * pinning one bank's format.
 *
 * The number itself is NEVER echoed in the error — that string ends up in the
 * queue file, the approver's screen and Slack.
 */
export function normalizeCustomAccountNo(raw: string, tag: string): string {
  const stripped = raw.replace(ACCOUNT_SEPARATORS, "");
  if (!/^\d+$/.test(stripped)) {
    throw new Error(`${tag}: custom destination "accountNo" must be digits (with optional spaces/dashes)`);
  }
  if (stripped.length < 8 || stripped.length > 15) {
    throw new Error(`${tag}: custom destination "accountNo" must be 8–15 digits, got ${stripped.length}`);
  }
  return stripped;
}

/**
 * Validate + narrow the intent's `destination`. Every failure names the field,
 * because this is the one place a picker bug on reimbursement's side becomes
 * visible: the item fails with the message the approver reads.
 */
export function parseDestination(raw: unknown, tag = "destination"): QueueDestination {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${tag}: "destination" must be an object, got ${JSON.stringify(raw)}`);
  }
  const d = raw as Record<string, unknown>;
  const kind = typeof d.kind === "string" ? d.kind : "";

  const required = (key: string): string => {
    const v = d[key];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`${tag}: "${kind}" destination is missing "${key}"`);
    }
    return v.trim();
  };
  const optional = (key: string): string | undefined => {
    const v = d[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") throw new Error(`${tag}: destination "${key}" must be a string when present`);
    return v.trim() || undefined;
  };

  switch (kind) {
    case "handle":
      return { kind: "handle", handle: required("handle") };
    case "favorite": {
      const accountLast4 = required("accountLast4").replace(/\D+/g, "");
      if (accountLast4.length !== 4) {
        throw new Error(`${tag}: favorite destination "accountLast4" must be exactly 4 digits`);
      }
      return {
        kind: "favorite",
        nickname: required("nickname"),
        bank: required("bank"),
        accountLast4,
        accountName: optional("accountName"),
      };
    }
    case "custom":
      return {
        kind: "custom",
        bank: required("bank"),
        accountNo: normalizeCustomAccountNo(required("accountNo"), tag),
        accountName: optional("accountName"),
      };
    default:
      throw new Error(`${tag}: unknown destination kind ${JSON.stringify(d.kind)} — expected "handle", "favorite" or "custom"`);
  }
}

/** Resolve a payee-book handle into the flow's Payee. Never guesses a payee. */
function payeeForHandle(config: TransferConfig, handle: string): Payee {
  try {
    return toPayee(resolveRecipient(config, handle).recipient);
  } catch (e) {
    throw new Error(`Unknown payee handle "${handle}": ${(e as Error).message}`);
  }
}

/**
 * The intent's destination as the flow's Payee.
 *
 * `destination` wins whenever it is present — `payee.handle` is only the
 * fallback for intents written before the picker existed. A "favorite" gets
 * NO account number (the synced list is masked; the flow verifies against the
 * live picker by nickname + bank + last-4), and a "custom" gets the validated
 * digits it will type. Anything unrecognized throws, and the caller files the
 * item as failed — nothing has been submitted to KBIZ at this point.
 */
export function resolveQueuePayee(
  req: Pick<TransferOtherQueueRequest, "id" | "payee" | "destination">,
  config: TransferConfig,
): Payee {
  if (req.destination !== undefined && req.destination !== null) {
    const dest = parseDestination(req.destination, req.id);
    if (dest.kind === "favorite") {
      return {
        mode: "favorite",
        nickname: dest.nickname,
        bank: dest.bank,
        accountLast4: dest.accountLast4,
        accountName: dest.accountName,
      };
    }
    if (dest.kind === "custom") {
      return { mode: "custom", bank: dest.bank, accountNo: dest.accountNo, accountName: dest.accountName };
    }
    return payeeForHandle(config, dest.handle);
  }

  if (req.payee?.handle) return payeeForHandle(config, req.payee.handle);
  throw new Error(`${req.id}: intent carries neither a "destination" nor a "payee.handle" — nothing to pay.`);
}

/**
 * One-line destination for logs and Slack. A CUSTOM destination is shown as
 * bank + last 4 ONLY: it is the single kind carrying a full account number,
 * and Slack is not where that belongs. Never throws — a broken destination
 * still has to be reportable.
 */
export function describeDestination(req: Pick<TransferOtherQueueRequest, "payee" | "destination">): string {
  if (req.destination === undefined || req.destination === null) {
    return req.payee?.handle ? `handle "${req.payee.handle}"` : "no destination";
  }
  let dest: QueueDestination;
  try {
    dest = parseDestination(req.destination);
  } catch {
    return "unparseable destination";
  }
  if (dest.kind === "handle") return `handle "${dest.handle}"`;
  if (dest.kind === "favorite") return `favorite "${dest.nickname}" (${dest.bank} …${dest.accountLast4})`;
  return `custom (${dest.bank} …${dest.accountNo.slice(-4)})`;
}

/**
 * Resolve an intent-relative path (e.g. `voucherFile: "vouchers/<id>.html"`)
 * against the shared queue-dir root, refusing anything that would resolve
 * outside it. The queue file arrives over a filesystem mount written by a
 * different process — a stray `../../` in `voucherFile` should fail closed,
 * not read whatever path it happens to land on.
 */
export function resolveSharedPath(sharedDir: string, relPath: string): string {
  const root = resolve(sharedDir);
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error(`"${relPath}" resolves outside the shared dir (${root})`);
  }
  return target;
}

/** Basename of a captured slip file — the BASENAME-ONLY form `result.slipFile` contracts on. */
export function slipFileBasename(absSlipPath: string): string {
  return basename(absSlipPath);
}

/**
 * Batch processing order = the order the human queued the requests, not
 * UUID-lexicographic accident. Incident 2026-08-13: the approver requested
 * A then B, the bot (sorting by id) ran B first — B's push arrived and was
 * tapped, A's push starved, and the approver's mental model of "which
 * transfer is this?" was inverted on top of it. createdAt is written by
 * apps/api at intent creation and is required on every queue type; a record
 * somehow missing it sorts last, ties fall back to id so the order is total
 * and deterministic.
 */
export function requestOrderCompare(
  a: { id: string; createdAt?: string },
  b: { id: string; createdAt?: string },
): number {
  if (a.createdAt && b.createdAt && a.createdAt !== b.createdAt) {
    return a.createdAt < b.createdAt ? -1 : 1;
  }
  if (!!a.createdAt !== !!b.createdAt) return a.createdAt ? -1 : 1;
  return a.id.localeCompare(b.id);
}

/**
 * The Slack heads-up posted BEFORE the bot starts a second (or later) money
 * transfer in one batch, ahead of the deliberate pause. Phone-side truth from
 * the 2026-08-12/13/18 incidents (Winut, confirmed 2026-08-19): the
 * discriminator is not elapsed time but whether K BIZ was FOREGROUND on the
 * one approving phone at the moment of arming — a push armed while the app
 * is already open and waiting can raise NO banner at all. The pause plus this
 * warning is the countermeasure: give the operator time to background/close
 * the app BEFORE the next push exists, not just tell them a push is coming.
 * S2 in kbiz-fix-spec.md §3.1 — "leave it closed" is pinned by test.
 */
export function pauseBeforeArmMessage(args: {
  dest: string;
  /** Optional — a payroll workbook has no single sum to name (same loosening as deferredMessage's `amount`). */
  amount?: number;
  gapSeconds: number;
  position?: { position: number; total: number };
}): string {
  const seq = args.position ? ` ${args.position.position}/${args.position.total}` : "";
  const money = args.amount !== undefined ? `฿${args.amount.toFixed(2)} → ${args.dest}` : args.dest;
  return (
    `:double_vertical_bar: Pausing ${args.gapSeconds}s before transfer${seq} ` +
    `(${money}) — close or background the K BIZ app NOW and leave it closed ` +
    `until the TAP NEEDED ping, so the next approval push can raise a banner.`
  );
}

/**
 * Position of each transfer-other item within one batch snapshot, as
 * `id → { position, total }` counting ONLY the `transfer-other` items. This is
 * what lets the tap-needed alert say "transfer 2 of 2": in a back-to-back
 * batch the SECOND push arrives seconds after the first tap and the K BIZ app
 * shows no banner for it (incidents 2026-08-12 and 2026-08-13 — both
 * second-of-pair, both expired unseen), so the approver must be told there is
 * another tap coming.
 *
 * CORRECTION (this comment once claimed "sync / payroll items arm no phone
 * push", and then, wrongly again, that `add-payroll` was push-free): BOTH
 * payroll types arm a phone push. `transfer-payroll`'s Confirm click sends the
 * mobile notification (transfer-payroll-flow.ts), and `add-payroll`'s Next
 * click does the same — KBIZ answers it with the review screen that reads "A
 * notification has been sent to the K BIZ application", and the flow then
 * waits in waitForMobileConfirmation for up to 5 min (add-payroll-flow.ts).
 * Only `list-favorites` and `list-registered` are genuinely push-free.
 *
 * Positions still count transfer-other only, because "transfer 2/2" is about
 * the money items the approver is being asked to tap for in the reimbursement
 * flow — but the ARM GATE in process-queue.ts covers all three arming types,
 * and must: a mixed batch could otherwise hold two live pushes at once, and a
 * push armed seconds after a tap raises no banner. See lib/arm-gate.ts.
 */
export function transferOtherPositions(
  batch: ReadonlyArray<{ id: string; type: string }>,
): Map<string, { position: number; total: number }> {
  const ids = batch.filter((item) => item.type === "transfer-other").map((item) => item.id);
  const out = new Map<string, { position: number; total: number }>();
  ids.forEach((id, i) => out.set(id, { position: i + 1, total: ids.length }));
  return out;
}

/**
 * The Slack line posted the moment a phone push is ARMED (Next clicked, the
 * bank's ~6-minute countdown running). Deliberately distinct from the
 * ":hourglass: Running…" claim message, which fires ~30–60 s before the push
 * exists and says nothing about tapping. Destination arrives already masked
 * (describeDestination) — never pass a full account number in.
 *
 * The old batch-size gate (only warn when the total in the batch exceeded
 * one) is GONE (kbiz-fix-spec.md §0.5 / IMPL-C worksheet). 2026-08-18 run B
 * was a batch of one, so that gate stripped the ping of the one sentence
 * describing the operator's actual situation — and the sentence itself was
 * wrong: the diagnosis-confirmed trigger (user testimony, 2026-08-19) is the
 * K BIZ app being FOREGROUND at arming, not the transfer being second in a
 * batch. A lone transfer approved seconds after the operator's own last tap
 * on an unrelated request is just as exposed as a batch item, so every ping
 * now carries the warning.
 */
export function tapNeededMessage(args: {
  id: string;
  dest: string;
  amount: number;
  position?: { position: number; total: number };
}): string {
  const seq = args.position ? ` ${args.position.position}/${args.position.total}` : "";
  return (
    `:iphone: *TAP NEEDED NOW* — approve \`${args.id}\` in the K BIZ app ` +
    `(transfer${seq}, ฿${args.amount.toFixed(2)} → ${args.dest}). The push expires in ~6 min. ` +
    `Keep K BIZ CLOSED until this ping: a push armed while the app is already OPEN in the ` +
    `foreground can raise NO banner at all (2026-08-12/13/18). If you see nothing, close K BIZ ` +
    `completely, reopen it, and look under อนุมัติรายการ.`
  );
}

export type TransferOtherQueuePatch = {
  status: "done" | "failed" | "needs-review";
  result: NonNullable<TransferOtherQueueRequest["result"]>;
};

/**
 * What runTransferOtherFlow (or a pre-flight check before it ever runs)
 * reported. `outcome` widened to the full `TransferFailureOutcome` (Seam A,
 * kbiz-fix-spec.md §1.1/§1.6) — the narrow `"confirmed-failed" | "unconfirmed"`
 * redeclaration this used to carry is DELETED on purpose: it was a second,
 * unsynchronized copy of the same vocabulary approval-wait.ts already owns,
 * and it is exactly the kind of narrow local type that would have silently
 * rejected `push-expired` at the queue boundary instead of at compile time.
 */
export interface FlowOutcomeInput {
  success: boolean;
  /** Only meaningful when `success` is false; absent = failed before the phone push was armed. */
  outcome?: TransferFailureOutcome;
  error?: string;
  reference?: string;
  finalUrl?: string;
  slipFile?: string;
}

/**
 * Map a flow outcome to the queue-file patch the bot writes back. Pure so the
 * four-way success / confirmed-failed / push-expired / unconfirmed split
 * (money-safety decision 3 in docs/adr/0001-kbiz-transfer-automation.md,
 * amended 2026-08-19 for the fourth member) can be unit-tested without a
 * browser.
 *
 * An exhaustive switch on purpose (inv:contract's 22-branch audit found
 * exactly one compile gate in the whole vocabulary before this — this is the
 * second): a future outcome member that isn't taught here is now a TS error,
 * not a silent fall-through to "confirmed-failed" (a RETRYABLE verdict).
 *
 * A failure with no `outcome` at all — payee resolution, the ceiling check,
 * anything that failed before Next was ever clicked — is filed the same as
 * `confirmed-failed`: nothing moved, safe to retry. `unconfirmed` (timed out
 * / crashed after the phone push was armed, or armed-but-unverified) is
 * routed to `needs-review`, which reimbursement never auto-retries.
 *
 * `push-expired` gets `failed` — the SAME bundle path as `confirmed-failed`
 * (queue `failed` → reimbursement returns the bundle to APPROVED, no `force`
 * needed) — because the bank's own expiry modal, corroborated by the
 * EXPIRY_CONFIRM_MS grace and the absence of a live-push block
 * (approval-wait.ts), means the window closed with no tap seen: nothing
 * moved, safe to retry, exactly like a bank rejection. It is deliberately NOT
 * `needs-review`: unlike a genuine timeout, the bank has already resolved
 * this one, and the operator deserves that honest Thai copy (Q1) rather than
 * "may or may not have gone through". It gets its OWN `result.outcome` (not
 * reused as `confirmed-failed`) so the audit trail, the poller's Slack/portal
 * copy and any future money-path reasoning can tell "the bank actively
 * rejected this" apart from "the bank's window elapsed unconfirmed" — see
 * kbiz-fix-spec.md §2.1 for why reusing either existing member was rejected.
 */
export function mapFlowOutcomeToPatch(flow: FlowOutcomeInput, finishedAt: string = new Date().toISOString()): TransferOtherQueuePatch {
  if (flow.success) {
    return {
      status: "done",
      result: { outcome: "success", reference: flow.reference, slipFile: flow.slipFile, finalUrl: flow.finalUrl, finishedAt },
    };
  }
  // SPEC REVIEW FINDING 8 (2026-08-19): `reference` used to be carried only
  // on the success arm above — every failure branch here now keeps it too
  // (it is on FlowOutcomeInput precisely so IMPL-D's failure-arm reference,
  // e.g. on the push-expired→unconfirmed downgrade, reaches the queue file
  // and the poller as structured data, not only inside the Thai `error`
  // prose).
  switch (flow.outcome) {
    case "unconfirmed":
      return {
        status: "needs-review",
        result: {
          outcome: "unconfirmed",
          error: flow.error,
          reference: flow.reference,
          slipFile: flow.slipFile,
          finalUrl: flow.finalUrl,
          finishedAt,
        },
      };
    case "push-expired":
      return {
        status: "failed",
        result: {
          outcome: "push-expired",
          error: flow.error,
          reference: flow.reference,
          slipFile: flow.slipFile,
          finalUrl: flow.finalUrl,
          finishedAt,
        },
      };
    case "confirmed-failed":
    case undefined:
      return {
        status: "failed",
        result: {
          outcome: "confirmed-failed",
          error: flow.error,
          reference: flow.reference,
          slipFile: flow.slipFile,
          finalUrl: flow.finalUrl,
          finishedAt,
        },
      };
    default: {
      // Compile-time exhaustiveness: if TransferOutcome ever grows a fifth
      // member without a corresponding case above, `flow.outcome` stops being
      // assignable to `never` here and `bun run typecheck` fails — the same
      // guard kbiz-poller.ts's HANDLED_OUTCOMES gives the other repo (Seam C).
      const _never: never = flow.outcome;
      throw new Error(`unhandled flow outcome ${String(_never)}`);
    }
  }
}

/**
 * KBIZ's exact-duplicate confirmation dialog (same payee + same amount as an
 * earlier transaction), seen 0 of 9 production arms but user-verified
 * 2026-08-19 to precede the push. "no-prior-attempt" / "prior-attempt" decide
 * decideDuplicateConfirm's verdict; "unknown-bundle" / "scan-failed" are the
 * two ways the bot cannot even ASK the question and so must fail closed.
 */
export type DuplicateReason = "no-prior-attempt" | "prior-attempt" | "unknown-bundle" | "scan-failed";

/** One other attempt already on record, as read off the queue/archive (any status — see readPriorAttempts). */
export interface PriorAttempt {
  id: string;
  bundleId?: string;
  status?: string;
  outcome?: string;
  /**
   * Normalized, already-masked description of the payment destination (see
   * `destinationSignature`) — used ONLY to compare "is this the same money as
   * a DIFFERENT bundle" (money review finding 2). Never a full account
   * number.
   */
  destinationKey?: string;
  amount?: number;
  /**
   * Epoch ms of the sibling intent's own `createdAt`, when parseable — bounds
   * the cross-bundle same-money check below (SAME_MONEY_WINDOW_MS). Absent ⇒
   * age cannot be proven, so decideDuplicateConfirm treats it as still inside
   * the window (fail-closed, same direction as every other "cannot tell"
   * branch in this function).
   */
  createdAt?: number;
}

/**
 * How far back the cross-bundle same-destination-+-same-amount check (money
 * review finding 2) looks before a prior attempt stops blocking KBIZ's
 * duplicate popup. 2026-08-19, second fix round (money review finding 6):
 * the check originally scanned the FULL archive with no bound at all, which
 * fail-closed but meant a recurring same-payee/same-amount payment (e.g.
 * monthly rent) would be HELD on every single occurrence, forever, and the
 * per-item scan cost grew with the archive's lifetime size.
 *
 * 14 days, not a shorter or a KBIZ-observed number: there is no live
 * evidence of the bank's own duplicate-detection window (the popup is 0 of 9
 * production arms — see decideDuplicateConfirm's own doc comment), so this
 * is a deliberately generous operator-side default, not a tuned one. It
 * comfortably covers the realistic "approver gets a bundle stuck at
 * unconfirmed, resolves it in K BIZ over a day or two, then re-files the
 * same receipt" recovery cycle this guard exists to catch, while still
 * expiring well before the next month's recurring payment falls due.
 * Revise only against real evidence, the same rule TAP_COOLDOWN_MS is held
 * to (ADR 0001 Amendment 7 item 4) — do not shorten this to "feel" less
 * strict.
 */
export const SAME_MONEY_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * A resilient, ALWAYS-MASKED one-line signature of a queue item's payment
 * destination, for the cross-bundle duplicate check below. Deliberately more
 * lenient than `parseDestination`: it must also work on an ARCHIVED intent,
 * where reimbursement's `redactArchivedAccountNo` (apps/api/src/kbiz.ts) has
 * already replaced a "custom" destination's `accountNo` with `accountLast4`
 * — `parseDestination`'s `required("accountNo")` would THROW on exactly that
 * shape. Never throws; returns `undefined` when nothing usable is present
 * (an unparseable destination is simply not comparable, not a scan failure).
 */
export function destinationSignature(raw: Record<string, unknown>): string | undefined {
  const d = raw.destination;
  if (d && typeof d === "object") {
    const dest = d as Record<string, unknown>;
    const kind = typeof dest.kind === "string" ? dest.kind : "";
    const bank = typeof dest.bank === "string" ? dest.bank.trim().toLowerCase() : "";
    if (kind === "custom") {
      const fromFull = typeof dest.accountNo === "string" ? dest.accountNo.replace(/\D+/g, "").slice(-4) : "";
      const fromLast4 = typeof dest.accountLast4 === "string" ? dest.accountLast4.replace(/\D+/g, "") : "";
      const last4 = fromFull || fromLast4;
      return last4 ? `custom:${bank}:${last4}` : undefined;
    }
    if (kind === "favorite") {
      const last4 = typeof dest.accountLast4 === "string" ? dest.accountLast4.replace(/\D+/g, "") : "";
      const nickname = typeof dest.nickname === "string" ? dest.nickname.trim() : "";
      return last4 || nickname ? `favorite:${bank}:${nickname}:${last4}` : undefined;
    }
    if (kind === "handle") {
      const handle = typeof dest.handle === "string" ? dest.handle.trim() : "";
      return handle ? `handle:${handle}` : undefined;
    }
  }
  const payee = raw.payee;
  if (payee && typeof payee === "object") {
    const handle = (payee as Record<string, unknown>).handle;
    if (typeof handle === "string" && handle.trim()) return `handle:${handle.trim()}`;
  }
  return undefined;
}

/** `\`id\` (outcome)` / `\`id\` (status)` / `\`id\`` — the detail string named in Q6/S4. */
function describePriorAttempt(a: PriorAttempt): string {
  return `\`${a.id}\`${a.outcome ? ` (${a.outcome})` : a.status ? ` (${a.status})` : ""}`;
}

/**
 * Pure. May the bot press ยืนยัน on KBIZ's duplicate popup?
 *
 * ONLY when the archive scan succeeded, this bundle has NO prior attempt on
 * record, AND no OTHER bundle has a prior attempt at the same destination +
 * amount — strict on purpose, regardless of what the prior attempt's own
 * recorded outcome was (see the "confirmed-failed still refuses" test).
 *
 * Rationale (inv:evidence GAP 2, kbiz-fix-spec.md §2.2): KBIZ's duplicate
 * check keys on a transaction that ACTUALLY WENT THROUGH, not on a prior
 * attempt existing — which is why the popup never fired in 3/3 exact-amount
 * retry arms whose predecessors moved ฿0 (a `confirmed-failed` or
 * `push-expired` predecessor). So "popup + an earlier attempt that could be
 * this same money" is the bank telling us the earlier attempt PAID, no
 * matter what our own queue record says it did — trusting our own record
 * over the bank's live popup here is exactly the double-pay path.
 *
 * MONEY REVIEW FINDING 2 (2026-08-19): the bundle-only check above is
 * defeated whenever the SAME money is represented by a DIFFERENT bundle — an
 * approver who gives up on a stuck `unconfirmed` bundle and re-files the same
 * receipt gets a brand-new bundle id, and the original bundle-scoped guard
 * would auto-confirm the popup with `reason:"no-prior-attempt"` even though
 * the bank is telling us THIS EXACT payee+amount already paid. So a second,
 * independent check: any prior attempt at the same masked destination + the
 * same amount, under ANY bundle, AND within the last SAME_MONEY_WINDOW_MS
 * (money review finding 6 — unbounded would HELD a recurring same-payee/
 * same-amount payment, e.g. monthly rent, forever), blocks too.
 * `destinationKey`/`amount` are optional on the caller's own request — when
 * either is missing (a scan that could not compute one, or an old-shaped
 * record) this check is simply skipped, never treated as a match; the
 * bundle-scoped check above still applies in full. A candidate match with no
 * parseable `createdAt`, OR a caller that omits `now` entirely, is treated as
 * still inside the window — the window exists to relieve friction, never to
 * open a gap a missing timestamp (or a caller that forgot to pass `now`)
 * could walk through.
 *
 * "Popup + genuinely nothing on record either way" is the benign case this
 * auto-confirm exists for: two different bundles/receipts that happen to
 * share a payee and an amount but have no actual attempt history together —
 * including the SAME payee+amount more than SAME_MONEY_WINDOW_MS apart.
 *
 * `priorAttempts` is filtered again HERE (defense in depth) rather than
 * trusted pre-filtered from the caller — this is the one function whose
 * wrong answer double-pays, so it does not lean on the caller's fs scan
 * having filtered correctly.
 */
export function decideDuplicateConfirm(args: {
  bundleId: string | undefined;
  scanOk: boolean;
  priorAttempts: ReadonlyArray<PriorAttempt>;
  destinationKey?: string;
  amount?: number;
  /**
   * Epoch ms "now" — bounds the cross-bundle same-money check against
   * `SAME_MONEY_WINDOW_MS`. Optional and fail-closed: omitted ⇒ the window
   * is not applied at all, i.e. every same-destination-+-amount match blocks
   * regardless of age (the pre-2026-08-19-second-round behavior).
   */
  now?: number;
}): { confirm: boolean; reason: DuplicateReason; detail?: string } {
  if (!args.bundleId) return { confirm: false, reason: "unknown-bundle" };
  if (!args.scanOk) return { confirm: false, reason: "scan-failed" };

  const sameBundle = args.priorAttempts.find((a) => a.bundleId === args.bundleId);
  if (sameBundle) return { confirm: false, reason: "prior-attempt", detail: describePriorAttempt(sameBundle) };

  if (args.destinationKey !== undefined && args.amount !== undefined) {
    const sameMoney = args.priorAttempts.find(
      (a) =>
        a.destinationKey !== undefined &&
        a.destinationKey === args.destinationKey &&
        a.amount === args.amount &&
        (a.createdAt === undefined || args.now === undefined || args.now - a.createdAt < SAME_MONEY_WINDOW_MS),
    );
    if (sameMoney) {
      return {
        confirm: false,
        reason: "prior-attempt",
        detail: `${describePriorAttempt(sameMoney)} — same destination + amount, bundle ${sameMoney.bundleId ?? "?"}`,
      };
    }
  }

  return { confirm: true, reason: "no-prior-attempt" };
}

/**
 * `result.error` text for a REFUSED duplicate popup (Q6, kbiz-fix-spec.md
 * §3.2) — reimbursement stores this verbatim as `bundle.paymentError` and
 * renders it to the approver, so it MUST start with "HELD: " (the word that
 * has to survive a skim-read next to a Retry button — same rule
 * deferredErrorText in arm-gate.ts lives by) and must never carry a full
 * account number.
 *
 * SPEC REVIEW FINDING 3 (2026-08-19): branches on `reason` instead of always
 * assuming a `prior-attempt` refusal with a named detail. `detail` is
 * `undefined` for `scan-failed` (any `readdir(QUEUE_DIR)` failure) and
 * `unknown-bundle` (EVERY manual `transfer-other -- --confirm` run — that CLI
 * passes no `duplicatePolicy` at all) — both reachable, neither exercised by
 * the original test suite. The old code substituted a placeholder string
 * ("(no detail — see the queue archive)") for a MISSING detail, asserting "a
 * prior attempt is on record" when the truth is "the bot could not even
 * check" — a different, more honest sentence for each case instead.
 */
export function duplicateHeldText(reason: DuplicateReason, detail?: string): string {
  if (reason === "prior-attempt") {
    return (
      `HELD: ธนาคารแจ้งว่ารายการนี้ (ผู้รับและจำนวนเงินเดียวกัน) ถูกทำไปแล้ว ` +
      `และคำขอนี้เคยถูกส่งไปก่อนหน้านี้ (${detail}) — บอทจึงไม่กดยืนยัน และไม่มีการโอนในครั้งนี้ ` +
      `ให้เปิดแอป K BIZ ดู "ประวัติทำรายการ" ว่าครั้งก่อนโอนออกไปจริงหรือไม่ ` +
      `ถ้าโอนแล้วให้กด "ยืนยันว่าโอนแล้ว (แนบสลิป)" ห้ามกดจ่ายซ้ำก่อนตรวจ`
    );
  }
  const why =
    reason === "scan-failed"
      ? "บอทตรวจประวัติคำขอนี้ในคิวไม่ได้"
      : "คำขอนี้ไม่มีหมายเลข bundle ให้ตรวจประวัติ";
  return (
    `HELD: KBIZ แจ้งว่ารายการนี้ (ผู้รับและจำนวนเงินเดียวกัน) ถูกทำไปแล้ว แต่${why} ` +
    `จึงไม่กดยืนยัน และไม่มีการโอนในครั้งนี้ ให้เปิดแอป K BIZ ดู "ประวัติทำรายการ" ว่ามีรายการนี้จริงหรือไม่ ` +
    `ถ้าโอนแล้วให้กด "ยืนยันว่าโอนแล้ว (แนบสลิป)" ห้ามกดจ่ายซ้ำก่อนตรวจ`
  );
}

/**
 * The Slack line for KBIZ's duplicate popup, confirmed or refused (S3/S4,
 * kbiz-fix-spec.md §3.1). `id`/`bundleId` are never account numbers; `detail`
 * (refused case) is duplicateHeldText's own detail string, already scrubbed.
 *
 * SPEC REVIEW FINDING 3 (2026-08-19): the refused branch used to interpolate
 * `${args.detail}` unguarded — on `scan-failed`/`unknown-bundle` (`detail`
 * undefined) that rendered a literal "undefined is already on record for
 * bundle …" into Slack. Branches on `reason` the same way duplicateHeldText
 * does now.
 */
export function duplicatePopupMessage(args: {
  id: string;
  bundleId?: string;
  confirmed: boolean;
  reason: DuplicateReason;
  detail?: string;
}): string {
  if (args.confirmed) {
    return (
      `:warning: KBIZ flagged \`${args.id}\` as a DUPLICATE (same payee + same amount as an ` +
      `earlier transaction) and asked for a second confirmation. Bundle ${args.bundleId} has no ` +
      `earlier attempt on record, so the bot pressed ยืนยัน — the push is being armed now. If this ` +
      `was not intended, do NOT tap it; let it expire.`
    );
  }
  const because =
    args.reason === "prior-attempt"
      ? `${args.detail} is already on record for bundle ${args.bundleId}`
      : args.reason === "scan-failed"
        ? `it could not scan the queue archive to check`
        : `this request carries no bundle id to check against`;
  return (
    `:no_entry: KBIZ flagged \`${args.id}\` as a DUPLICATE (same payee + same amount as an earlier ` +
    `transaction). The bot did NOT confirm — ${because}. Nothing was submitted. KBIZ only flags a ` +
    `transaction that ACTUALLY WENT THROUGH, so open K BIZ → ประวัติทำรายการ and check whether that ` +
    `earlier attempt paid before touching this again.`
  );
}
