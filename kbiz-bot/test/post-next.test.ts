// Pure-function + virtual-clock coverage for the post-"Next" arm-verification
// module added 2026-08-19 (see post-next.ts's header for why it exists: three
// incidents where the bot claimed an arm it never verified, plus a
// never-yet-observed duplicate popup that would look identical to one).
//
// Run with `bun test`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  ARM_VERIFY_TIMEOUT_MS,
  classifyPostNext,
  verifyArmed,
  type PostNextState,
} from "../src/lib/post-next";
import { stubApprovalView } from "./support/stub-approval-page";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const fixture = (name: string) => readFileSync(at(`fixtures/${name}`), "utf8");

const LIVE_PUSH_TH_FIXTURE = fixture("kbiz-live-push.th.txt");
const LIVE_PUSH_EN_FIXTURE = fixture("kbiz-live-push.en.txt");
// SYNTHETIC — the duplicate popup is in 0 of 9 production arms (verified
// against every dump in the diagnosis's 9-run record). Built from the
// user's 2026-08-19 screenshot of KBIZ's actual dialog text, laid over the
// retained step-1 form tokens, so this fixture also proves the popup wins
// over the underlying form page (see the last test below).
const DUPLICATE_POPUP_FIXTURE = fixture("kbiz-duplicate-popup.th.txt");
const EXPIRY_FIXTURE = fixture("kbiz-expiry-modal.th.txt");
const SUCCESS_TH_FIXTURE = fixture("kbiz-success.th.txt");
const FUNDTRANSFER_URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

describe("classifyPostNext", () => {
  it("classifies the real Thai live-push dump as armed", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, LIVE_PUSH_TH_FIXTURE)).toBe("armed");
  });

  it("classifies the real English live-push dump as armed", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, LIVE_PUSH_EN_FIXTURE)).toBe("armed");
  });

  it("classifies the synthetic duplicate-popup fixture as duplicate-popup — outranks the retained form page beneath it", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, DUPLICATE_POPUP_FIXTURE)).toBe("duplicate-popup");
  });

  it("classifies the expiry-modal fixture as terminal (classifyFrame already has a verdict)", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, EXPIRY_FIXTURE)).toBe("terminal");
  });

  it("classifies the success fixture as terminal", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, SUCCESS_TH_FIXTURE)).toBe("terminal");
  });

  it("classifies an /authen/ URL as terminal regardless of body text", () => {
    expect(classifyPostNext("https://kbiz.kasikornbank.com/authen/login.jsp?lang=th", "")).toBe("terminal");
  });

  it("classifies an empty string as unknown", () => {
    expect(classifyPostNext(FUNDTRANSFER_URL, "")).toBe("unknown");
  });

  // The label trap: "แจ้งเตือนผู้รับโอน" is the form's own "Notify Receiver"
  // checkbox label, present on every fundtranfer-other page whether or not a
  // push was ever sent. It must NOT satisfy LIVE_PUSH_RE (which requires the
  // bank's actual "we sent the push" sentence) — otherwise the bare form
  // page, before Next was even clicked, would misreport as armed.
  it("classifies the bare form page (แจ้งเตือนผู้รับโอน label, no notification sentence) as unknown, not armed", () => {
    const text = "ทำรายการล่วงหน้า\nแจ้งเตือนผู้รับโอน\nบันทึกช่วยจำ\nต่อไป";
    expect(classifyPostNext(FUNDTRANSFER_URL, text)).toBe("unknown");
  });

  it("does not classify ยืนยันการทำรายการ alone (no duplicate sentence) as duplicate-popup", () => {
    const text = "ยืนยันการทำรายการ\nวันที่ทำรายการ\n13 ส.ค. 69 08:19";
    expect(classifyPostNext(FUNDTRANSFER_URL, text)).not.toBe("duplicate-popup");
  });
});

describe("verifyArmed", () => {
  it("reads at relative t=0, not after a poll sleep — the caller already waited and screenshotted", async () => {
    const view = stubApprovalView([{ atMs: 0, text: LIVE_PUSH_TH_FIXTURE }]);
    let firstReadAt = -1;
    const originalBodyText = view.bodyText.bind(view);
    view.bodyText = async () => {
      if (firstReadAt === -1) firstReadAt = view.now();
      return originalBodyText();
    };
    await verifyArmed(view);
    expect(firstReadAt).toBe(0);
  });

  it("returns armed on the very first read when the panel is already up (reads === 1)", async () => {
    const view = stubApprovalView([{ atMs: 0, text: LIVE_PUSH_TH_FIXTURE }]);
    const result = await verifyArmed(view);
    expect(result.state).toBe("armed");
    expect(result.reads).toBe(1);
    expect(result.elapsedMs).toBe(0);
  });

  it("returns unknown once ARM_VERIFY_TIMEOUT_MS elapses with nothing recognised", async () => {
    const view = stubApprovalView([]); // never matches anything
    const result = await verifyArmed(view);
    expect(result.state).toBe("unknown");
    expect(result.elapsedMs).toBe(ARM_VERIFY_TIMEOUT_MS);
  });

  it("picks up a panel that appears at t=6000 (poll cadence keeps going)", async () => {
    const view = stubApprovalView([{ atMs: 6_000, text: LIVE_PUSH_TH_FIXTURE }]);
    const result = await verifyArmed(view);
    expect(result.state).toBe("armed");
    expect(result.elapsedMs).toBe(6_000);
  });

  it("swallows a bodyText() that rejects and keeps polling", async () => {
    let t = 0;
    let reads = 0;
    const flakyView = {
      now: () => t,
      url: () => FUNDTRANSFER_URL,
      sleep: async (ms: number) => {
        t += ms;
      },
      bodyText: async () => {
        reads++;
        if (t === 0) throw new Error("page.evaluate: execution context destroyed");
        return LIVE_PUSH_TH_FIXTURE;
      },
    };

    const result = await verifyArmed(flakyView);
    expect(result.state).toBe("armed");
    expect(reads).toBe(2);
  });
});

describe("no playwright import (root CI runs bun test before kbiz-bot's node_modules exist)", () => {
  it("post-next.ts imports nothing from playwright", () => {
    const src = readFileSync(at("../src/lib/post-next.ts"), "utf8");
    expect(src).not.toMatch(/from\s+["']playwright["']/);
  });

  it("test/fixtures/*.txt are plain text, not something requiring a browser to read", () => {
    for (const name of [
      "kbiz-expiry-modal.th.txt",
      "kbiz-live-push.th.txt",
      "kbiz-live-push.en.txt",
      "kbiz-success.th.txt",
      "kbiz-success.en.txt",
      "kbiz-duplicate-popup.th.txt",
    ]) {
      const content = fixture(name);
      expect(typeof content).toBe("string");
      expect(content.length).toBeGreaterThan(0);
    }
  });
});

// Type-level sanity: PostNextState is a closed union of exactly these four.
const _states: PostNextState[] = ["armed", "duplicate-popup", "terminal", "unknown"];
void _states;
