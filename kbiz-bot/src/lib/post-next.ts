/**
 * Classifies what KBIZ put on screen immediately after the fundtranfer-other
 * "Next" click — pure, playwright-free, driven through the same `ApprovalView`
 * seam as approval-wait.ts, so it can be exercised with a virtual clock in
 * tests (no browser, no real timers).
 *
 * Why this module exists (2026-08-19): `next.click()` used to be followed
 * immediately by `armedAt = Date.now()` and the TAP-NEEDED Slack ping, with
 * no proof the bank had actually acknowledged the click — three production
 * incidents (2026-08-12, 2026-08-13, 2026-08-18) show that gap can hide a
 * push the operator never gets a chance to tap. A JS-inert click is
 * indistinguishable in the logs from "the operator didn't tap" without a
 * read of the page. Separately, KBIZ raises an exact-duplicate confirmation
 * popup BEFORE it ever sends a push (user-verified 2026-08-19, 0 of 9
 * production arms) — to the old code that popup would look exactly like an
 * arm that silently never happened: no push, phone silent, 6.5-min timeout.
 * `verifyArmed` exists to read the bank's own answer before either the flow
 * or the caller claims anything.
 *
 * Root CI runs `bun test` BEFORE kbiz-bot's node_modules exist
 * (.github/workflows/deploy.yml) — this file (and everything under test/)
 * must never import "playwright", not even `import type`.
 */

import { classifyFrame, LIVE_PUSH_RE, type ApprovalView } from "./approval-wait";

/**
 * What KBIZ put on screen after the Next click.
 *  "armed"            — the bank's own "notification sent" / countdown block is up.
 *  "duplicate-popup"  — the exact-duplicate confirmation dialog; NO push has been sent yet.
 *  "terminal"         — classifyFrame already has a verdict (success / failure / session-dead
 *                        / push-expired); hand straight to waitForApproval, claim no arm.
 *  "unknown"          — nothing recognisable within the budget. Never claim an arm on this.
 */
export type PostNextState = "armed" | "duplicate-popup" | "terminal" | "unknown";

// Budget: the bank's live-push panel was already on screen at click+2.7s in
// 9 of 9 production arms (inv:evidence GAP 1/GAP 3, offset measured at
// 2.714s ± 0.03). The flow already waits 2.5s and screenshots before calling
// verifyArmed, so 12s at 1.5s intervals is ~4x the observed render time —
// generous margin, not a guess.
export const ARM_VERIFY_TIMEOUT_MS = 12_000;
export const ARM_VERIFY_POLL_MS = 1_500;

// KBIZ's exact-duplicate confirmation dialog (same payee + same amount as an
// earlier transaction). SYNTHESISED from the user's 2026-08-19 screenshot —
// it appears in 0 of 9 captured production dumps, so there is no live text
// to grep against; see test/fixtures/kbiz-duplicate-popup.th.txt for the
// full synthetic page this was built from. Precedes any push: a bot that
// does not recognise it will stall silently for the full 6.5-min timeout
// with nothing ever reaching the phone.
export const DUPLICATE_POPUP_RE =
  /ท่านหรือบริษัทมีการทำรายการนี้ไปแล้ว|ยืนยันที่จะทำรายการนี้อีกครั้ง|already (?:made|performed|done) this transaction|make this transaction again/i;

/**
 * Pure. Precedence: duplicate → terminal → armed → unknown.
 *
 * "terminal" outranks "armed" because a terminal classifyFrame verdict (most
 * plausibly push-expired or a same-page failure) means the wait loop already
 * has an answer — there is nothing left to verify an arm against, and
 * waitForApproval must be the one to report it, not this module.
 *
 * LIVE_PUSH_RE, not classifyFrame, is what proves "armed": the live-push
 * block is deliberately NOT a classifyFrame terminal state (classifyFrame's
 * job is "is the wait over", and a live push means the wait has only just
 * begun).
 */
export function classifyPostNext(url: string, text: string): PostNextState {
  if (DUPLICATE_POPUP_RE.test(text)) return "duplicate-popup";
  if (classifyFrame(url, text) !== null) return "terminal";
  if (LIVE_PUSH_RE.test(text)) return "armed";
  return "unknown";
}

export interface ArmVerifyResult {
  state: PostNextState;
  /** ms spent inside verifyArmed, on the view's own clock. */
  elapsedMs: number;
  reads: number;
}

/**
 * Read FIRST, then sleep — the opposite cadence to waitForApproval,
 * deliberately: the caller has already waited 2.5s for the modal to render
 * and screenshotted it, so the first read is the evidence, not a warm-up.
 * Returns as soon as any state other than "unknown" appears; returns
 * "unknown" once ARM_VERIFY_TIMEOUT_MS has elapsed with nothing recognised.
 */
export async function verifyArmed(
  view: ApprovalView,
  opts?: { timeoutMs?: number; pollMs?: number },
): Promise<ArmVerifyResult> {
  const timeoutMs = opts?.timeoutMs ?? ARM_VERIFY_TIMEOUT_MS;
  const pollMs = opts?.pollMs ?? ARM_VERIFY_POLL_MS;
  const started = view.now();
  let reads = 0;

  while (true) {
    const text = await view.bodyText().catch(() => "");
    reads++;
    const state = classifyPostNext(view.url(), text);
    const elapsedMs = view.now() - started;
    if (state !== "unknown") return { state, elapsedMs, reads };
    if (elapsedMs >= timeoutMs) return { state: "unknown", elapsedMs, reads };
    await view.sleep(pollMs);
  }
}
