import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withSession, ensureLoggedIn, gotoAuthenticated } from "./lib/session";
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
    await gotoAuthenticated(page, ADD_URL);

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

    // After Next, KBIZ shows ONE of:
    //   review popup (good)         — Confirm button to commit
    //   "Account cannot be added"   — name didn't match KBank records, or other validation
    //   #popup-payroll-incorrect    — file-level error (bad xlsx format)
    //   #popup-duplicate            — same account already in pending changes
    const cannotAddPopup = page.locator(
      'text=/Account cannot be added|ไม่สามารถเพิ่มบัญชี/i'
    );
    const formatErrPopup = page.locator("#popup-payroll-incorrect");
    const duplicatePopup = page.locator("#popup-duplicate");
    const reviewConfirm = page
      .locator('a:has-text("Confirm"):visible, a:has-text("ยืนยัน"):visible, button:has-text("Confirm"):visible')
      .first();

    type Outcome = "cannot-add" | "format-error" | "duplicate" | "review";
    let outcome: Outcome;
    try {
      outcome = await Promise.race<Outcome>([
        cannotAddPopup.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "cannot-add" as const),
        formatErrPopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "format-error" as const),
        duplicatePopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "duplicate" as const),
        reviewConfirm.waitFor({ state: "visible", timeout: 30_000 }).then(() => "review" as const),
      ]);
    } catch (e) {
      await page.screenshot({ path: "stuck-after-next.png", fullPage: true });
      const snippet = (await page.evaluate(() => document.body.innerText)).slice(0, 1000);
      console.log("\nstuck-after-next.png saved. Page text snippet:\n" + snippet);
      throw e;
    }
    console.log(`   post-Next outcome: ${outcome}`);
    await page.screenshot({ path: `outcome-${outcome}.png`, fullPage: true });

    if (outcome === "cannot-add") {
      const report = await extractCannotAddReport(page);
      console.log("\n❌ KBIZ rejected the following accounts:");
      console.log(`   Title: ${report.title}`);
      if (report.subtitle) console.log(`   ${report.subtitle}`);
      console.log("");
      if (report.rows.length === 0) {
        console.log("   (could not extract row details — see outcome-cannot-add.png)");
      } else {
        for (let i = 0; i < report.rows.length; i++) {
          const r = report.rows[i];
          console.log(`   ${i + 1}. Account: ${r.accountNumber || "?"}`);
          console.log(`      Name:    ${r.accountName || "?"}`);
          console.log(`      Reason:  ${r.reason || "?"}`);
        }
      }
      throw new Error(`KBIZ refused ${report.rows.length || "?"} account(s). See report above.`);
    }

    if (outcome === "format-error") {
      const txt = (await formatErrPopup.innerText()).trim();
      console.log("\n❌ File-format error:\n" + txt);
      throw new Error("Upload rejected.");
    }

    if (outcome === "duplicate") {
      const txt = (await duplicatePopup.innerText()).trim();
      console.log("\n⚠️  Duplicate-account warning:\n" + txt);
      throw new Error(
        "KBIZ flagged duplicates. Run 'npm run list' then regenerate the xlsx without those accounts."
      );
    }

    if (observe) {
      console.log("\n[--observe] stopping at review popup, browser stays open 2 min.");
      await page.waitForTimeout(2 * 60_000);
      return;
    }

    console.log("→ Click Confirm in review popup");
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

type CannotAddReport = {
  title: string;
  subtitle: string;
  rows: { accountNumber: string; accountName: string; reason: string }[];
};

async function extractCannotAddReport(page: import("playwright").Page): Promise<CannotAddReport> {
  return await page.evaluate((): CannotAddReport => {
    // Find the visible popup containing the "Account cannot be added" header.
    const headerNode = Array.from(document.querySelectorAll("*")).find((e) => {
      const t = (e.textContent || "").trim();
      const visible = (e as HTMLElement).offsetParent !== null;
      return visible && /^Account cannot be added$|^ไม่สามารถเพิ่มบัญชี/i.test(t);
    });
    if (!headerNode) return { title: "(header not found)", subtitle: "", rows: [] };

    // Climb to the closest visible container that has substantial content.
    let popup: HTMLElement | null = headerNode as HTMLElement;
    while (
      popup &&
      popup.parentElement &&
      (popup.innerText || "").trim().split("\n").length < 4
    ) {
      popup = popup.parentElement;
    }
    const popupText = (popup?.innerText || "").trim();
    if (!popupText) return { title: headerNode.textContent?.trim() || "", subtitle: "", rows: [] };

    const title = headerNode.textContent?.trim() || "";
    const lines = popupText.split("\n").map((s) => s.trim()).filter(Boolean);
    const titleIdx = lines.findIndex((s) => s === title);
    const subtitle = titleIdx >= 0 && titleIdx + 1 < lines.length ? lines[titleIdx + 1] : "";

    // Each rejected row: a line starting with a KBank account number (XXX-X-XXXXX-X)
    // followed by name and reason, possibly split across multiple text lines OR one tab-joined line.
    const rows: CannotAddReport["rows"] = [];
    const acctRe = /\d{3}-\d-\d{5}-\d/;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(acctRe);
      if (!m) continue;
      // Single-line case: "ACCT NAME REASON" separated by whitespace
      const full = lines[i];
      const acctNum = m[0];
      const after = full.slice(full.indexOf(acctNum) + acctNum.length).trim();
      if (after) {
        // Heuristic: name is until the first reason keyword, rest is the reason.
        // Reasons often start with "This", "Account", or a Thai equivalent.
        const reasonMatch = after.match(/(?:This|Account|บัญชี|ชื่อ|Name)[\s\S]*$/i);
        if (reasonMatch) {
          rows.push({
            accountNumber: acctNum,
            accountName: after.slice(0, reasonMatch.index).trim(),
            reason: reasonMatch[0].trim(),
          });
          continue;
        }
        // Fall back: split on multiple spaces
        const parts = after.split(/\s{2,}|\t/).filter(Boolean);
        if (parts.length >= 2) {
          rows.push({ accountNumber: acctNum, accountName: parts[0], reason: parts.slice(1).join(" ") });
          continue;
        }
        rows.push({ accountNumber: acctNum, accountName: "", reason: after });
        continue;
      }
      // Multi-line case: name on next line, reason on the line after.
      const name = lines[i + 1] || "";
      const reason = lines[i + 2] || "";
      rows.push({ accountNumber: acctNum, accountName: name, reason });
    }
    return { title, subtitle, rows };
  });
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
