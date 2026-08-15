/**
 * The one-push-at-a-time decision logic: PURE. No fs, no network, no
 * playwright — arm-lock.ts does the disk, process-queue.ts does the acting,
 * and this file decides. Everything here is unit-testable with a plain number
 * for `now`, which is the whole point: the money invariant it encodes ("at
 * most one live approval push in the estate, ever") must be provable without
 * a browser and without waiting 6.5 real minutes.
 *
 * WHY (the two incidents, 2026-08-12 + 2026-08-13): KBIZ's approval push
 * lives SERVER-SIDE at the bank, not in our browser session. Every early exit
 * of the post-Next wait loop — session death, KBIZ's generic error page, an
 * outright crash — leaves that push tappable for minutes while the batch loop
 * happily arms the next one. Two live pushes, one phone, no banner for the
 * second (live-verified: a push armed seconds after the previous tap never
 * surfaces at all), and an operator-visible "Retry" button pointed straight at
 * the same money. That is the double-pay path this file closes.
 *
 * Root CI runs `bun test` BEFORE kbiz-bot's node_modules exist
 * (.github/workflows/deploy.yml) — this file must never import "playwright".
 * The `import type` below is erased at transpile (same precedent as
 * transfer-other-queue.ts:3); anything else from the flows tree would drag
 * the browser stack in and break root CI while passing locally.
 */

import type { TransferOutcome } from "../flows/transfer-other-flow"; // type-only, erased
import { PUSH_LIFETIME_MS } from "./approval-wait";

/**
 * How long before the Next click we start assuming a push might exist. The
 * lock is written BEFORE the flow runs (we cannot write it from inside the
 * click), so between the write and the click there is a window of form-filling
 * — picker, amount, memo, category, attachment — that a crash can land in.
 * 4 min comfortably covers the slowest observed fill; the conservative lock is
 * only ever READ after a crash, so over-estimating costs a bounded wait, never
 * a wrong payment.
 */
export const CONSERVATIVE_PRE_ARM_MS = 4 * 60_000;
/** Worst case a crashed run can hold the estate: pre-arm window + push life. */
export const CONSERVATIVE_TOTAL_MS = CONSERVATIVE_PRE_ARM_MS + PUSH_LIFETIME_MS; // 10.5 min

/**
 * The on-disk record of the ONE outstanding push. Written by arm-lock.ts,
 * never deleted — `state: "released"` is how a lock ends, so there is no
 * ENOENT race and the file doubles as an audit trail of what armed when.
 */
export interface ArmLock {
  intentId: string;
  /** ISO. Conservative record: the moment we decided to arm, not the click. */
  armedAt: string;
  /** ISO. Nothing may arm before this instant. */
  pushExpiresAt: string;
  state: "armed" | "released";
  resolution?: TransferOutcome | "never-armed";
  updatedAt: string;
}

/**
 * What the lock file means right now.
 *
 * NOTE `armedAt` on the live variant is an ADDITION to the shape in
 * kbiz-interfaces.md B1: optional, purely so the operator messages that
 * section D5 specifies verbatim ("an approval push armed at 01:24:31Z may
 * still be live until …") can actually be produced. No declared member
 * changed; every consumer that ignores it is unaffected.
 */
export type LockView =
  | { live: false; source: "none" | "released" | "expired" | "corrupt-unknown" }
  | { live: true; until: number; source: "parsed" | "corrupt-mtime"; armedAt?: number };

function isArmLock(v: unknown): v is ArmLock {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.intentId === "string" &&
    typeof r.armedAt === "string" &&
    typeof r.pushExpiresAt === "string" &&
    (r.state === "armed" || r.state === "released")
  );
}

/**
 * Pure. `text` / `mtimeMs` come from arm-lock.ts's readArmLockRaw.
 *
 * Live iff `state === "armed" && now < pushExpiresAt`. The comparison is
 * STRICT: at exactly pushExpiresAt the bank's window has elapsed, so the push
 * is dead and the next item arms. Pinned by test.
 *
 * A corrupt/unparseable file is treated as LIVE until `mtime +
 * CONSERVATIVE_TOTAL_MS` — a half-written or hand-edited lock must not become
 * a licence to arm. With no mtime either (stat failed) there is nothing to
 * bound the hold with, so it reports `corrupt-unknown`: not live, and the
 * caller warns loudly. Bounded either way — a corrupt file can never wedge the
 * bot permanently.
 */
export function parseArmLock(text: string | null, mtimeMs: number | null, now: number): LockView {
  const corrupt = (): LockView => {
    if (mtimeMs === null) return { live: false, source: "corrupt-unknown" };
    const until = mtimeMs + CONSERVATIVE_TOTAL_MS;
    return now < until ? { live: true, until, source: "corrupt-mtime" } : { live: false, source: "expired" };
  };

  if (text === null) {
    // A TRULY missing file (readArmLockRaw's readFileSync AND statSync both
    // failed — overwhelmingly ENOENT) has no mtime either, and that is the
    // common "no push outstanding" case: "none". But readFileSync catches
    // every errno, not just ENOENT — a PRESENT file that is unreadable
    // (EACCES after a container restart under a different UID, a transient
    // read error, …) still has a real mtime from statSync. That is not "no
    // lock", it is an unparseable one, and must take the same conservative
    // mtime bound as corrupt JSON below — arming on top of an existing lock
    // file just because we couldn't read its bytes is exactly the fail-open
    // gap this function exists to close.
    return mtimeMs === null ? { live: false, source: "none" } : corrupt();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return corrupt();
  }
  if (!isArmLock(parsed)) return corrupt();
  if (parsed.state === "released") return { live: false, source: "released" };

  const until = Date.parse(parsed.pushExpiresAt);
  if (!Number.isFinite(until)) return corrupt();
  if (now >= until) return { live: false, source: "expired" };
  const armedAt = Date.parse(parsed.armedAt);
  return { live: true, until, source: "parsed", armedAt: Number.isFinite(armedAt) ? armedAt : undefined };
}

/**
 * The previous MONEY item in this batch. "not-armed" is the distinction the
 * queue patch cannot make (DEFECT C): a mis-typed payee handle and a
 * bank-confirmed rejection both file as `failed`/`confirmed-failed`, but only
 * the second one spent the operator's attention. Holding a batch for the first
 * would be pure friction.
 */
export type PrevMoneyItem =
  | { kind: "none" }
  | { kind: "not-armed"; id: string }
  | { kind: "armed"; id: string; outcome: TransferOutcome };

export type DeferCode = "push-may-be-live" | "prev-unconfirmed" | "prev-confirmed-failed";

/** `armedAt` is the same optional addition documented on LockView. */
export type ArmDecision =
  | { kind: "arm"; gapMs: number }
  | { kind: "defer"; code: DeferCode; until?: number; prevId?: string; armedAt?: number };

/**
 * Pure. Order: lock first, then previous-outcome. Exactly the D2 table:
 *
 *   prev            lock live   decision
 *   ─────────────────────────────────────────────────────────
 *   any             yes         defer  push-may-be-live
 *   none            no          arm    gap 0
 *   not-armed       no          arm    gap 0
 *   armed/success   no          arm    gap INTER_TRANSFER_GAP_MS
 *   armed/failed    no          defer  prev-confirmed-failed
 *   armed/unconfirm no          defer  prev-unconfirmed
 *
 * Bank confirmation IS the operator ack: the gap only means anything if the
 * previous push actually resolved, so anything short of a confirmed outcome
 * hands the batch back to the human instead of arming into the dark.
 *
 * `now` is accepted so a whole gate decision is taken against ONE clock
 * reading (the caller passes the same value to parseArmLock); the live/expired
 * judgement it drives has already been folded into `lock` by the time we get
 * here, which is why nothing below reads it.
 */
export function decideArm(input: {
  prev: PrevMoneyItem;
  lock: LockView;
  now: number;
  gapMs: number;
}): ArmDecision {
  if (input.lock.live) {
    return { kind: "defer", code: "push-may-be-live", until: input.lock.until, armedAt: input.lock.armedAt };
  }
  const prev = input.prev;
  if (prev.kind === "none" || prev.kind === "not-armed") return { kind: "arm", gapMs: 0 };
  if (prev.outcome === "success") return { kind: "arm", gapMs: input.gapMs };
  if (prev.outcome === "confirmed-failed") return { kind: "defer", code: "prev-confirmed-failed", prevId: prev.id };
  return { kind: "defer", code: "prev-unconfirmed", prevId: prev.id };
}

/** "01:31:01Z" — the operator reads this off a Slack line, not a log parser. */
function clockUtc(ms: number): string {
  return `${new Date(ms).toISOString().slice(11, 19)}Z`;
}

/** "4m12s" / "48s" — how much of the bank's window is left. */
function humanDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return m > 0 ? `${m}m${String(s).padStart(2, "0")}s` : `${s}s`;
}

type Defer = Extract<ArmDecision, { kind: "defer" }>;

/**
 * The `result.error` text written into the queue file. MUST start with
 * "HELD: " — reimbursement stores it as `bundle.paymentError` and shows it to
 * the approver verbatim, and "HELD" is the word that has to survive being
 * skim-read next to a Retry button. Never carries an account number (the
 * masked destination lives in the Slack line, not here).
 */
export function deferredErrorText(d: Defer, now: number): string {
  const prev = d.prevId ? ` (\`${d.prevId}\`)` : "";
  switch (d.code) {
    case "push-may-be-live": {
      const armed = d.armedAt !== undefined ? `armed at ${clockUtc(d.armedAt)} ` : "";
      const until = d.until !== undefined ? `until ${clockUtc(d.until)} (≈${humanDuration(d.until - now)})` : "for a few more minutes";
      return (
        `HELD: an approval push ${armed}may still be live ${until} — nothing was submitted for this request. ` +
        `Do not tap a stale push, and do not pay again before then.`
      );
    }
    case "prev-confirmed-failed":
      return (
        `HELD: KBIZ rejected the previous transfer${prev}, so no second push was armed. ` +
        `Nothing was submitted for this request — check the previous one in K BIZ, then pay this one again.`
      );
    case "prev-unconfirmed":
      return (
        `HELD: the previous transfer${prev} did not confirm at the bank, so no second push was armed. ` +
        `Nothing was submitted for this request — resolve the previous one in K BIZ first, then pay this one again.`
      );
  }
}

/**
 * The Slack line for a deferred item. `dest` arrives ALREADY masked
 * (describeDestination) — never pass a full account number in; this is the
 * same rule pauseBeforeArmMessage / tapNeededMessage live by.
 *
 * `amount` is optional (kbiz-interfaces.md B1 types it as required, but B3
 * instruction 3 says a transfer-payroll defer "omits the amount" — a payroll
 * item has no single sum to name). Every money item still passes one.
 */
export function deferredMessage(args: {
  id: string;
  dest: string;
  amount?: number;
  position?: { position: number; total: number };
  decision: Defer;
  now: number;
}): string {
  const bits: string[] = [];
  if (args.position) bits.push(`transfer ${args.position.position}/${args.position.total}`);
  bits.push(args.amount !== undefined ? `฿${args.amount.toFixed(2)} → ${args.dest}` : args.dest);

  const d = args.decision;
  let why: string;
  if (d.code === "push-may-be-live") {
    const armed = d.armedAt !== undefined ? `armed at ${clockUtc(d.armedAt)} ` : "";
    const until =
      d.until !== undefined ? `until ${clockUtc(d.until)} (≈${humanDuration(d.until - args.now)})` : "for a few more minutes";
    why =
      `An approval push ${armed}may still be live ${until}. ` +
      `Do NOT tap a stale push, and do NOT pay again before then.`;
  } else if (d.code === "prev-confirmed-failed") {
    why =
      `KBIZ rejected the previous transfer${d.prevId ? ` \`${d.prevId}\`` : ""}, so no second push was armed. ` +
      `This request is back to approved — pay it again when you're ready.`;
  } else {
    why =
      `${d.prevId ? `\`${d.prevId}\`` : "The previous transfer"} did not confirm at the bank, so no second push was armed. ` +
      `Resolve it in K BIZ first; this request is back to approved — pay it again when you're ready.`;
  }

  return `:no_entry: HELD \`${args.id}\` (${bits.join(", ")}) — NOT started, nothing submitted. ${why}`;
}

/**
 * Appended to the existing `⚠️ needs-review` Slack line when the flow came
 * back with `pushMayBeLive`. The guidance is deliberately NOT "ignore it": a
 * live push tapped now is a real, resolvable payment. The danger is paying
 * AGAIN on top of it.
 */
export function livePushWarning(pushExpiresAt: number): string {
  return (
    `\n⚠ THE APPROVAL PUSH MAY STILL BE LIVE until ${clockUtc(pushExpiresAt)} — if you tap it, ` +
    `close this with "โอนแล้ว" + the e-slip. Do NOT hit Retry before then.`
  );
}

/**
 * The lock written BEFORE the flow runs, when no push exists yet and none may
 * be assumed dead. Its expiry is only ever consulted after a crash.
 */
export function conservativeLock(intentId: string, now: number): ArmLock {
  const iso = new Date(now).toISOString();
  return {
    intentId,
    armedAt: iso,
    pushExpiresAt: new Date(now + CONSERVATIVE_TOTAL_MS).toISOString(),
    state: "armed",
    updatedAt: iso,
  };
}

/** The refinement written the instant Next is clicked: the real 6.5-min window. */
export function armedLock(intentId: string, armedAtMs: number): ArmLock {
  return {
    intentId,
    armedAt: new Date(armedAtMs).toISOString(),
    pushExpiresAt: new Date(armedAtMs + PUSH_LIFETIME_MS).toISOString(),
    state: "armed",
    updatedAt: new Date(armedAtMs).toISOString(),
  };
}

/**
 * End of a lock. Written, never deleted — the next reader sees "released"
 * rather than ENOENT, which is one fewer ambiguity on the money path.
 */
export function releasedLock(prev: ArmLock, resolution: NonNullable<ArmLock["resolution"]>, now: number): ArmLock {
  return { ...prev, state: "released", resolution, updatedAt: new Date(now).toISOString() };
}
