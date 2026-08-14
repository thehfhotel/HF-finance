/**
 * The post-"Next" wait loop, extracted as a pure, playwright-free module so
 * it can be driven by a virtual clock in tests — a full 6.5-min timeout then
 * runs in microseconds and deterministically. `ApprovalView` is the seam:
 * transfer-other-flow.ts's `playwrightApprovalView(page)` implements it for
 * real, test/support/stub-approval-page.ts implements it for tests.
 *
 * Classification precedence (session-dead → confirmed-failed → success →
 * ambiguous) and cadence (sleep 4s, THEN read — first read at t≈4s) are
 * ported verbatim from the loop this replaces
 * (transfer-other-flow.ts:449-462 as of df1953c). Do not reorder or
 * re-cadence without re-reading kbiz-interfaces.md D3 — both are pinned by
 * live-verified incidents, not style.
 *
 * Root CI runs `bun test` BEFORE kbiz-bot's node_modules exist
 * (.github/workflows/deploy.yml) — this file (and everything under test/)
 * must never import "playwright", not even `import type`.
 */

export type TransferOutcome = "success" | "confirmed-failed" | "unconfirmed";
export type ApprovalExit = "success" | "confirmed-failed" | "ambiguous" | "session-dead" | "timeout";

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

export interface ApprovalView {
  url(): string;
  bodyText(): Promise<string>;
  sleep(ms: number): Promise<void>;
  now(): number;
}

/**
 * Pure. null = keep waiting.
 * Precedence: session-dead → failed → success → ambiguous — pinned by tests,
 * not incidental: a rejection page may well render a "Transaction ID" for
 * the failed attempt (which SUCCESS_RE would match), while the live-verified
 * success page carries none of the failure tokens.
 */
export function classifyFrame(url: string, text: string): ApprovalExit | null {
  if (isUnauthenticatedUrl(url) || SESSION_DEAD_RE.test(text)) return "session-dead";
  if (FAILED_RE.test(text)) return "confirmed-failed";
  if (SUCCESS_RE.test(text)) return "success";
  if (AMBIGUOUS_RE.test(text)) return "ambiguous";
  return null;
}

function exitToOutcome(exit: ApprovalExit): TransferOutcome {
  if (exit === "success") return "success";
  if (exit === "confirmed-failed") return "confirmed-failed";
  return "unconfirmed"; // ambiguous | session-dead | timeout
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

  while (view.now() - started < timeoutMs) {
    await view.sleep(pollMs);
    const text = await view.bodyText().catch(() => "");
    exit = classifyFrame(view.url(), text);
    if (exit) break;
    opts?.onTick?.(view.now() - started);
  }

  const resolvedExit: ApprovalExit = exit ?? "timeout";
  const elapsedMs = view.now() - started;
  return {
    outcome: exitToOutcome(resolvedExit),
    exit: resolvedExit,
    elapsedMs,
    pushMayBeLive: resolvedExit === "ambiguous" || resolvedExit === "session-dead",
  };
}
