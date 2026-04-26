import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { withSession, gotoAuthenticated } from "./lib/session";
import { scrapeRegisteredAccounts } from "./lib/scrape-registered";
import { readBeneficiaryAccountNumbers } from "./lib/read-xlsx";
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

    // Refresh local cache while we're on the page anyway. This catches manual
    // adds/removals done outside the bot since the last scrape.
    console.log("→ Refresh registered list (we're already here)");
    const beforeReg = await scrapeRegisteredAccounts(page);
    console.log(`   ✓ ${beforeReg.count} registered accounts now cached`);

    // Pre-flight collision check — read account numbers from the xlsx and
    // compare against the just-scraped registered set. KBIZ rejects uploads
    // containing already-registered accounts; abort early with a clear list.
    const fileAccts = readBeneficiaryAccountNumbers(abs);
    const regSet = new Set(beforeReg.accounts.map((a) => a.accountNumber));
    const collisions = fileAccts.filter((n) => regSet.has(n));
    console.log(`→ Pre-flight: ${fileAccts.length} accounts in xlsx, ${collisions.length} already registered`);
    if (collisions.length > 0) {
      const fileSet = new Set(fileAccts);
      const regByNum = new Map(beforeReg.accounts.map((a) => [a.accountNumber, a.accountName]));
      console.log("\n❌ The following accounts are already registered with KBIZ:");
      for (const n of collisions) console.log(`   - ${n}  (KBIZ has: ${regByNum.get(n) ?? "?"})`);
      const newOnes = [...fileSet].filter((n) => !regSet.has(n));
      if (newOnes.length === 0) {
        throw new Error("All accounts in the xlsx are already registered. Nothing to upload.");
      }
      console.log(
        `\n   ${newOnes.length} truly new account(s): ${newOnes.join(", ")}` +
          `\n   Regenerate the xlsx via /accounts (it auto-filters now), or remove the collisions.`
      );
      throw new Error(`${collisions.length} collision(s) — aborting before upload.`);
    }

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
    //   review screen (good)        — "Please confirm these Payroll Accounts" + phone-app prompt
    //   "Account cannot be added"   — server-side rejection (e.g. duplicate)
    //   #popup-payroll-incorrect    — file-level error (bad xlsx format)
    //   #popup-duplicate            — duplicate-pending popup
    // The review screen has NO Confirm button — clicking Next has already
    // sent the mobile-app notification; the user just taps Approve on phone.
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
        cannotAddPopup.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "cannot-add" as const),
        formatErrPopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "format-error" as const),
        duplicatePopup.waitFor({ state: "visible", timeout: 30_000 }).then(() => "duplicate" as const),
        reviewScreen.first().waitFor({ state: "visible", timeout: 30_000 }).then(() => "review" as const),
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
      console.log("\n[--observe] stopping at review screen — DO NOT approve on phone yet, browser stays open 2 min.");
      await page.waitForTimeout(2 * 60_000);
      return;
    }

    // Review screen is up and KBIZ has already pushed the notification to the
    // mobile app. Wait for the user to tap Approve. We poll for the
    // notification-pending text to actually disappear (waitFor "detached"
    // resolves immediately when an element was never present, so it can't
    // be used as a signal here).
    const PROMPT_RE =
      "A notification has been sent to the K BIZ application|กรุณาเปิดแอป K BIZ";
    await waitForMobileConfirmation({
      reason: "ยืนยันการเพิ่มบัญชีรับเงินเดือน (Add Payroll Account)",
      until: () =>
        page.waitForFunction(
          (regex: string) => {
            const re = new RegExp(regex, "i");
            const text = (document.body as HTMLElement).innerText || "";
            // Truthy when the pending-approval prompt has cleared from the page
            return !re.test(text);
          },
          PROMPT_RE,
          { timeout: 5 * 60_000 }
        ),
      timeoutMs: 5 * 60_000, // KBIZ countdown is 5:30, allow ~5
    });

    await page.screenshot({ path: "after-confirm.png", fullPage: true });
    console.log(`   final URL: ${page.url()}`);

    // Best-effort post-success refresh: navigate back to the list page so the
    // newly-added account is cached without needing a separate `npm run list`.
    try {
      await gotoAuthenticated(page, ADD_URL);
      const afterReg = await scrapeRegisteredAccounts(page);
      console.log(`✓ Registered list refreshed: ${afterReg.count} accounts (was ${beforeReg.count}).`);
    } catch (e) {
      console.log("⚠️  Post-confirm refresh failed:", (e as Error).message);
      console.log("   Run 'npm run list' manually to update the cache.");
    }

    console.log("\n✅ Add-payroll flow complete.");
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
