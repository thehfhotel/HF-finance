import type { Page } from "playwright";
import { gotoAuthenticated } from "../lib/session";
import { scrapeRegisteredAccounts } from "../lib/scrape-registered";
import { readBeneficiaryAccountNumbers } from "../lib/read-xlsx";
import { waitForMobileConfirmation } from "../wait";

const URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";

export type FlowResult =
  | { success: true; finalUrl: string }
  | {
      success: false;
      error: string;
      /**
       * True only when this failure CANNOT prove the phone push is dead, so
       * the caller must keep the estate-wide arm lock standing (process-queue
       * / the CLIs release only when this is not true). Same meaning as
       * TransferOtherResult.pushMayBeLive. Absent ⇒ nothing was armed, or the
       * push was provably consumed/refused ⇒ safe to release.
       */
      pushMayBeLive?: boolean;
    };

export async function runAddPayrollFlow(page: Page, xlsxAbs: string): Promise<FlowResult> {
  await gotoAuthenticated(page, URL);

  console.log("→ Refresh registered list (we're already here)");
  const beforeReg = await scrapeRegisteredAccounts(page);
  console.log(`   ✓ ${beforeReg.count} registered accounts cached`);

  const fileAccts = readBeneficiaryAccountNumbers(xlsxAbs);
  const regSet = new Set(beforeReg.accounts.map((a) => a.accountNumber));
  const collisions = fileAccts.filter((n) => regSet.has(n));
  console.log(`→ Pre-flight: ${fileAccts.length} accounts in xlsx, ${collisions.length} already registered`);
  if (collisions.length > 0) {
    return {
      success: false,
      error: `${collisions.length} account(s) already registered: ${collisions.join(", ")}`,
    };
  }

  console.log("→ Click 'Add Account'");
  await page
    .locator(
      'button:has-text("Add Account"):visible, a:has-text("Add Account"):visible, button:has-text("เพิ่มบัญชี"):visible, a:has-text("เพิ่มบัญชี"):visible'
    )
    .first()
    .click();
  await page.waitForTimeout(800);

  const uploadTab = page
    .locator(
      'a:has-text("Upload file"):visible, button:has-text("Upload file"):visible, a:has-text("อัปโหลดไฟล์"):visible, button:has-text("อัปโหลดไฟล์"):visible'
    )
    .first();
  if (await uploadTab.isVisible().catch(() => false)) {
    await uploadTab.click();
    await page.waitForTimeout(500);
  }

  console.log("→ Set file:", xlsxAbs);
  await page.locator("#fileInput").setInputFiles(xlsxAbs);
  await page.waitForTimeout(1500);

  console.log("→ Click Next");
  await page
    .locator('a:has-text("Next"):visible, a:has-text("ถัดไป"):visible, #nextBtn:visible')
    .first()
    .click();

  // Race popups vs review screen
  const cannotAddPopup = page.locator('text=/Account cannot be added|ไม่สามารถเพิ่มบัญชี/i');
  const formatErrPopup = page.locator("#popup-payroll-incorrect");
  const duplicatePopup = page.locator("#popup-duplicate");
  const reviewScreen = page.locator(
    'text=/Please confirm these Payroll Accounts|กรุณายืนยันบัญชีรับเงินเดือน|A notification has been sent to the K BIZ application/i'
  );

  type Outcome = "cannot-add" | "format-error" | "duplicate" | "review";
  let outcome: Outcome;
  try {
    outcome = await Promise.race<Outcome>([
      cannotAddPopup.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "cannot-add"),
      formatErrPopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "format-error"),
      duplicatePopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "duplicate"),
      reviewScreen.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "review"),
    ]);
  } catch (e) {
    // AMBIGUOUS, and the only ambiguous exit this flow has. On THIS page the
    // push is armed by Next itself (the review screen KBIZ renders next is the
    // one that says "A notification has been sent to the K BIZ application") —
    // so 30 s with neither a rejection popup nor that screen cannot prove no
    // notification went out. Hold the arm lock. Every branch below saw KBIZ
    // answer, so each of those IS provable.
    return {
      success: false,
      error: `No expected popup after Next: ${(e as Error).message}`,
      pushMayBeLive: true,
    };
  }
  console.log(`   post-Next outcome: ${outcome}`);

  if (outcome === "cannot-add") {
    const txt = (await cannotAddPopup.first().innerText()).trim();
    return { success: false, error: `KBIZ rejected: ${txt.slice(0, 400)}` };
  }
  if (outcome === "format-error") {
    const txt = (await formatErrPopup.innerText()).trim();
    return { success: false, error: `Format error: ${txt.slice(0, 400)}` };
  }
  if (outcome === "duplicate") {
    return { success: false, error: "Duplicate-pending warning from KBIZ" };
  }

  // Review screen present — KBIZ already pushed the phone notification
  const PROMPT_RE = "A notification has been sent to the K BIZ application|กรุณาเปิดแอป K BIZ";
  await waitForMobileConfirmation({
    reason: "ยืนยันการเพิ่มบัญชีรับเงินเดือน (Add Payroll Account)",
    until: () =>
      page.waitForFunction(
        (regex: string) => {
          const re = new RegExp(regex, "i");
          return !re.test((document.body as HTMLElement).innerText || "");
        },
        PROMPT_RE,
        { timeout: 5 * 60_000 }
      ),
    timeoutMs: 5 * 60_000,
  });

  // Refresh cache so the new account is in registered list immediately
  try {
    await gotoAuthenticated(page, URL);
    await scrapeRegisteredAccounts(page);
  } catch {}

  return { success: true, finalUrl: page.url() };
}
