import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";

const OUT_PATH = resolve("..", "data", "kbiz-registered.json");

export type RegisteredAccount = { accountNumber: string; accountName: string };

/**
 * Assumes `page` is already on the payroll-account list page
 * (/menu/setting/account-list/account-payroll). Reads the rendered table
 * by text-walking innerText, writes data/kbiz-registered.json (the file
 * the payroll-form reads), and returns the parsed list.
 */
export async function scrapeRegisteredAccounts(
  page: Page
): Promise<{ fetchedAt: string; count: number; accounts: RegisteredAccount[] }> {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // Let Angular finish rendering rows before we read innerText
  await page.waitForTimeout(1500);

  const accounts = await page.evaluate((): RegisteredAccount[] => {
    const lines = document.body.innerText.split("\n").map((l) => l.trim()).filter(Boolean);
    const re = /^(\d{3}-\d-\d{5}-\d)$/;
    const out: RegisteredAccount[] = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(re);
      if (!m) continue;
      const accountNumber = m[1].replace(/-/g, "");
      const name = lines[i - 1] || "";
      if (/^\d+$/.test(name)) continue; // skip row-counter cells
      out.push({ accountNumber, accountName: name });
    }
    const seen = new Set<string>();
    return out.filter((a) => (seen.has(a.accountNumber) ? false : (seen.add(a.accountNumber), true)));
  });

  mkdirSync(resolve("..", "data"), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    count: accounts.length,
    accounts,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
