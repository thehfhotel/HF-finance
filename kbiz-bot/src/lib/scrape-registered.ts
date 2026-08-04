import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";

const OUT_PATH = resolve("..", "data", "kbiz-registered.json");

export type RegisteredAccount = {
  accountNumber: string;
  // The bank's own name-on-account, romanized (e.g. "MS. SALINTHIP PETRAK").
  accountName: string;
  // The Thai payee name on the KBIZ record — what the payroll app submitted
  // when the account was added. Blank if the row doesn't render one.
  payeeName: string;
};

// KBIZ renders 20 rows per page and caps the book at 500 accounts, so a full
// walk is 25 pages. 40 leaves headroom while still bounding the loop if the
// paginator ever misbehaves.
const MAX_PAGES = 40;

const ACCOUNT_RE = /^(\d{3}-\d-\d{5}-\d)$/;
const ANY_ACCOUNT_RE = /\b\d{3}-\d-\d{5}-\d\b/;

/**
 * Parse one rendered page of the payroll-account list from its innerText.
 * Each row renders as four lines — row counter, Thai payee name, the bank's
 * romanized name-on-account, then the account number:
 *
 *   1
 *   นางสาวสลิลทิพย์ เพชรรักษ์
 *   MS. SALINTHIP PETRAK
 *   317-2-48902-7
 */
export function parseAccountsFromText(text: string): RegisteredAccount[] {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const out: RegisteredAccount[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(ACCOUNT_RE);
    if (!m) continue;
    const accountName = lines[i - 1] ?? "";
    // A bare number here is the row-counter cell, not a name — the row didn't
    // render the way we expect, so don't invent an account from it.
    if (!accountName || /^\d+$/.test(accountName)) continue;
    const above = lines[i - 2] ?? "";
    out.push({
      accountNumber: m[1].replace(/-/g, ""),
      accountName,
      payeeName: !above || /^\d+$/.test(above) ? "" : above,
    });
  }
  return out;
}

/**
 * The paginator's "Accounts 1-20 of 21 accounts" line — the bank's own count
 * of the whole book, which is how we know a scrape came back short.
 *
 * Matched per line and anchored on the leading "Accounts", because the page
 * also carries "(maximum limit of 500 accounts in system)" — a looser pattern
 * reads that as the total and declares every scrape truncated.
 *
 * Returns null when the page renders no such line.
 */
export function parseTotalFromText(text: string): number | null {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const m =
      line.match(/^Accounts\s+[\d\s–-]+of\s+(\d+)\s+accounts/i) ??
      line.match(/^บัญชี\s*(?:ที่)?\s*[\d\s–-]+จาก\s+(\d+)\s*บัญชี/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

/**
 * The page operations collectRegisteredAccounts needs, split out from
 * Playwright so the paging logic is testable against fixtures.
 */
export type ListDriver = {
  readText(): Promise<string>;
  hasEnabledNext(): Promise<boolean>;
  clickNext(): Promise<void>;
};

/**
 * Walk every page of the list, accumulating accounts.
 *
 * The list is paginated at 20 rows/page and the paging is server-side, so
 * reading innerText once only ever sees the first 20 — which silently marked
 * every account past #20 as "not registered" once the book outgrew one page.
 */
export async function collectRegisteredAccounts(driver: ListDriver): Promise<RegisteredAccount[]> {
  const byNumber = new Map<string, RegisteredAccount>();
  let total: number | null = null;
  let pages = 0;
  let exhausted = false;

  for (let i = 0; i < MAX_PAGES; i++) {
    const text = await driver.readText();
    pages++;
    if (total === null) total = parseTotalFromText(text);
    for (const a of parseAccountsFromText(text)) {
      if (!byNumber.has(a.accountNumber)) byNumber.set(a.accountNumber, a);
    }
    if (!(await driver.hasEnabledNext())) {
      exhausted = true;
      break;
    }
    await driver.clickNext();
  }

  const accounts = [...byNumber.values()];

  // A short scrape used to succeed silently and overwrite the cache, which
  // shows real employees as "ยังไม่ลงทะเบียน" and lets the add-payroll
  // pre-flight re-submit an account KBIZ already has. Fail loudly instead.
  if (!exhausted) {
    throw new Error(`Paginator still offered more pages after ${MAX_PAGES} — refusing a truncated scrape`);
  }
  if (total !== null && accounts.length < total) {
    throw new Error(
      `KBIZ reports ${total} registered accounts but only ${accounts.length} were scraped across ` +
        `${pages} page(s) — refusing to overwrite the cache with a truncated list`
    );
  }

  return accounts;
}

function playwrightDriver(page: Page) {
  const firstAccount = () =>
    page.evaluate(() => {
      const m = document.body.innerText.match(/\b\d{3}-\d-\d{5}-\d\b/);
      return m ? m[0] : "";
    });

  const enabled = (selector: string) =>
    page.evaluate((sel) => {
      const a = document.querySelector(sel);
      if (!a) return false;
      return !a.closest("li")?.classList.contains("disabled");
    }, selector);

  // Paging hits the server, so wait for the row set to actually swap rather
  // than sleeping a fixed amount.
  const clickAndSettle = async (selector: string) => {
    const before = await firstAccount();
    await page.click(selector);
    await page
      .waitForFunction(
        ({ prev, re }) => {
          const m = document.body.innerText.match(new RegExp(re));
          return !!m && m[0] !== prev;
        },
        { prev: before, re: ANY_ACCOUNT_RE.source },
        { timeout: 20_000 }
      )
      .catch(() => {});
    await page.waitForTimeout(400);
  };

  return {
    readText: () => page.evaluate(() => document.body.innerText),
    hasEnabledNext: () => enabled(".paginations a.next"),
    clickNext: () => clickAndSettle(".paginations a.next"),
    // Leave the table on page 1: runAddPayrollFlow clicks "Add Account"
    // immediately after this scrape.
    async rewind() {
      for (let i = 0; i < MAX_PAGES; i++) {
        if (!(await enabled(".paginations a.prev"))) return;
        await clickAndSettle(".paginations a.prev");
      }
    },
  };
}

/**
 * Assumes `page` is already on the payroll-account list page
 * (/menu/setting/account-list/account-payroll). Reads every page of the
 * rendered table, writes data/kbiz-registered.json (the file the payroll-form
 * reads), and returns the parsed list.
 */
export async function scrapeRegisteredAccounts(
  page: Page
): Promise<{ fetchedAt: string; count: number; accounts: RegisteredAccount[] }> {
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  // Let Angular finish rendering rows before we read innerText
  await page.waitForTimeout(1500);

  const driver = playwrightDriver(page);
  const accounts = await collectRegisteredAccounts(driver);
  await driver.rewind().catch(() => {});

  mkdirSync(resolve("..", "data"), { recursive: true });
  const payload = {
    fetchedAt: new Date().toISOString(),
    count: accounts.length,
    accounts,
  };
  writeFileSync(OUT_PATH, JSON.stringify(payload, null, 2), "utf8");
  return payload;
}
