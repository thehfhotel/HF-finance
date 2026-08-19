// R5 — a slip-capture failure must NEVER downgrade a bank-confirmed success.
//
// The design calls this defect 1.5 and calls it a double-pay invitation: the
// bank has already moved the money, `captureSlip` then throws (disk full,
// read-only slips bind, ENOSPC, a page that died right after the success
// screen), the throw escapes the flow, and process-queue.ts's crash handler
// files `needs-review` — "ไม่ทราบผลการโอน" — for a transfer that SUCCEEDED.
// The operator reads that next to a Retry button.
//
// The guard lives in src/lib/finalize-transfer.ts precisely so this can be
// proven without a browser: `bun test` at the repo root runs this file BEFORE
// kbiz-bot/node_modules exists, so nothing here may import playwright, not
// even transitively (which is why the flow itself cannot be the unit — it
// pulls in lib/session.ts, and that imports `chromium` at runtime).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { finalizeTransfer, type FinalizeTransferInput } from "../src/lib/finalize-transfer";
import { mapFlowOutcomeToPatch, slipFileBasename } from "../src/lib/transfer-other-queue";
import type { TransferOtherResult } from "../src/flows/transfer-other-flow"; // type-only, erased
import type { SlipCapture } from "../src/lib/capture-slip";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

const ARMED_AT = Date.parse("2026-08-14T01:24:31.000Z");
const FINAL_URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/other/result";

const GOOD_SLIP: SlipCapture = {
  screenshotPath: "/app/data/slips/transfer-pi_1-2026-08-14T01-30-58-000Z.png",
  textPath: "/app/data/slips/transfer-pi_1-2026-08-14T01-30-58-000Z.txt",
  reference: "TRBS202608140001",
  resolvedRecipient: "สมชาย ใจดี",
};

/** The real ENOSPC/target-closed shape: captureSlip rejects. */
const DISK_FULL = () => Promise.reject(new Error("ENOSPC: no space left on device, mkdir '/app/data/slips'"));

function run(
  outcome: FinalizeTransferInput["outcome"],
  captureSlip: FinalizeTransferInput["captureSlip"],
  opts: { pushMayBeLive?: boolean; warn?: (m: string) => void } = {},
) {
  return finalizeTransfer({
    outcome,
    pushMayBeLive: opts.pushMayBeLive ?? false,
    armedAt: ARMED_AT,
    captureSlip,
    finalUrl: () => FINAL_URL,
    warn: opts.warn ?? (() => {}),
    log: () => {},
  });
}

/**
 * The queue patch process-queue.ts writes for a given flow result. This
 * mirrors runTransferOtherQueueItem's field plumbing (process-queue.ts, the
 * two returns at the end) so R5 can be asserted all the way to the
 * queue-file status the operator actually sees; the mapping itself is the
 * REAL mapFlowOutcomeToPatch, not a copy of it.
 */
function patchFor(flow: TransferOtherResult) {
  if (flow.success) {
    return mapFlowOutcomeToPatch({
      success: true,
      reference: flow.reference,
      finalUrl: flow.finalUrl,
      slipFile: flow.slip ? slipFileBasename(flow.slip.screenshotPath) : undefined,
    });
  }
  // Was `outcome: flow.outcome === "unconfirmed" ? "unconfirmed" : "confirmed-failed"`
  // — a collapse that made sense while FlowOutcomeInput.outcome was only ever
  // those two literals. IMPL-C widens it to TransferFailureOutcome (adding
  // "push-expired"), so the collapse would now silently launder a
  // push-expired flow result into "confirmed-failed" right here in the test
  // helper, defeating the whole point of the new outcome. Pass it straight
  // through — it is already the real, correctly-typed value.
  return mapFlowOutcomeToPatch({
    success: false,
    outcome: flow.outcome,
    error: flow.error,
    slipFile: flow.shot ? slipFileBasename(flow.shot) : undefined,
  });
}

describe("R5 — slip capture never downgrades a bank-confirmed success", () => {
  it("baseline: success with a slip and a reference is reported as success", async () => {
    const result = await run("success", async () => GOOD_SLIP);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.reference).toBe("TRBS202608140001");
    expect(result.slip).toEqual(GOOD_SLIP);
    expect(patchFor(result).status).toBe("done");
  });

  it("R5 — captureSlip THROWS on a confirmed success → still success, slip undefined, patch done", async () => {
    const result = await run("success", DISK_FULL);

    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.slip).toBeUndefined();
    expect(result.reference).toBeUndefined();
    expect(result.previewOnly).toBe(false);
    expect(result.finalUrl).toBe(FINAL_URL);

    const patch = patchFor(result);
    expect(patch.status).toBe("done");
    expect(patch.result.outcome).toBe("success");
    expect(patch.result.error).toBeUndefined();
    expect(patch.result.slipFile).toBeUndefined();
  });

  it("R5 — RED ON MAIN: the same failure, awaited unguarded, files needs-review for money that moved", async () => {
    // What the flow did before the guard: `const slip = await captureSlip(…)`
    // with no try/catch. Kept as an executable statement of the defect rather
    // than a paragraph of prose — the throw escapes the flow and lands in
    // process-queue.ts's crash handler.
    const legacyFinalize = async () => {
      const slip = await DISK_FULL();
      return slip;
    };
    await expect(legacyFinalize()).rejects.toThrow(/ENOSPC/);

    // …and that is what the crash handler then writes for the SAME transfer.
    const crashPatch = mapFlowOutcomeToPatch({
      success: false,
      outcome: "unconfirmed",
      error: "Crashed: ENOSPC: no space left on device, mkdir '/app/data/slips'",
    });
    expect(crashPatch.status).toBe("needs-review");
    expect(crashPatch.result.outcome).toBe("unconfirmed");

    // The guard turns exactly that into the truth.
    expect(patchFor(await run("success", DISK_FULL)).status).toBe("done");
  });

  it("warns once, and says the outcome is unchanged", async () => {
    const warnings: string[] = [];
    await run("success", DISK_FULL, { warn: (m) => warnings.push(m) });
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("slip capture failed");
    expect(warnings[0]).toContain("outcome unchanged");
    expect(warnings[0]).toContain("ENOSPC");
  });

  it("a slip with no parsed reference is still a success (only the reference is lost)", async () => {
    const noRef: SlipCapture = { screenshotPath: GOOD_SLIP.screenshotPath, textPath: GOOD_SLIP.textPath };
    const result = await run("success", async () => noRef);
    expect(result.success).toBe(true);
    if (!result.success) throw new Error("unreachable");
    expect(result.reference).toBeUndefined();
    expect(result.slip).toEqual(noRef);
    expect(patchFor(result).status).toBe("done");
  });

  it("the arm-lock inputs survive the failure — armedAt and pushMayBeLive are passed through", async () => {
    // process-queue.ts and both CLIs read these two to decide whether the
    // estate-wide hold may be released. A slip failure must not blank them.
    const result = await run("success", DISK_FULL, { pushMayBeLive: false });
    expect(result.armedAt).toBe(ARMED_AT);
    expect(result.pushMayBeLive).toBe(false);
  });
});

describe("R5 — the failure branches degrade, they do not change verdict", () => {
  it("confirmed-failed with no slip stays confirmed-failed and says so, in Thai", async () => {
    const result = await run("confirmed-failed", DISK_FULL);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("confirmed-failed");
    expect(result.error).toContain("(no slip captured)");
    // {slip} keeps this English fragment deliberately (kbiz-interfaces.md
    // §3.2 note: "the existing convention... the forensic handle in the
    // container") — everything AROUND it is now Thai.
    expect(result.error).toContain("เงินยังไม่ถูกโอน");
    expect(result.error).not.toContain("KBIZ reported the transfer did not complete");
    expect(result.shot).toBeUndefined();
    expect(patchFor(result).status).toBe("failed");
  });

  it("unconfirmed with no slip stays unconfirmed and keeps pushMayBeLive for the live-push warning, in Thai", async () => {
    const result = await run("unconfirmed", DISK_FULL, { pushMayBeLive: true });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("unconfirmed");
    expect(result.error).toContain("(no slip captured)");
    expect(result.error).toContain("ไม่ทราบผลการโอน");
    // The old English "may or may not have gone through" prose is gone —
    // cross-implementer check 6 greps for exactly this string.
    expect(result.error).not.toContain("may or may not have gone through");
    expect(result.pushMayBeLive).toBe(true);
    expect(result.armedAt).toBe(ARMED_AT);
    expect(patchFor(result).status).toBe("needs-review");
  });

  it("a captured slip is still attached to a confirmed-failed result", async () => {
    const result = await run("confirmed-failed", async () => GOOD_SLIP);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.shot).toBe(GOOD_SLIP.screenshotPath);
    expect(patchFor(result).result.slipFile).toBe(slipFileBasename(GOOD_SLIP.screenshotPath));
  });

  it("unconfirmed keeps a scraped reference and names it in the text (§1.8)", async () => {
    // unconfirmed is the branch this money rule is actually safe on: nothing
    // in classifyFrame's precedence puts a bank REJECTION behind an
    // unconfirmed exit, so "a reference means money moved" holds here.
    const result = await run("unconfirmed", async () => GOOD_SLIP);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.reference).toBe(GOOD_SLIP.reference);
    expect(result.error).toContain(GOOD_SLIP.reference!);
    expect(result.error).toContain("เงินถูกโอนไปแล้ว");
  });

  it("MONEY/SPEC REVIEW FINDING 7/2 (2026-08-19) — confirmed-failed keeps the reference on the RESULT but does NOT claim money moved in the text", async () => {
    // approval-wait.ts's own precedence comment documents WHY FAILED_RE
    // outranks SUCCESS_RE: "a rejection page may well render a 'Transaction
    // ID' for the failed attempt" — so a reference is REACHABLE here on
    // exactly the page where the bank said the transfer did NOT go through.
    // Appending the Q4 sentence used to produce one paymentError string that
    // said "เงินยังไม่ถูกโอน" (money did not move) and "เงินถูกโอนไปแล้ว" (money
    // WAS transferred) in the same breath, next to a NO-FORCE retry button —
    // an approver reading only the back half could mark an unpaid vendor
    // PAID. `reference` still rides on the result object for forensics.
    const result = await run("confirmed-failed", async () => GOOD_SLIP);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.reference).toBe(GOOD_SLIP.reference);
    expect(result.error).not.toContain(GOOD_SLIP.reference!);
    expect(result.error).not.toContain("เงินถูกโอนไปแล้ว");
    expect(result.error).toContain("เงินยังไม่ถูกโอน");
  });
});

describe("push-expired — the bank's own expiry modal, honest by default", () => {
  it("stays push-expired with no slip: Thai text says money never moved, safe to retry without force", async () => {
    const result = await run("push-expired", DISK_FULL, { pushMayBeLive: false });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("push-expired");
    expect(result.error).toContain("เงินยังไม่ถูกโอน");
    expect(result.error).toContain("ปิดแอป K BIZ");
    expect(result.pushMayBeLive).toBe(false);
    const patch = patchFor(result);
    expect(patch.status).toBe("failed"); // no new queue status (kbiz-interfaces.md §1.10/§6.5)
    expect(patch.result.outcome).toBe("push-expired");
  });

  it("MONEY INVARIANT — push-expired WITH a scraped reference downgrades to unconfirmed, never a bare 'pay again'", async () => {
    // finding 10: capture-slip.ts already parses เลขที่รายการ/Transaction ID
    // off the final page regardless of what classifyFrame decided. A page
    // carrying one is definitionally a page where money moved — reusing the
    // push-expired copy ("เงินยังไม่ถูกโอน จ่ายใหม่ได้เลย", no force gate)
    // against that evidence would be the exact double-pay this design exists
    // to prevent. This is the ONE place a "push-expired" TransferOutcome
    // input may leave finalizeTransfer as result.outcome "unconfirmed".
    const REF = "TRTS260818559240165";
    const slipWithRef: SlipCapture = { screenshotPath: GOOD_SLIP.screenshotPath, textPath: GOOD_SLIP.textPath, reference: REF };
    const result = await run("push-expired", async () => slipWithRef, { pushMayBeLive: false });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("unconfirmed"); // NOT "push-expired"
    expect(result.reference).toBe(REF);
    expect(result.error).toContain(REF);
    expect(result.error).toContain("เลขที่รายการ");
    const patch = patchFor(result);
    expect(patch.status).toBe("needs-review"); // the force-gated path, not a bare retry
    expect(patch.result.outcome).toBe("unconfirmed");
  });

  it("armVerified: false — Thai text names the 12s verification budget and files unconfirmed, not push-expired", async () => {
    // This is the OTHER outcome an unverified arm can produce (the flow
    // calls finalizeTransfer directly with outcome:"unconfirmed" when
    // verifyArmed returns "unknown" — push-expired can only be reached via
    // waitForApproval, which never runs on an unverified arm). Exercised
    // here, not through `run()`, because it needs armVerified explicitly.
    const result = await finalizeTransfer({
      outcome: "unconfirmed",
      pushMayBeLive: true,
      armedAt: ARMED_AT,
      armVerified: false,
      captureSlip: DISK_FULL,
      finalUrl: () => FINAL_URL,
      warn: () => {},
      log: () => {},
    });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("unconfirmed");
    expect(result.error).toContain("12 วินาที");
    expect(result.error).toContain("ไม่ทราบผลการโอน");
    expect(result.pushMayBeLive).toBe(true);
    expect(patchFor(result).status).toBe("needs-review");
  });

  it("armVerified: true (the default) gets the ordinary unconfirmed copy, not the 12s text", async () => {
    const result = await run("unconfirmed", DISK_FULL);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.error).not.toContain("12 วินาที");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Structural guard — transfer-other-flow.ts's clickDialogButton tri-state
// (MONEY REVIEW FINDING, 2026-08-19 second fix round) is not importable
// here (the flow pulls playwright for real, and root CI runs this file
// BEFORE kbiz-bot/node_modules exists). Read it as TEXT, like arm-gate.test
// .ts's "process-queue.ts wiring" block pins process-queue.ts.
// ───────────────────────────────────────────────────────────────────────────

describe("transfer-other-flow.ts wiring — clickDialogButton tri-state", () => {
  const src = readFileSync(at("../src/flows/transfer-other-flow.ts"), "utf8");

  it("sets the clicked flag BEFORE each .click(), not after", () => {
    // If `clicked = true` moved to AFTER `.click()`, a throw from inside the
    // click itself would report "not-found" again — the exact regression
    // this guard exists to catch.
    const btnClick = src.indexOf("await btn.click({ timeout: 5_000 });");
    const btnClicked = src.lastIndexOf("clicked = true;", btnClick);
    expect(btnClicked).toBeGreaterThan(-1);
    expect(btnClicked).toBeLessThan(btnClick);

    const linkClick = src.indexOf("await link.click({ timeout: 5_000 });");
    const linkClicked = src.lastIndexOf("clicked = true;", linkClick);
    expect(linkClicked).toBeGreaterThan(-1);
    expect(linkClicked).toBeLessThan(linkClick);
  });

  it("the catch block distinguishes not-found from click-failed instead of collapsing both to false", () => {
    expect(src).toContain('return clicked ? "click-failed" : "not-found";');
  });

  it("the duplicate-popup confirm caller reports pushMayBeLive TRUE only for click-failed, never for not-found", () => {
    const confirmResult = src.indexOf('const confirmResult = await clickDialogButton(page, DUPLICATE_DIALOG_HINT, ["ยืนยัน", "Confirm"]);');
    expect(confirmResult).toBeGreaterThan(-1);
    const branch = src.slice(confirmResult, confirmResult + 2_500);
    expect(branch).toContain('const clickFailed = confirmResult === "click-failed";');
    expect(branch).toContain("pushMayBeLive: clickFailed,");
    // The pre-fix regression this pins against: an unconditional
    // `pushMayBeLive: false` here released the estate-wide lock on a click
    // that may have already registered with the bank.
    expect(branch).not.toContain("pushMayBeLive: false,");
  });
});
