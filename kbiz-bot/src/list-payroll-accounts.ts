import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { withSession, gotoAuthenticated } from "./lib/session";

const LIST_URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";
// Write into the payroll-form's data/ dir (mounted as a volume by docker-compose)
const OUT_PATH = resolve("..", "data", "kbiz-registered.json");

await withSession(async (_ctx, page) => {
  await gotoAuthenticated(page, LIST_URL);
  // Let Angular finish populating the table
  await page.waitForTimeout(1500);

  console.log("→ Scraping account rows …");
  const accounts = await page.evaluate(() => {
    // The table renders the dashed format XXX-X-XXXXX-X. We pull the page
    // innerText, walk lines, and gather (name, account#) pairs.
    const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    const re = /^(\d{3}-\d-\d{5}-\d)$/;
    const out: { accountNumber: string; accountName: string }[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const accountNumber = m[1].replace(/-/g, "");
      // The cell immediately preceding the account number cell in the row is the name.
      const name = lines[i - 1] || "";
      // Skip header artifacts: row counter (often a digit), totals lines, etc.
      if (/^\d+$/.test(name)) continue;
      out.push({ accountNumber, accountName: name });
    }
    // Dedupe by accountNumber (in case the table renders cells nested oddly)
    const seen = new Set<string>();
    return out.filter((a) => (seen.has(a.accountNumber) ? false : (seen.add(a.accountNumber), true)));
  });

  console.log(`   found ${accounts.length} registered accounts`);
  for (const a of accounts.slice(0, 5)) console.log("   -", a.accountNumber, a.accountName);
  if (accounts.length > 5) console.log("   …");

  mkdirSync(resolve("..", "data"), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    count: accounts.length,
    accounts,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  console.log("✓ wrote", OUT_PATH);
});
