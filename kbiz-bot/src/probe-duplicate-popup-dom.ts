/**
 * Selector-vs-real-DOM probe for KBIZ's exact-duplicate popup.
 *
 * The duplicate popup has appeared in 0 of 9 production arms, so the ONLY
 * ground truth for its markup is the operator's live devtools capture of
 * 2026-08-19 (test/fixtures/kbiz-duplicate-popup.dom.html, scrubbed). This
 * probe drives the REAL clickDialogButton (imported, not copied) against
 * that fixture in a local chromium.
 *
 * NOT part of root `bun test` (imports playwright — root CI runs without
 * kbiz-bot/node_modules). Run manually:
 *     cd kbiz-bot && bun run probe-duplicate-popup
 * Exit code 0 = every assertion held; non-zero = selector regression.
 */
import { chromium } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { clickDialogButton, DUPLICATE_DIALOG_HINT } from "./flows/transfer-other-flow";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/kbiz-duplicate-popup.dom.html");

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    return await run(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

async function run(browser: import("playwright").Browser) {
  let failures = 0;
  const check = (label: string, ok: boolean, detail?: string) => {
    console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
    if (!ok) failures++;
  };

  // 1) confirm (ยืนยัน) — must click the VISIBLE dialog's anchor, none of the decoys
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(FIXTURE).href);
    const res = await clickDialogButton(page, DUPLICATE_DIALOG_HINT, ["ยืนยัน", "Confirm"]);
    const who = await page.evaluate(() => (window as any).__clicked ?? null);
    check("confirm returns 'clicked'", res === "clicked", `got ${res}`);
    check("confirm hit the visible dialog's ยืนยัน", who === "confirm", `got ${who}`);
    await page.close();
  }

  // 2) cancel (ยกเลิก) — same scoping rules
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(FIXTURE).href);
    const res = await clickDialogButton(page, DUPLICATE_DIALOG_HINT, ["ยกเลิก", "Cancel"]);
    const who = await page.evaluate(() => (window as any).__clicked ?? null);
    check("cancel returns 'clicked'", res === "clicked", `got ${res}`);
    check("cancel hit the visible dialog's ยกเลิก", who === "cancel", `got ${who}`);
    await page.close();
  }

  // 3) popup absent (dialog closed) — must report not-found, click nothing
  {
    const page = await browser.newPage();
    await page.goto(pathToFileURL(FIXTURE).href);
    await page.evaluate(() => document.querySelector(".mfp-wrap")?.remove());
    const res = await clickDialogButton(page, DUPLICATE_DIALOG_HINT, ["ยืนยัน", "Confirm"]);
    const who = await page.evaluate(() => (window as any).__clicked ?? null);
    check("absent popup returns 'not-found'", res === "not-found", `got ${res}`);
    check("absent popup clicked nothing (hidden decoys untouched)", who === null, `got ${who}`);
    await page.close();
  }

  console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(2); });
