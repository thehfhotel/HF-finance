import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withSession, gotoAuthenticated } from "./lib/session";
import { waitForMobileConfirmation } from "./wait";

const URL = "https://kbiz.kasikornbank.com/menu/payroll/upload-transfer";

async function main() {
  const filePath = process.argv[2];
  const observe = process.argv.includes("--observe");
  if (!filePath) {
    throw new Error(
      `Usage: npm run transfer-payroll -- <path/to/KBIZPayroll-DD-MM-YYYY.xlsx> [--observe]\n` +
        `       --observe stops at the review screen without committing.`
    );
  }
  const abs = resolve(filePath);
  if (!existsSync(abs)) throw new Error(`File not found: ${abs}`);

  await withSession(async (_ctx, page) => {
    await gotoAuthenticated(page, URL);

    console.log("→ Set file:", abs);
    // The file input has no id but a stable name="uploadfile". setInputFiles
    // works on hidden inputs.
    await page.locator('input[type="file"][name="uploadfile"]').setInputFiles(abs);
    await page.waitForTimeout(2000);
    await page.screenshot({ path: "transfer-after-set-file.png", fullPage: true });

    console.log("→ Click Next to parse / proceed to confirm");
    const next = page
      .locator('a:has-text("Next"):visible, a:has-text("ถัดไป"):visible, #nextBtn:visible, button:has-text("Next"):visible')
      .first();
    await next.waitFor({ state: "visible", timeout: 30_000 });
    await next.click();

    // After Next, KBIZ shows ONE of:
    //   review screen (good) — table of transactions + Back/Confirm buttons
    //   #popup-payroll-incorrect — bad xlsx format
    //   #popup-duplicate / "ไม่สามารถ" — server validation rejection
    // The transfer flow's review has its own Confirm BUTTON (unlike add-payroll
    // where Next directly pushed the mobile notification).
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
        reviewConfirm.waitFor({ state: "visible", timeout: 60_000 }).then(() => "review" as const),
        formatErrPopup.waitFor({ state: "visible", timeout: 60_000 }).then(() => "format-error" as const),
        duplicatePopup.waitFor({ state: "visible", timeout: 60_000 }).then(() => "duplicate" as const),
        cannotPopup.first().waitFor({ state: "visible", timeout: 60_000 }).then(() => "cannot" as const),
      ]);
    } catch (e) {
      await page.screenshot({ path: "transfer-stuck-after-next.png", fullPage: true });
      const snippet = (await page.evaluate(() => document.body.innerText)).slice(0, 1500);
      console.log("\ntransfer-stuck-after-next.png saved. Page snippet:\n" + snippet);
      throw e;
    }
    console.log(`   post-Next outcome: ${outcome}`);
    await page.screenshot({ path: `transfer-outcome-${outcome}.png`, fullPage: true });

    if (outcome === "format-error") {
      const txt = (await formatErrPopup.innerText()).trim();
      console.log("\n❌ File-format error:\n" + txt);
      throw new Error("Upload rejected.");
    }
    if (outcome === "duplicate") {
      const txt = (await duplicatePopup.innerText()).trim();
      console.log("\n⚠️  Duplicate / pending warning:\n" + txt);
      throw new Error("Pending transaction conflict.");
    }
    if (outcome === "cannot") {
      const txt = (await cannotPopup.first().innerText()).trim();
      console.log("\n❌ KBIZ refused:\n" + txt);
      throw new Error("Transfer rejected.");
    }

    // Surface the review summary to the user before clicking Confirm
    const summary = await page.evaluate(() => (document.body as HTMLElement).innerText.slice(-1500));
    console.log("\n--- review summary ---");
    console.log(summary);

    if (observe) {
      console.log("\n[--observe] stopping at review screen — Confirm not clicked, browser stays open 2 min.");
      await page.waitForTimeout(2 * 60_000);
      return;
    }

    console.log("\n→ Click Confirm — KBIZ will push the mobile-app notification");
    const beforeConfirmUrl = page.url();
    await reviewConfirm.click();

    // After Confirm, wait for the URL to actually change away from the review
    // page. KBIZ's success path navigates to /payroll-result (or similar) only
    // AFTER the phone tap. The wizard "Step success" text is on every step's
    // breadcrumb so we can't use innerText as a signal.
    await waitForMobileConfirmation({
      reason: "ยืนยันการโอนเงินเดือน (Payroll Transfer)",
      until: () =>
        page.waitForURL((url) => url.toString() !== beforeConfirmUrl, {
          timeout: 5 * 60_000,
        }),
      timeoutMs: 5 * 60_000,
    });
    // Let any final navigations settle
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

    await page.screenshot({ path: "transfer-after-confirm.png", fullPage: true });
    console.log(`   final URL: ${page.url()}`);
    console.log("\n✅ Payroll transfer flow complete.");
    await page.waitForTimeout(2_000);
  });
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
