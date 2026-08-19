/**
 * The post-"Next" wait loop, extracted as a pure, playwright-free module so
 * it can be driven by a virtual clock in tests — a full 6.5-min timeout then
 * runs in microseconds and deterministically. `ApprovalView` is the seam:
 * transfer-other-flow.ts's `playwrightApprovalView(page)` implements it for
 * real, test/support/stub-approval-page.ts implements it for tests.
 *
 * Classification precedence (session-dead → confirmed-failed → success →
 * push-expired → ambiguous) and cadence (sleep 4s, THEN read — first read at
 * t≈4s) are ported verbatim from the loop this replaces
 * (transfer-other-flow.ts:449-462 as of df1953c), with `push-expired` added
 * 2026-08-19 (diagnosis finding 1: the bank's own expiry modal was invisible
 * to every existing regex and fell through to a 6.5-min `unconfirmed`). Do
 * not reorder or re-cadence without re-reading kbiz-interfaces.md D3 — all
 * five steps are pinned by live-verified incidents, not style.
 *
 * Root CI runs `bun test` BEFORE kbiz-bot's node_modules exist
 * (.github/workflows/deploy.yml) — this file (and everything under test/)
 * must never import "playwright", not even `import type`.
 */

export type TransferOutcome = "success" | "confirmed-failed" | "unconfirmed" | "push-expired";
export type ApprovalExit =
  | "success"
  | "confirmed-failed"
  | "ambiguous"
  | "session-dead"
  | "timeout"
  | "push-expired";

/** Every outcome a FAILED flow can report. A success is never a failure outcome. */
export type TransferFailureOutcome = Exclude<TransferOutcome, "success">;

// KBIZ gives the phone tap 5:58 FROM THE MODAL, which renders after our click.
// The bot must OUTLIVE that window: at 5.5 min it walked away from a still-live
// push (incident 2026-08-13: gave up at 01:24:59Z with the on-page countdown
// showing 00:25 remaining) — a tap landing in that gap is executed-but-
// unconfirmed, the one outcome that invites a double-pay on retry. 6.5 min
// strictly covers 5:58 + modal-render latency, so an unconfirmed timeout now
// implies the push has expired at the bank.
export const APPROVAL_TIMEOUT_MS = 6.5 * 60_000;
export const APPROVAL_POLL_MS = 4_000;
/** How long an armed push can stay tappable. Same window, named for its second job. */
export const PUSH_LIFETIME_MS = APPROVAL_TIMEOUT_MS;

// Exported: session.ts re-exports this (moved verbatim from session.ts:16) —
// transfer-other-flow.ts's phone-approval poll loop needs this exact check to
// recognize "our desktop session died", the same signal gotoAuthenticated
// recovers from — see SESSION_DEAD_RE's comment below for why that must
// never be conflated with a KBIZ-confirmed transaction failure.
export const isUnauthenticatedUrl = (url: string) => /\/error\b|\/login(\?|$)|\/authen\//.test(url);

/**
 * Success is ONLY the final slip page. The waiting screen also contains
 * "successfully", so we key on tokens unique to the success page.
 */
const SUCCESS_RE = /Transfer successfully|โอนเงินสำเร็จ|ทำรายการสำเร็จ|Transaction ID|TRBS[0-9]{6}/i;
// KBIZ's own transaction-level rejection text ONLY — the bank explicitly
// saying the transfer did not go through. This is the sole condition safe
// to file as "confirmed-failed" (nothing moved, safe to retry).
//
// "เกิดข้อผิดพลาด" is deliberately NOT here: it is KBIZ's generic "an error
// occurred" (system/500/maintenance pages say it too), and a generic error
// rendered after the push was armed proves nothing about the transaction —
// it may still be approvable on the phone. It classifies as unconfirmed via
// AMBIGUOUS_RE below, so nothing ever auto-retries against it.
const FAILED_RE = /ไม่สำเร็จ|unsuccessful/i;
// Generic error page mid-wait: break out early as unconfirmed (fresh
// screenshot, human verifies in K BIZ) instead of looping to the timeout.
const AMBIGUOUS_RE = /เกิดข้อผิดพลาด/i;
// Session-level signals — OUR desktop session died mid-wait (bounced to
// /login|/authen, or hit the exact "session expired" text session.ts's
// gotoAuthenticated already probes for to mean "re-login", not "transfer
// failed"). This proves NOTHING about the pending transaction: the phone
// push lives server-side at KBIZ, not in the killed browser session, so it
// may already be approved. Must resolve to "unconfirmed" (needs-review,
// human checks K BIZ before anyone re-pays), never "confirmed-failed"
// (auto-retried by process-queue) — see decision 3 in
// docs/adr/0001-kbiz-transfer-automation.md.
const SESSION_DEAD_RE = /หมดเวลา|expired|session has expired|signed in on another|session expired or you are signed in/i;

// The bank's own "we sent the push, go tap it" block — live-verified on
// EVERY one of the 9 production dumps that were mid-window (2/9: 3d2eae1e,
// cd550367) and on NEITHER of the terminal ones (expiry: 4c224962; success:
// 90380a45, 6214c6d8). Exported because post-next.ts needs the identical
// marker for its OWN "armed" classification — importing it the other way
// round (post-next.ts's marker into approval-wait.ts) would drag the flow
// module's concerns backward into the pure detector, so this file is the one
// that exports it.
//
// The countdown DIGITS are not a safe marker on their own: they read
// `-- : --` in 7 of 9 arms (inv:evidence GAP 1) — always match the sentence
// around them, never a `mm : ss` capture group.
export const LIVE_PUSH_RE =
  /ส่งการแจ้งเตือนไปที่แอปพลิเคชัน K ?BIZ|A notification has been sent to the K ?BIZ application|กรุณาทำรายการภายใน|Please complete the transaction within/i;

// KBIZ's transaction-expiry modal: the ~6:00 phone-tap window closed with no
// tap recorded. Live-verified on 4c224962 (2026-08-18 incident B) and
// nowhere else in the 9-run record (see approval-wait.test.ts's fixture
// table). Module-private: nothing outside classifyFrame needs to test it in
// isolation, and the exported signal downstream is the ApprovalExit /
// TransferOutcome member, not the regex.
//
// Banned shorter markers (verified false positives — do NOT "simplify" to
// these):
//   - `แจ้งเตือน` alone: hits `ส่งการแจ้งเตือนไป…` (LIVE_PUSH_RE's own text,
//     test/fixtures/kbiz-live-push.th.txt:61) AND the unrelated form checkbox
//     label `แจ้งเตือนผู้รับโอน` ("Notify Receiver", same file:180) that is
//     present on every fundtranfer-other page, live or not.
//   - `ยืนยัน` alone: hits `ยืนยันการทำรายการ` ("confirm the transaction") 4×
//     in that same fixture alone (kbiz-live-push.th.txt:1,59,69,120), 7 of 9
//     production dumps overall.
//   - "wizard reset to step 1" (form tokens present, form fields look
//     "empty"): kbiz-live-push.th.txt:134 `ยอดเงินที่ใช้ได้ (บาท)`, :138
//     `ไปยังบัญชีธนาคาร`, :187 `เลือกไฟล์`, :189 `ล้างข้อมูล` all sit UNDER a
//     modal that is still counting down live — :63 `กรุณาทำรายการภายใน
//     00 : 25 นาที` — diagnosis finding 8. The wizard visually "resets"
//     behind the live modal; it proves nothing.
// MONEY REVIEW FINDING 4 (2026-08-19): the Thai-only, no-/i original left this
// detector entirely inert for an English-locale session — kbiz-live-push.en.txt
// is a REAL production dump proving KBIZ serves fully-English pages (2 of 9
// captured arms), and both sibling regexes added the same day (LIVE_PUSH_RE
// here, DUPLICATE_POPUP_RE in post-next.ts) already carry an English
// alternation. On an English session with no PUSH_EXPIRED_RE match, either
// nothing matches (the fix is inert: 6.5-min timeout, the old misleading
// "unconfirmed" prose) or SESSION_DEAD_RE's bare /expired/i wins first
// (fail-closed but wrong reason). The English wording below is INFERRED by
// analogy to LIVE_PUSH_RE's confirmed Thai/English pairing — no real English
// expiry dump has been captured yet (0 of 9), so confirm it against the next
// one. A wrong guess here is still safe either way: an unmatched English
// expiry page falls through to the pre-existing ambiguous/timeout handling
// (unconfirmed, pushMayBeLive), never to a false "success" or "confirmed-failed".
const PUSH_EXPIRED_RE =
  /ไม่สามารถทำรายการได้|ท่านไม่ได้ทำรายการในระยะเวลาที่กำหนด|unable to (?:complete|process) this transaction|did not complete the transaction within/i;

// KBIZ expiry modal must be seen for this long, unbroken, before it wins a
// terminal verdict. THE MONEY CASE THIS GRACE EXISTS FOR: a phone tap that
// lands in the bank's final second, followed by the page flipping to the
// expiry text on a CLIENT-SIDE countdown timer a heartbeat before the bank
// itself has actually voided the transaction (diagnosis §6, undetermined
// item 4 — "is the modal bank truth or a client-side countdown hitting
// zero?"). A same-second tap gets three more 4s polls to flip the page to
// the success slip instead of being misclassified as "nothing moved".
export const EXPIRY_CONFIRM_MS = 12_000;

export interface ApprovalView {
  url(): string;
  bodyText(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Pure. null = keep waiting.
 * Precedence: session-dead → failed → success → push-expired → ambiguous —
 * pinned by tests, not incidental: a rejection page may well render a
 * "Transaction ID" for the failed attempt (which SUCCESS_RE would match),
 * while the live-verified success page carries none of the failure tokens.
 * push-expired sits AFTER success (a success page always wins) and carries
 * its own corroborant below.
 */
export function classifyFrame(url: string, text: string): ApprovalExit | null {
  if (isUnauthenticatedUrl(url) || SESSION_DEAD_RE.test(text)) return "session-dead";
  if (FAILED_RE.test(text)) return "confirmed-failed";
  if (SUCCESS_RE.test(text)) return "success";
  // The corroborant is load-bearing, not decorative: PUSH_EXPIRED_RE alone
  // would also fire on nothing (it never has, across 9 dumps), but the
  // symmetric proof that matters is the ABSENCE of the bank's live-push
  // block. Without `!LIVE_PUSH_RE`, a future KBIZ page that mentions both
  // (e.g. an expiry toast rendered on top of a still-live modal) would
  // misclassify a live push as "nothing moved" — the one direction this
  // bot must never guess wrong in.
  if (PUSH_EXPIRED_RE.test(text) && !LIVE_PUSH_RE.test(text)) return "push-expired";
  if (AMBIGUOUS_RE.test(text)) return "ambiguous";
  return null;
}

function exitToOutcome(exit: ApprovalExit): TransferOutcome {
  switch (exit) {
    case "success":
      return "success";
    case "confirmed-failed":
      return "confirmed-failed";
    case "push-expired":
      return "push-expired";
    case "ambiguous":
    case "session-dead":
    case "timeout":
      return "unconfirmed";
    default: {
      const _never: never = exit;
      throw new Error(`unhandled approval exit ${String(_never)}`);
    }
  }
}

export interface ApprovalWaitResult {
  outcome: TransferOutcome;
  exit: ApprovalExit;
  elapsedMs: number;
  /** false only when the push is provably dead: consumed, or the window elapsed. */
  pushMayBeLive: boolean;
}

/**
 * Poll `view` for a terminal frame. Verbatim port of the loop this replaces:
 * sleep, THEN read (first read at t≈4s), classify, break on a match, else
 * keep going until `timeoutMs` elapses.
 */
export async function waitForApproval(
  view: ApprovalView,
  opts?: { timeoutMs?: number; pollMs?: number; onTick?: (elapsedMs: number) => void },
): Promise<ApprovalWaitResult> {
  const timeoutMs = opts?.timeoutMs ?? APPROVAL_TIMEOUT_MS;
  const pollMs = opts?.pollMs ?? APPROVAL_POLL_MS;
  const started = view.now();
  let exit: ApprovalExit | null = null;
  // Tracks how long the expiry modal has been up, UNBROKEN, so a same-second
  // tap gets EXPIRY_CONFIRM_MS worth of extra polls to flip the page before
  // "push-expired" is allowed to win — see EXPIRY_CONFIRM_MS's comment for
  // the money case. Reset to null the instant a poll sees anything else
  // (including "keep waiting" / null), because that proves the expiry text
  // was transient, not terminal.
  let expiredFirstSeenAt: number | null = null;

  while (view.now() - started < timeoutMs) {
    await view.sleep(pollMs);
    const text = await view.bodyText().catch(() => "");
    const frame = classifyFrame(view.url(), text);
    if (frame === "push-expired") {
      if (expiredFirstSeenAt === null) expiredFirstSeenAt = view.now();
      if (view.now() - expiredFirstSeenAt >= EXPIRY_CONFIRM_MS) {
        exit = "push-expired";
        break;
      }
      opts?.onTick?.(view.now() - started);
      continue;
    }
    if (frame) {
      exit = frame;
      break;
    }
    expiredFirstSeenAt = null; // the modal went away — it was not terminal
    opts?.onTick?.(view.now() - started);
  }

  // The loop's own `while` condition can end the run mid-grace (the expiry
  // modal was seen but hadn't yet held for EXPIRY_CONFIRM_MS when timeoutMs
  // elapsed) — that is still an expiry, not a bare timeout, so the fallback
  // below checks the flag rather than defaulting straight to "timeout".
  const resolvedExit: ApprovalExit = exit ?? (expiredFirstSeenAt !== null ? "push-expired" : "timeout");
  const elapsedMs = view.now() - started;
  return {
    outcome: exitToOutcome(resolvedExit),
    exit: resolvedExit,
    elapsedMs,
    pushMayBeLive: resolvedExit === "ambiguous" || resolvedExit === "session-dead",
  };
}
