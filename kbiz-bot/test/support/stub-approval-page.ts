/**
 * Playwright-free `ApprovalView` stub with a virtual clock, so
 * `waitForApproval`'s full 6.5-min timeout runs in microseconds and
 * deterministically. Must not import "playwright" — root CI runs `bun test`
 * before kbiz-bot's node_modules exist.
 */

import type { ApprovalView } from "../../src/lib/approval-wait";

export interface StubFrame {
  atMs: number;
  url?: string;
  text: string;
}

const DEFAULT_START_URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

export function stubApprovalView(
  frames: StubFrame[],
  opts?: { startUrl?: string },
): ApprovalView & { elapsed(): number; reads(): number } {
  const startUrl = opts?.startUrl ?? DEFAULT_START_URL;
  const sorted = [...frames].sort((a, b) => a.atMs - b.atMs);
  let t = 0;
  let readCount = 0;

  /** The latest frame with atMs <= t, or undefined before the first frame. */
  const latestFrame = (): StubFrame | undefined => {
    let latest: StubFrame | undefined;
    for (const f of sorted) {
      if (f.atMs <= t) latest = f;
      else break;
    }
    return latest;
  };

  return {
    now: () => t,
    url: () => latestFrame()?.url ?? startUrl,
    bodyText: async () => {
      readCount++;
      return latestFrame()?.text ?? "";
    },
    sleep: async (ms: number) => {
      t += ms;
    },
    elapsed: () => t,
    reads: () => readCount,
  };
}
