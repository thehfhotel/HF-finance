import { chromium } from "playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";
const STATE_PATH = "storageState.json";

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error(
      `Usage: npm run add-payroll -- <path/to/KBIZAddBeneficiary.xlsx>\n` +
        `       (path is relative to kbiz-bot/ or absolute)`
    );
  }
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);
  if (!existsSync(STATE_PATH)) throw new Error("No storageState.json — run 'npm run login' first.");

  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log(`   ↳ ${frame.url()}`);
  });

  console.log("→ Opening", URL);
  await page.goto(URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  if (/login|authen|error/i.test(page.url())) {
    throw new Error(`Session not valid. Got bounced to ${page.url()} — re-run 'npm run login'.`);
  }

  // The landing page shows the existing list. Click "Add Account" / "เพิ่มบัญชี"
  // to open the modal that contains the Key-in / Upload-file tabs.
  console.log("→ Clicking 'Add Account' / 'เพิ่มบัญชี' to open add-account modal");
  await page
    .locator(
      'button:has-text("Add Account"), a:has-text("Add Account"), button:has-text("เพิ่มบัญชี"), a:has-text("เพิ่มบัญชี")'
    )
    .first()
    .click();
  await page.waitForTimeout(800);

  // Inside the modal, choose Upload file mode if not already selected.
  console.log("→ Selecting Upload file / อัปโหลดไฟล์ mode");
  const uploadTab = page
    .locator(
      'a:has-text("Upload file"):visible, button:has-text("Upload file"):visible, a:has-text("อัปโหลดไฟล์"):visible, button:has-text("อัปโหลดไฟล์"):visible'
    )
    .first();
  if (await uploadTab.isVisible().catch(() => false)) {
    await uploadTab.click();
    await page.waitForTimeout(500);
  }

  console.log("→ Setting file:", abs);
  await page.locator("#fileInput").setInputFiles(abs);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "after-set-file.png", fullPage: true });

  console.log("→ Clicking Next / ถัดไป to parse / preview");
  const next = page
    .locator('a:has-text("Next"):visible, a:has-text("ถัดไป"):visible, #nextBtn:visible')
    .first();
  await next.waitFor({ state: "visible", timeout: 30_000 });
  await next.click();

  // Two possible outcomes:
  //   A) review popup appears with a Confirm button (good xlsx)
  //   B) #popup-payroll-incorrect appears (bad data — show user the message)
  await Promise.race([
    page.locator("#popup-payroll-incorrect").waitFor({ state: "visible", timeout: 30_000 }),
    page
      .locator('text=/Please confirm these Payroll Accounts|กรุณายืนยันบัญชีรับเงินเดือน/i')
      .first()
      .waitFor({ state: "visible", timeout: 30_000 }),
    page.locator('a:has-text("Confirm"):visible, a:has-text("ยืนยัน"):visible').first().waitFor({ state: "visible", timeout: 30_000 }),
  ]);

  if (await page.locator("#popup-payroll-incorrect").isVisible().catch(() => false)) {
    const txt = (await page.locator("#popup-payroll-incorrect").innerText()).trim();
    console.log("\n❌ KBIZ rejected the file:");
    console.log(txt);
    throw new Error("Upload rejected — see message above.");
  }

  console.log("\n✅ File parsed. Review popup is open in the browser.");
  console.log("   First-run safety: NOT auto-clicking Confirm.");
  console.log("   Inspect the entries in the popup — if they look correct, click Confirm by hand.");
  console.log("   Once we know what the post-Confirm screens look like, we'll automate that step.");
  console.log("\n   Browser will stay open for 5 minutes so you can finish manually.");
  await page.waitForTimeout(5 * 60_000);

  await browser.close();
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
