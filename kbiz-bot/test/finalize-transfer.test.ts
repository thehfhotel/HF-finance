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

import { describe, expect, it } from "bun:test";
import { finalizeTransfer, type FinalizeTransferInput } from "../src/lib/finalize-transfer";
import { mapFlowOutcomeToPatch, slipFileBasename } from "../src/lib/transfer-other-queue";
import type { TransferOtherResult } from "../src/flows/transfer-other-flow"; // type-only, erased
import type { SlipCapture } from "../src/lib/capture-slip";

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
  return mapFlowOutcomeToPatch({
    success: false,
    outcome: flow.outcome === "unconfirmed" ? "unconfirmed" : "confirmed-failed",
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
  it("confirmed-failed with no slip stays confirmed-failed and says so", async () => {
    const result = await run("confirmed-failed", DISK_FULL);
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("confirmed-failed");
    expect(result.error).toContain("(no slip captured)");
    expect(result.shot).toBeUndefined();
    expect(patchFor(result).status).toBe("failed");
  });

  it("unconfirmed with no slip stays unconfirmed and keeps pushMayBeLive for the live-push warning", async () => {
    const result = await run("unconfirmed", DISK_FULL, { pushMayBeLive: true });
    expect(result.success).toBe(false);
    if (result.success) throw new Error("unreachable");
    expect(result.outcome).toBe("unconfirmed");
    expect(result.error).toContain("(no slip captured)");
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
});
