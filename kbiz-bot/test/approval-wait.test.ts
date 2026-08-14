// Pure-function + virtual-clock coverage for the post-"Next" approval wait
// loop extracted in kbiz-interfaces.md D3. No browser, no real timers — the
// full 6.5-min timeout (test 3) runs and completes in this file's own wall
// time in milliseconds.
//
// Run with `bun test`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  APPROVAL_TIMEOUT_MS,
  classifyFrame,
  waitForApproval,
  type ApprovalView,
} from "../src/lib/approval-wait";
import { stubApprovalView } from "./support/stub-approval-page";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));

describe("classifyFrame", () => {
  it("keeps waiting on the waiting screen even though it contains the word 'successfully'", () => {
    // Live-verified: the waiting screen text includes bare "successfully" —
    // SUCCESS_RE must key on tokens the waiting screen never carries.
    const text = "กำลังรอการยืนยัน ... your transfer will complete successfully once approved";
    expect(classifyFrame("https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other", text)).toBeNull();
  });

  it("classifies as confirmed-failed when both failure and a Transaction ID are present (failure checked before success)", () => {
    const text = "รายการไม่สำเร็จ\nTransaction ID: TRBS999999";
    expect(classifyFrame("https://kbiz.kasikornbank.com/menu/fundtranfer/result", text)).toBe("confirmed-failed");
  });

  it("classifies TRBS######  alone as success", () => {
    expect(classifyFrame("https://kbiz.kasikornbank.com/menu/fundtranfer/result", "TRBS123456")).toBe("success");
  });

  it("classifies เกิดข้อผิดพลาด as ambiguous", () => {
    expect(classifyFrame("https://kbiz.kasikornbank.com/menu/fundtranfer/result", "เกิดข้อผิดพลาด กรุณาลองใหม่")).toBe("ambiguous");
  });

  it("classifies an /authen/ URL as session-dead regardless of body text", () => {
    expect(classifyFrame("https://kbiz.kasikornbank.com/authen/login.jsp?lang=th", "")).toBe("session-dead");
  });

  it("classifies หมดเวลา text as session-dead", () => {
    expect(
      classifyFrame("https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other", "เซสชันหมดเวลาการใช้งาน"),
    ).toBe("session-dead");
  });
});

describe("waitForApproval cadence", () => {
  it("reads bodyText() for the first time at virtual t=4000, not t=0", async () => {
    const view = stubApprovalView([{ atMs: 16_000, text: "Transfer successfully\nTransaction ID: TRBS000001" }]);
    let firstReadAt = -1;
    const originalBodyText = view.bodyText.bind(view);
    view.bodyText = async () => {
      if (firstReadAt === -1) firstReadAt = view.now();
      return originalBodyText();
    };
    await waitForApproval(view);
    expect(firstReadAt).toBe(4_000);
  });
});

describe("waitForApproval exits", () => {
  it("times out when no frame ever matches — outcome unconfirmed, exit timeout, pushMayBeLive false", async () => {
    const view = stubApprovalView([]); // never matches anything
    const result = await waitForApproval(view);
    expect(view.now()).toBeGreaterThanOrEqual(APPROVAL_TIMEOUT_MS);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(390_000);
    expect(result.outcome).toBe("unconfirmed");
    expect(result.exit).toBe("timeout");
    expect(result.pushMayBeLive).toBe(false);
  });

  it("exits early on session-dead at t=8s — unconfirmed, pushMayBeLive true", async () => {
    const view = stubApprovalView([{ atMs: 8_000, url: "https://kbiz.kasikornbank.com/authen/login.jsp", text: "" }]);
    const result = await waitForApproval(view);
    expect(result.outcome).toBe("unconfirmed");
    expect(result.exit).toBe("session-dead");
    expect(result.pushMayBeLive).toBe(true);
    expect(result.elapsedMs).toBe(8_000);
  });

  it("exits early on ambiguous at t=12s — unconfirmed, pushMayBeLive true", async () => {
    const view = stubApprovalView([{ atMs: 12_000, text: "เกิดข้อผิดพลาด" }]);
    const result = await waitForApproval(view);
    expect(result.outcome).toBe("unconfirmed");
    expect(result.exit).toBe("ambiguous");
    expect(result.pushMayBeLive).toBe(true);
    expect(result.elapsedMs).toBe(12_000);
  });

  it("exits on success at t=16s — success, pushMayBeLive false", async () => {
    const view = stubApprovalView([{ atMs: 16_000, text: "Transfer successfully\nTransaction ID: TRBS000002" }]);
    const result = await waitForApproval(view);
    expect(result.outcome).toBe("success");
    expect(result.exit).toBe("success");
    expect(result.pushMayBeLive).toBe(false);
    expect(result.elapsedMs).toBe(16_000);
  });

  it("survives bodyText() rejecting on some reads — waitForApproval catches it internally, same as the loop's own .catch(() => \"\")", async () => {
    let t = 0;
    let reads = 0;
    const flakyView: ApprovalView = {
      now: () => t,
      url: () => "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other",
      sleep: async (ms: number) => {
        t += ms;
      },
      bodyText: async () => {
        reads++;
        // Reject on the first two reads (t=4000, t=8000); succeed at t=12000.
        if (t <= 8_000) throw new Error("page.evaluate: execution context destroyed");
        return "Transfer successfully\nTransaction ID: TRBS000003";
      },
    };

    const result = await waitForApproval(flakyView);
    expect(reads).toBe(3);
    expect(result.outcome).toBe("success");
    expect(result.elapsedMs).toBe(12_000);
  });
});

describe("no playwright import (root CI runs bun test before kbiz-bot's node_modules exist)", () => {
  it("approval-wait.ts imports nothing from playwright", () => {
    const src = readFileSync(at("../src/lib/approval-wait.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
  });

  it("test/support/stub-approval-page.ts imports nothing from playwright", () => {
    const src = readFileSync(at("support/stub-approval-page.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
  });
});
