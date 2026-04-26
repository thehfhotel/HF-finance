import type { Page } from "playwright";
import { gotoAuthenticated } from "../lib/session";
import { waitForMobileConfirmation } from "../wait";
import type { FlowResult } from "./add-payroll-flow";

const URL = "https://kbiz.kasikornbank.com/menu/payroll/upload-transfer";

export async function runTransferPayrollFlow(page: Page, xlsxAbs: string): Promise<FlowResult> {
  await gotoAuthenticated(page, URL);

  console.log("→ Set file:", xlsxAbs);
  await page.locator('input[type="file"][name="uploadfile"]').setInputFiles(xlsxAbs);
  await page.waitForTimeout(2000);

  console.log("→ Click Next");
  const next = page
    .locator('a:has-text("Next"):visible, a:has-text("ถัดไป"):visible, #nextBtn:visible, button:has-text("Next"):visible')
    .first();
  await next.waitFor({ state: "visible", timeout: 30_000 });
  await next.click();

  const formatErrPopup = page.locator("#popup-payroll-incorrect");
  const duplicatePopup = page.locator("#popup-duplicate");
  const cannotPopup = page.locator('text=/cannot be added|cannot be processed|ไม่สามารถ/i');
  const reviewConfirm = page
    .locator('a:has-text("Confirm"):visible, a:has-text("ยืนยัน"):visible, button:has-text("Confirm"):visible')
    .first();

  type Outcome = "review" | "format-error" | "duplicate" | "cannot";
  let outcome: Outcome;
  try {
    outcome = await Promise.race<Outcome>([
      reviewConfirm.waitFor({ state: "visible", timeout: 60_000 }).then(() => "review"),
      formatErrPopup.waitFor({ state: "visible", timeout: 60_000 }).then(() => "format-error"),
      duplicatePopup.waitFor({ state: "visible", timeout: 60_000 }).then(() => "duplicate"),
      cannotPopup.first().waitFor({ state: "visible", timeout: 60_000 }).then(() => "cannot"),
    ]);
  } catch (e) {
    return { success: false, error: `No expected popup after Next: ${(e as Error).message}` };
  }
  console.log(`   post-Next outcome: ${outcome}`);

  if (outcome === "format-error") return { success: false, error: "File-format error" };
  if (outcome === "duplicate") return { success: false, error: "Duplicate-pending warning" };
  if (outcome === "cannot") {
    const txt = (await cannotPopup.first().innerText()).trim();
    return { success: false, error: `KBIZ refused: ${txt.slice(0, 400)}` };
  }

  console.log("→ Click Confirm — KBIZ pushes mobile notification");
  const beforeUrl = page.url();
  await reviewConfirm.click();

  await waitForMobileConfirmation({
    reason: "ยืนยันการโอนเงินเดือน (Payroll Transfer)",
    until: () =>
      page.waitForURL((url) => url.toString() !== beforeUrl, { timeout: 5 * 60_000 }),
    timeoutMs: 5 * 60_000,
  });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  return { success: true, finalUrl: page.url() };
}
