import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withSession, ensureLoggedIn } from "./lib/session";
import { waitForMobileConfirmation } from "./wait";

const ADD_URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";

async function main() {
  const filePath = process.argv[2];
  const observe = process.argv.includes("--observe"); // skip the final Confirm so user can verify
  if (!filePath) {
    throw new Error(
      `Usage: npm run add-payroll -- <path/to/KBIZAddBeneficiary.xlsx> [--observe]\n` +
        `       --observe stops at the review popup without clicking Confirm.`
    );
  }
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);

  await withSession(async (_ctx, page) => {
    await ensureLoggedIn(page);

    console.log("→ Opening", ADD_URL);
    await page.goto(ADD_URL, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    if (/error/.test(page.url())) throw new Error(`Bounced to ${page.url()} — session issue.`);

    console.log("→ Click 'Add Account' / 'เพิ่มบัญชี'");
    await page
      .locator('button:has-text("Add Account"):visible, a:has-text("Add Account"):visible, button:has-text("เพิ่มบัญชี"):visible, a:has-text("เพิ่มบัญชี"):visible')
      .first()
      .click();
    await page.waitForTimeout(800);

    console.log("→ Select Upload file mode");
    const uploadTab = page
      .locator('a:has-text("Upload file"):visible, button:has-text("Upload file"):visible, a:has-text("อัปโหลดไฟล์"):visible, button:has-text("อัปโหลดไฟล์"):visible')
      .first();
    if (await uploadTab.isVisible().catch(() => false)) {
      await uploadTab.click();
      await page.waitForTimeout(500);
    }

    console.log("→ Set file:", abs);
    await page.locator("#fileInput").setInputFiles(abs);
    await page.waitForTimeout(1500);

    console.log("→ Click Next to parse");
    await page
      .locator('a:has-text("Next"):visible, a:has-text("ถัดไป"):visible, #nextBtn:visible')
      .first()
      .click();

    // Race: review popup vs error popup
    const errorPopup = page.locator("#popup-payroll-incorrect");
    const reviewConfirm = page
      .locator('a:has-text("Confirm"):visible, a:has-text("ยืนยัน"):visible')
      .first();

    await Promise.race([
      errorPopup.waitFor({ state: "visible", timeout: 30_000 }),
      reviewConfirm.waitFor({ state: "visible", timeout: 30_000 }),
    ]);

    if (await errorPopup.isVisible().catch(() => false)) {
      const txt = (await errorPopup.innerText()).trim();
      console.log("\n❌ KBIZ rejected the file:");
      console.log(txt);
      throw new Error("Upload rejected — see message above.");
    }

    if (observe) {
      console.log("\n[--observe] stopping at review popup, browser stays open 2 min.");
      await page.waitForTimeout(2 * 60_000);
      return;
    }

    console.log("→ Click Confirm in review popup");
    await page.screenshot({ path: "before-confirm.png", fullPage: true });
    await reviewConfirm.click();

    // After clicking Confirm KBIZ shows the mobile-app approval prompt.
    // Success state: URL/page transitions to a "successfully added" view,
    // OR the list page reloads with the count increased. We accept several
    // signals via Promise.race.
    await waitForMobileConfirmation({
      reason: "ยืนยันการเพิ่มบัญชีรับเงินเดือน (Add Payroll Account)",
      until: () =>
        Promise.race([
          // Common success URL patterns observed on KBIZ confirmation flows
          page.waitForURL(/success|complete|done/i, { timeout: 4 * 60_000 }),
          // Generic success text in any language
          page
            .locator('text=/Successfully|สำเร็จ|เรียบร้อย|completed/i')
            .first()
            .waitFor({ state: "visible", timeout: 4 * 60_000 }),
          // Modal closes back to list page (file input is gone)
          page.locator("#fileInput").waitFor({ state: "detached", timeout: 4 * 60_000 }),
        ]),
      timeoutMs: 4 * 60_000,
    });

    await page.screenshot({ path: "after-confirm.png", fullPage: true });
    console.log(`   final URL: ${page.url()}`);
    console.log("\n✅ Add-payroll flow complete. Run 'npm run list' to refresh registered status.");
    await page.waitForTimeout(2_000);
  });
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
