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
  EXPIRY_CONFIRM_MS,
  classifyFrame,
  waitForApproval,
  type ApprovalView,
} from "../src/lib/approval-wait";
import { stubApprovalView } from "./support/stub-approval-page";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const fixture = (name: string) => readFileSync(at(`fixtures/${name}`), "utf8");

// Real production dumps (scrubbed — see kbiz-fix-spec.md §4 for the exact
// sed and the grep that verifies no account number survives), each proving
// one branch of classifyFrame's new push-expired step. Provenance:
//   kbiz-expiry-modal.th.txt  ← pi_4c224962 (2026-08-18 incident B, 15:47:59Z) — the modal itself
//   kbiz-live-push.th.txt     ← pi_3d2eae1e (2026-08-13, 01:24:59Z) — countdown 00:25, must NOT
//                                 classify as push-expired (diagnosis finding 8: step-1 form
//                                 tokens sit under this LIVE modal)
//   kbiz-live-push.en.txt     ← pi_cd550367 (2026-08-12, 03:09:14Z) — English mid-window twin
//   kbiz-success.th.txt       ← pi_90380a45 (2026-08-18, 16:04:57Z) — โอนเงินสำเร็จ + TRTS ref
//   kbiz-success.en.txt       ← pi_6214c6d8 (2026-08-12, 03:14:07Z) — 2/6 prod successes were
//                                 English ("Transfer successfully." + "Transaction ID")
const EXPIRY_FIXTURE = fixture("kbiz-expiry-modal.th.txt");
const LIVE_PUSH_TH_FIXTURE = fixture("kbiz-live-push.th.txt");
const LIVE_PUSH_EN_FIXTURE = fixture("kbiz-live-push.en.txt");
const SUCCESS_TH_FIXTURE = fixture("kbiz-success.th.txt");
const SUCCESS_EN_FIXTURE = fixture("kbiz-success.en.txt");
const FUNDTRANSFER_URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

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

  // --- push-expired (2026-08-19 addition) --------------------------------
  // RED on main: PUSH_EXPIRED_RE does not exist yet, so this returns null
  // (falls through to "timeout" after the full 6.5-min wait) instead of the
  // new terminal outcome.
  it("classifies the real KBIZ expiry-modal dump as push-expired", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, EXPIRY_FIXTURE)).toBe("push-expired");
  });

  // MONEY REVIEW FINDING 4 (2026-08-19): PUSH_EXPIRED_RE was Thai-only and
  // case-sensitive while its two same-day siblings (LIVE_PUSH_RE,
  // DUPLICATE_POPUP_RE) both carry an English alternation — an inconsistency,
  // not a considered choice, given kbiz-live-push.en.txt PROVES English
  // sessions happen (2/9 captured arms). No real English expiry dump exists
  // yet (0/9) — this pins the INFERRED wording so the next real capture has
  // something to confirm or correct against, per PUSH_EXPIRED_RE's own
  // comment.
  it("classifies an inferred English expiry sentence as push-expired (no real EN dump captured yet)", () => {
    expect(
      classifyFrame(FUNDTRANSFER_URL, "Sorry, unable to complete this transaction. You did not complete the transaction within the specified time."),
    ).toBe("push-expired");
  });

  // The regression fence: these two dumps are mid-window (still counting
  // down), captured on the exact incidents this bug is about. They must
  // stay `null` (keep waiting) before AND after this change — a push-expired
  // false positive on a live modal is the one direction this bot must never
  // guess wrong in.
  it("does NOT classify the real Thai live-push dump (countdown 00:25) as terminal", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, LIVE_PUSH_TH_FIXTURE)).toBeNull();
  });

  it("does NOT classify the real English live-push dump as terminal", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, LIVE_PUSH_EN_FIXTURE)).toBeNull();
  });

  it("classifies the real Thai success dump as success (not push-expired)", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, SUCCESS_TH_FIXTURE)).toBe("success");
  });

  it("classifies the real English success dump as success — 2/6 prod successes were English", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, SUCCESS_EN_FIXTURE)).toBe("success");
  });

  it("corroborant proof: expiry text alongside a live-push sentence classifies as null, not push-expired", () => {
    // A future KBIZ page rendering both blocks at once (e.g. an expiry toast
    // over a still-live modal) must not be misread as "nothing moved" —
    // this is exactly what the `!LIVE_PUSH_RE` corroborant in classifyFrame
    // exists to prevent.
    const text =
      "ขออภัย ไม่สามารถทำรายการได้ ท่านไม่ได้ทำรายการในระยะเวลาที่กำหนด " +
      "ส่งการแจ้งเตือนไปที่แอปพลิเคชัน K BIZ เรียบร้อยแล้ว กรุณาทำรายการภายใน 00 : 10 นาที";
    expect(classifyFrame(FUNDTRANSFER_URL, text)).toBeNull();
  });

  it("does not classify the stepper label ขั้นตอนสำเร็จ alone as success (stepper-label trap)", () => {
    expect(classifyFrame(FUNDTRANSFER_URL, "1 ทำรายการ 2 ยืนยันการทำรายการ 3 ขั้นตอนสำเร็จ")).not.toBe("success");
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

  // --- push-expired grace (2026-08-19 addition) --------------------------
  // RED on main: waitForApproval has no expiredFirstSeenAt tracking, so a
  // push-expired frame would classify as null (unknown regex) and these
  // would all just time out.
  it("expiry frame first seen at t=8s and held → outcome push-expired, pushMayBeLive false, elapsedMs = 8s + EXPIRY_CONFIRM_MS", async () => {
    const view = stubApprovalView([{ atMs: 8_000, text: EXPIRY_FIXTURE }]);
    const result = await waitForApproval(view);
    expect(result.outcome).toBe("push-expired");
    expect(result.exit).toBe("push-expired");
    expect(result.pushMayBeLive).toBe(false);
    expect(result.elapsedMs).toBe(8_000 + EXPIRY_CONFIRM_MS);
  });

  it("expiry frame at t=8s, then a success frame at t=12s — the grace wins for money: outcome success", async () => {
    const view = stubApprovalView([
      { atMs: 8_000, text: EXPIRY_FIXTURE },
      { atMs: 12_000, text: SUCCESS_TH_FIXTURE },
    ]);
    const result = await waitForApproval(view);
    expect(result.outcome).toBe("success");
    expect(result.exit).toBe("success");
  });

  it("expiry frame at t=8s, then the live-push panel back at t=12s (nothing after) — flag resets, exit timeout", async () => {
    const view = stubApprovalView([
      { atMs: 8_000, text: EXPIRY_FIXTURE },
      { atMs: 12_000, text: LIVE_PUSH_TH_FIXTURE },
    ]);
    const result = await waitForApproval(view);
    expect(result.exit).toBe("timeout");
    expect(result.outcome).toBe("unconfirmed");
  });

  it("expiry first seen near the outer timeout (grace truncated by it, not by its own clock) — still push-expired, not a bare timeout", async () => {
    // Deliberately NOT poll-grid-aligned (4_000 doesn't divide 390_000) — the
    // point is that the `while` loop's own boundary can end the run before
    // EXPIRY_CONFIRM_MS finishes, and the fallback (`expiredFirstSeenAt !==
    // null ? "push-expired" : "timeout"`) must still resolve it correctly
    // rather than defaulting to "timeout".
    const view = stubApprovalView([{ atMs: APPROVAL_TIMEOUT_MS - 4_000, text: EXPIRY_FIXTURE }]);
    const result = await waitForApproval(view);
    expect(result.exit).toBe("push-expired");
    expect(result.outcome).toBe("push-expired");
    expect(result.pushMayBeLive).toBe(false);
    expect(result.elapsedMs).toBeGreaterThanOrEqual(APPROVAL_TIMEOUT_MS);
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

  it("post-next.ts imports nothing from playwright", () => {
    const src = readFileSync(at("../src/lib/post-next.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
  });

  it("test/support/stub-approval-page.ts imports nothing from playwright", () => {
    const src = readFileSync(at("support/stub-approval-page.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
  });
});
