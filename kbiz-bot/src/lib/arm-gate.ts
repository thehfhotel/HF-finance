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
 * How long the NEXT push waits after the previous one resolved, so the
 * operator has a window to leave the K BIZ app before the next one fires.
 * Renamed from `INTER_TRANSFER_GAP_MS` (was declared in process-queue.ts,
 * spent nowhere that ever executed — see below), value UNCHANGED, and now the
 * one true cooldown length: `decideArm`'s caller passes this as `gapMs` for
 * BOTH the in-batch row and the cross-poll released-lock rows.
 *
 * 2026-08-19: the discriminating variable across all 9 ad-hoc transfers plus
 * the operator's own manual back-to-back reproduction is whether the K BIZ
 * app was FOREGROUND on the single approving phone at the moment of arming —
 * NOT elapsed time. A user-verified second push, armed <1 min after the
 * previous tap, SURFACED normally with the app backgrounded (2026-08-19;
 * deliberately left untapped, so no completed pair — surfacing alone is
 * what refutes a bank-side time cooldown); all three
 * production failures armed 22-54 s after the operator's previous tap while
 * they were sitting *inside* K BIZ waiting for a push that never surfaced.
 * So this constant's only real job is giving the operator time to back out of
 * the app after the TAP-NEEDED ping, not "waiting out the bank". 90 s sits
 * above the entire observed failure band (max 54 s); the 55-620 s band has
 * zero observations, so there is no evidence to revise the number against —
 * inventing 60 s or 75 s here would be an unjustified edit. What actually
 * changes in this fix is that the gap finally RUNS (see the arm-gate.test.ts
 * regression describe: `gapMs: 0` on main, non-zero after) and that
 * `pauseBeforeArmMessage` ("close or background K BIZ NOW") fires with it.
 * `~/HF/hf-tasks/tasks/wave-5.md:376`'s owner-gated ฿1 supervised pair is the
 * only route to revising this value, and stays open.
 */
export const TAP_COOLDOWN_MS = 90_000;

/**
 * How long a RELEASED "unconfirmed" lock keeps holding the estate across
 * polls, once `prev` (which is per-batch, process-queue.ts:309, and cannot
 * see across polls) has gone back to `{kind:"none"}`. Reused, not invented: an
 * unconfirmed release means a push may have been tapped as late as the end of
 * its own ~6.5-min bank window (`PUSH_LIFETIME_MS`), and nothing else in the
 * estate may safely arm at that same phone until that window is behind us.
 * Accepted friction (deliberate, see decideArm's D2 table): an operator who
 * force-releases an unconfirmed bundle and re-pays within ~6.5 min of the
 * release gets one `HELD:` message naming exactly when it is safe again — the
 * alternative (no bound at all) is the cross-poll hole this whole file exists
 * to close.
 */
export const UNCONFIRMED_DEFER_MS = PUSH_LIFETIME_MS;

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
 *
 * The `released` arm is its own variant carrying three facts `parseArmLock`
 * used to throw away outright (2026-08-18: B's gate read this exact file
 * 30.8 s after A's release wrote `updatedAt: 15:40:33.6Z` and discarded the
 * timestamp — the data a tap-keyed cross-poll cooldown needs was already in
 * the file it opened). All three are optional: a lock written by the
 * currently deployed build (before this change) has none of them, and
 * `decideArm` must treat that as "nothing to go on" — arm gap 0, exactly
 * today's behaviour — because the two images in this estate do not roll out
 * atomically (`deploy.yml` and `deploy-reimbursement.yml` only share a
 * concurrency group, not an ordering guarantee).
 */
export type LockView =
  | { live: false; source: "none" | "expired" | "corrupt-unknown" }
  | {
      live: false;
      source: "released";
      /** Epoch ms of the release write (the lock's `updatedAt`). Absent ⇒ unparseable date. */
      releasedAt?: number;
      resolution?: NonNullable<ArmLock["resolution"]>;
      intentId?: string;
    }
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
  if (parsed.state === "released") {
    // Surface what used to be thrown away (see LockView's doc comment for the
    // 2026-08-18 incident this closes). `releasedAt` is derived from
    // `updatedAt` when it parses; MONEY REVIEW FINDING 5 (2026-08-19): when it
    // does NOT parse, this used to fall straight to `undefined`, and
    // `decideArm` treats an undefined `releasedAt` as "nothing to go on" —
    // i.e. it turns OFF the entire cross-poll cooldown, including the
    // `resolution === "unconfirmed"` defer, and arms with gap 0. That is
    // fail-open in exactly the direction this file exists to close: a release
    // write interrupted mid-flight (writeArmLock failures are tolerated at
    // process-queue.ts's own call site) can leave `updatedAt` truncated while
    // `state`/`resolution` survive intact. `mtimeMs` is a perfectly good
    // stand-in for "when was this release written" — `writeArmLock` writes
    // the JSON body and the file's mtime in the SAME rename(2) — so fall back
    // to it before giving up and reporting `undefined`. Only a lock with NO
    // usable mtime EITHER (the true back-compat floor: an old build's lock,
    // or a read that lost the stat too) reports `releasedAt: undefined`.
    const parsedAt = Date.parse(parsed.updatedAt);
    const releasedAt = Number.isFinite(parsedAt) ? parsedAt : (mtimeMs ?? undefined);
    return {
      live: false,
      source: "released",
      releasedAt,
      resolution: parsed.resolution,
      intentId: parsed.intentId,
    };
  }

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
 * Pure. Order: lock first, then previous-outcome (in-batch), then the
 * released lock's own facts (cross-poll — see LockView's doc comment). The
 * full D2 table, in the order it is checked:
 *
 *   lock live                                   defer push-may-be-live      (outranks everything)
 *
 *   prev = armed/success                        arm   gap = gapMs
 *   prev = armed/push-expired                   arm   gap = gapMs          (bank voided it — same
 *                                                                            treatment as a tapped
 *                                                                            success, see §2.6: the
 *                                                                            operator was most likely
 *                                                                            sitting in K BIZ hunting
 *                                                                            for a push that never
 *                                                                            surfaced, so they need
 *                                                                            the pause more than most)
 *   prev = armed/confirmed-failed                defer prev-confirmed-failed
 *   prev = armed/unconfirmed                     defer prev-unconfirmed
 *
 *   prev = none | not-armed, lock released, age = now - lock.releasedAt:
 *     resolution "unconfirmed", age < UNCONFIRMED_DEFER_MS
 *                                                 defer prev-unconfirmed,
 *                                                 prevId = lock.intentId,
 *                                                 until  = lock.releasedAt + UNCONFIRMED_DEFER_MS
 *     resolution "never-armed"                    arm   gap 0
 *     resolution anything else, age < gapMs        arm   gap = max(0, gapMs - age)
 *     no releasedAt / no resolution / age >= bound  arm   gap 0   (BACK-COMPAT: a lock written by
 *                                                    the currently deployed build has neither field)
 *
 *   prev = none | not-armed, lock NOT released    arm   gap 0
 *
 * Bank confirmation IS the operator ack: the gap only means anything if the
 * previous push actually resolved, so anything short of a confirmed outcome
 * hands the batch back to the human instead of arming into the dark. The
 * cross-poll rows exist because `prev` is per-batch (process-queue.ts:309)
 * and dies every poll, but the released lock on disk does not — it is the
 * only thing that remembers a tap from ONE POLL AGO (2026-08-18's B: `prev`
 * was `{kind:"none"}`, the released lock was 30.8 s old, and nothing read it).
 *
 * `now` is accepted so a whole gate decision is taken against ONE clock
 * reading (the caller passes the same value to parseArmLock); the live/expired
 * judgement it drives has already been folded into `lock` by the time we get
 * here, which is why the in-batch rows above don't read it — only the
 * cross-poll `age` computation below does.
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
  if (prev.kind === "armed") {
    if (prev.outcome === "success" || prev.outcome === "push-expired") return { kind: "arm", gapMs: input.gapMs };
    if (prev.outcome === "confirmed-failed") return { kind: "defer", code: "prev-confirmed-failed", prevId: prev.id };
    return { kind: "defer", code: "prev-unconfirmed", prevId: prev.id };
  }

  // prev.kind is "none" or "not-armed": nothing armed a push THIS BATCH. That
  // does not mean nothing armed one at all — check the released lock's own
  // facts for a tap from a PREVIOUS poll (see the function comment and
  // LockView's doc comment for why this is the fix for the 2026-08-18 hole).
  if (input.lock.source === "released") {
    const { releasedAt, resolution, intentId } = input.lock;
    if (releasedAt !== undefined && resolution !== undefined) {
      // MONEY REVIEW FINDING 9 (2026-08-19): clamp at 0, not just `>= 0`
      // downstream. A `releasedAt` in the future (host clock stepped
      // backward by NTP, or a lock restored from a snapshot/another host)
      // used to yield a NEGATIVE age, and `gapMs - age` then OVERSHOOTS
      // `gapMs` instead of shrinking it — a mild skew silently parks the
      // batch far longer than the cooldown ever intends, and a skew past
      // 2^31 ms overflows `setTimeout` at the call site and fires
      // IMMEDIATELY, i.e. the cooldown becomes 0 in exactly the direction
      // this constant must never go. Treating "released in the future" the
      // same as "released right now" is the safe reading either way.
      const age = Math.max(0, input.now - releasedAt);
      if (resolution === "unconfirmed" && age < UNCONFIRMED_DEFER_MS) {
        return { kind: "defer", code: "prev-unconfirmed", prevId: intentId, until: releasedAt + UNCONFIRMED_DEFER_MS };
      }
      if (resolution !== "never-armed" && age < input.gapMs) {
        return { kind: "arm", gapMs: Math.max(0, input.gapMs - age) };
      }
    }
  }
  // MONEY REVIEW FINDING 10 (low severity, 2026-08-19): a `source` of
  // "expired" or "corrupt-mtime" also falls through to here, WITHOUT the
  // cross-poll cooldown above ever running — only `source === "released"` is
  // checked. This is deliberate, not an oversight: every `pushMayBeLive:
  // true` exit (session-dead, KBIZ's generic error, and the new
  // arm-unverified path) is defined to NOT release the lock (see
  // process-queue.ts's release comment), so those runs never produce a
  // `released` lock at all — they age out to `expired` on the CONSERVATIVE
  // window instead (`CONSERVATIVE_TOTAL_MS` = pre-arm + push life, ≈10.5
  // min), which already runs 2-3 min past the latest observed failure band
  // (22-54 s) before it is allowed to arm at gap 0. That margin is an
  // assumption about form-fill duration, not a guarantee, which is why it is
  // written down here rather than left silent.
  return { kind: "arm", gapMs: 0 };
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
      // `until` is present ONLY on the cross-poll row (decideArm, released
      // lock, resolution "unconfirmed") — the in-batch row (prev = armed/
      // unconfirmed, still this poll) carries no `until` because the push
      // may still be live right now, not merely "closed recently". Different
      // facts, different sentence; do not merge them.
      if (d.until !== undefined) {
        return (
          `HELD: the previous transfer${prev} did not confirm at the bank and its window closed less than ` +
          `${humanDuration(UNCONFIRMED_DEFER_MS)} ago, so no second push was armed. Nothing was submitted for ` +
          `this request — resolve the previous one in K BIZ, then pay this one again after ${clockUtc(d.until)}.`
        );
      }
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
    // Same until-vs-no-until split as deferredErrorText's prev-unconfirmed
    // case, for the same reason: only the cross-poll row knows a wait clause.
    const untilClause =
      d.until !== undefined
        ? `pay it again after ${clockUtc(d.until)} (≈${humanDuration(d.until - args.now)}).`
        : `pay it again when you're ready.`;
    why =
      `${d.prevId ? `\`${d.prevId}\`` : "The previous transfer"} did not confirm at the bank, so no second push was armed. ` +
      `Resolve it in K BIZ first; this request is back to approved — ${untilClause}`;
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
