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
 *
 * SECOND MONEY RULE, added 2026-08-19 alongside `push-expired`: the mirror
 * case of the one above — a transfer that DID move money must never be told
 * "safe to retry, nothing happened" just because the bank's own push window
 * expired first. See the downgrade branch below (`outcome === "push-expired"
 * && slip?.reference`) for the guard, and kbiz-interfaces.md §1.8 for why a
 * scraped reference is definitive proof either way.
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
  /**
   * false ⇒ Next was clicked but post-next.ts's verifyArmed never saw the
   * bank's "notification sent" block within its 12 s budget (state
   * "unknown") — the flow calls finalizeTransfer directly with
   * outcome:"unconfirmed" in that case, never `waitForApproval`. Default
   * true: every OTHER caller (the normal waitForApproval path, and
   * push-expired, which can only be reached AFTER an arm was verified)
   * genuinely saw the panel. Changes only the copy — we cannot prove a push
   * exists on an unverified arm, and cannot prove one doesn't, so the text
   * must say so instead of the ordinary "the bank never answered" framing.
   */
  armVerified?: boolean;
  /** Take the slip. MAY THROW — that is the case this module exists for. */
  captureSlip: () => Promise<SlipCapture>;
  /** Read lazily: the URL is only meaningful after the capture settles. */
  finalUrl: () => string;
  /** Injectable purely so the test can assert the warning without stdout noise. */
  warn?: (message: string) => void;
  log?: (message: string) => void;
}

// Q4 (kbiz-interfaces.md §3.2) — appended to ANY non-success text whenever
// the slip parsed a bank reference: capture-slip.ts's REFERENCE_LABELS
// already looks for เลขที่รายการ/Transaction ID on every page, not only the
// success page (diagnosis finding 10), and this module used to throw that
// value away outside the success branch. A reference number is definitionally
// a page where money moved, so every non-success outcome now names it instead
// of silently discarding proof the operator needs before they retry.
function withReferenceSuffix(text: string, reference: string | undefined): string {
  if (!reference) return text;
  return `${text} — หน้าจอสุดท้ายมีเลขที่รายการ ${reference} ซึ่งหมายความว่าเงินถูกโอนไปแล้ว ให้แนบสลิปเพื่อปิดรายการ`;
}

// Q2/Q3 (kbiz-interfaces.md §3.2). Two variants of the SAME outcome, keyed on
// whether post-next.ts's verifyArmed ever confirmed the bank sent the push —
// an operator reading "รอครบเวลาแล้วธนาคารยังไม่แสดงผล" (Q2) for an arm we
// never verified would be told the bank stayed silent on a push that, for
// all we know, never existed at all. Both keep the SAME `outcome`/status
// mapping ("unconfirmed" → needs-review, no auto-retry) — only the copy
// differs, because the money handling is identical either way.
function unconfirmedText(armVerified: boolean, slipSuffix: string): string {
  if (!armVerified) {
    return (
      `ไม่ทราบผลการโอน — บอทกดส่งคำสั่งแล้ว แต่ตรวจไม่พบว่าธนาคารส่งการแจ้งเตือนไปที่แอป K BIZ ภายใน 12 วินาที ` +
      `จึงยืนยันไม่ได้ว่ามีรายการให้กดบนมือถือ ห้ามจ่ายซ้ำจนกว่าจะเปิดแอป K BIZ ตรวจ "ประวัติทำรายการ" ก่อน ภาพหน้าจอ: ${slipSuffix}`
    );
  }
  return (
    `ไม่ทราบผลการโอน — รอครบเวลาแล้วธนาคารยังไม่แสดงผล เงินอาจโอนไปแล้วหรือยังไม่โอน ` +
    `ห้ามจ่ายซ้ำจนกว่าจะเปิดแอป K BIZ ตรวจ "ประวัติทำรายการ" ก่อน ถ้าโอนแล้วให้กด "ยืนยันว่าโอนแล้ว (แนบสลิป)" ภาพหน้าจอ: ${slipSuffix}`
  );
}

export async function finalizeTransfer(input: FinalizeTransferInput): Promise<TransferOtherResult> {
  const warn = input.warn ?? ((m: string) => console.warn(m));
  const log = input.log ?? ((m: string) => console.log(m));
  const { outcome, pushMayBeLive, armedAt } = input;
  const armVerified = input.armVerified ?? true;

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

  const slipSuffix = slip?.screenshotPath ?? "(no slip captured)";

  if (outcome === "push-expired") {
    // HARD MONEY INVARIANT (kbiz-interfaces.md §1.8) — must run BEFORE the
    // push-expired copy below is even considered. capture-slip.ts's
    // REFERENCE_LABELS parse เลขที่รายการ/Transaction ID off the page
    // regardless of `outcome` (diagnosis finding 10); a page that carries
    // one is definitionally a page where money moved. Reusing push-expired's
    // "the bank voided it, pay again freely" text against evidence the
    // transfer actually went through would be exactly the double-pay this
    // whole outcome exists to prevent — so a reference downgrades the
    // outcome to "unconfirmed" (force + human verify), never leaves it
    // "push-expired" (no-force retry). This is the ONLY place TransferOutcome
    // "push-expired" can turn into result.outcome "unconfirmed".
    if (slip?.reference) {
      log(`⚠ push-expired but the final page carries a reference (${slip.reference}) — downgrading to unconfirmed, not a no-force retry.`);
      return {
        success: false,
        outcome: "unconfirmed",
        error: withReferenceSuffix(unconfirmedText(armVerified, slipSuffix), slip.reference),
        reference: slip.reference,
        shot: slip.screenshotPath,
        armedAt,
        pushMayBeLive,
      };
    }
    return {
      success: false,
      outcome,
      error:
        `ธนาคารยกเลิกรายการนี้เพราะไม่ได้กดยืนยันในแอป K BIZ ภายในเวลาที่กำหนด — เงินยังไม่ถูกโอน จ่ายใหม่ได้เลย ` +
        `ครั้งนี้ให้ปิดแอป K BIZ ไว้ก่อน แล้วเปิดเมื่อมีการแจ้งเตือนเข้ามา ภาพหน้าจอ: ${slipSuffix}`,
      shot: slip?.screenshotPath,
      armedAt,
      pushMayBeLive,
    };
  }
  if (outcome === "confirmed-failed") {
    // Q4's premise ("a reference means money moved") is UNSAFE on THIS
    // branch, unlike push-expired/unconfirmed. MONEY/SPEC REVIEW FINDING
    // 7/2 (2026-08-19): approval-wait.ts's own precedence comment documents
    // WHY FAILED_RE outranks SUCCESS_RE — "a rejection page may well render
    // a 'Transaction ID' for the failed attempt" — so `slip.reference` is
    // reachable here on exactly the page where money did NOT move. Appending
    // withReferenceSuffix used to produce one `paymentError` string that said
    // "เงินยังไม่ถูกโอน" (money did not move) and "เงินถูกโอนไปแล้ว" (money WAS
    // transferred) in the same sentence, on a NO-FORCE retryable bundle — an
    // approver reading only the back half could mark an unpaid vendor PAID.
    // `reference` still rides on the result for forensics; the Q4 sentence is
    // deliberately NOT appended here.
    return {
      success: false,
      outcome,
      error: `KBIZ แจ้งว่ารายการนี้ไม่สำเร็จ — เงินยังไม่ถูกโอน จ่ายใหม่ได้ ภาพหน้าจอ: ${slipSuffix}`,
      reference: slip?.reference,
      shot: slip?.screenshotPath,
      armedAt,
      pushMayBeLive,
    };
  }
  // "unconfirmed" — the catch-all for ambiguous / session-dead / timeout /
  // the unverified-arm path. Never auto-resolved in either direction.
  return {
    success: false,
    outcome: "unconfirmed",
    error: withReferenceSuffix(unconfirmedText(armVerified, slipSuffix), slip?.reference),
    reference: slip?.reference,
    shot: slip?.screenshotPath,
    armedAt,
    pushMayBeLive,
  };
}
