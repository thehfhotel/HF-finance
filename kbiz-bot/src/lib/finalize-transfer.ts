/**
 * The tail of `runTransferOtherFlow`: capture the e-slip, then turn
 * (bank outcome + slip-or-not) into the flow's result.
 *
 * WHY THIS IS ITS OWN MODULE. The rule it encodes is a money rule —
 * **a transfer the bank already confirmed must never be downgraded to a
 * failure or needs-review because slip capture failed** (disk full,
 * read-only mount, ENOSPC on the slips bind). Downgrading a success sends
 * the operator "ไม่ทราบผลการโอน" and a Retry button pointed at money that
 * already moved (design defect 1.5 — the double-pay invitation). That rule
 * has to be provable by test, and the flow it used to live in cannot be
 * imported by one: `transfer-other-flow.ts` pulls in `lib/session.ts`, which
 * imports `chromium` from playwright at RUNTIME, and root CI runs `bun test`
 * before kbiz-bot's node_modules exist. Same reason `approval-wait.ts` and
 * `favorites-core.ts` were split out of their flows — this is that pattern,
 * not a new one.
 *
 * So: no playwright here, not even transitively. The page is reached only
 * through the two thunks the caller passes (`captureSlip`, `finalUrl`), which
 * is exactly the seam a test needs to make slip capture throw.
 */

import type { SlipCapture } from "./capture-slip";
import type { TransferOutcome } from "./approval-wait";
import type { TransferOtherResult } from "../flows/transfer-other-flow"; // type-only, erased

export interface FinalizeTransferInput {
  /** The bank's verdict from waitForApproval — the thing that must survive. */
  outcome: TransferOutcome;
  /** From ApprovalWaitResult; passed straight through to the result. */
  pushMayBeLive: boolean;
  /** Epoch ms of the Next click. */
  armedAt: number;
  /** Take the slip. MAY THROW — that is the case this module exists for. */
  captureSlip: () => Promise<SlipCapture>;
  /** Read lazily: the URL is only meaningful after the capture settles. */
  finalUrl: () => string;
  /** Injectable purely so the test can assert the warning without stdout noise. */
  warn?: (message: string) => void;
  log?: (message: string) => void;
}

export async function finalizeTransfer(input: FinalizeTransferInput): Promise<TransferOtherResult> {
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const log = input.log ?? ((m: string) => console.log(m));
  const { outcome, pushMayBeLive, armedAt } = input;

  // A success the bank already confirmed must never be downgraded to a
  // failure/needs-review just because slip capture failed (disk full,
  // read-only mount, ENOSPC). Guard the whole call; degrade to no slip.
  let slip: SlipCapture | undefined;
  try {
    slip = await input.captureSlip();
  } catch (e) {
    warn(`⚠ slip capture failed, outcome unchanged: ${(e as Error).message}`);
  }

  if (outcome === "success" && slip?.reference) {
    log(`✅ Transfer successful. ref=${slip.reference}`);
    return {
      success: true,
      finalUrl: input.finalUrl(),
      previewOnly: false,
      slip,
      reference: slip.reference,
      armedAt,
      pushMayBeLive,
    };
  }
  if (outcome === "success") {
    // Success page detected but no reference parsed (or slip capture
    // failed outright) — still a success.
    log(`✅ Transfer successful${slip ? " (reference not parsed — slip screenshot saved)" : " (no slip captured)"}.`);
    return { success: true, finalUrl: input.finalUrl(), previewOnly: false, slip, armedAt, pushMayBeLive };
  }
  if (outcome === "confirmed-failed") {
    return {
      success: false,
      outcome,
      error: `KBIZ reported the transfer did not complete. Slip: ${slip?.screenshotPath ?? "(no slip captured)"}.`,
      shot: slip?.screenshotPath,
      armedAt,
      pushMayBeLive,
    };
  }
  return {
    success: false,
    outcome: "unconfirmed",
    error:
      `No success/failure seen within the window — the transfer may or may not have gone through. ` +
      `Check your K BIZ app + KBIZ history; attach the phone e-slip to close it. Screenshot: ${slip?.screenshotPath ?? "(no slip captured)"}.`,
    shot: slip?.screenshotPath,
    armedAt,
    pushMayBeLive,
  };
}
