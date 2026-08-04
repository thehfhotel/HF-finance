// The KBIZ payroll-account list paginates at 20 rows/page with server-side
// paging. The scraper used to read innerText once, so the moment the book
// outgrew a single page every account past #20 silently vanished from
// data/kbiz-registered.json and showed as "ยังไม่ลงทะเบียน" in the app.
// Fixtures are redacted copies of the real page — same structure, fake people.
// Run with `bun test`.

import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  collectRegisteredAccounts,
  parseAccountsFromText,
  parseTotalFromText,
  type ListDriver,
} from "../src/lib/scrape-registered";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures", name), "utf8");
const PAGE1 = fixture("list-page1.txt");
const PAGE2 = fixture("list-page2.txt");

// The 21st account — the one that only exists on page 2.
const ON_PAGE_2 = "1213100211";

function pagedDriver(pages: string[]): ListDriver & { visited: () => number } {
  let i = 0;
  return {
    readText: async () => pages[i],
    hasEnabledNext: async () => i < pages.length - 1,
    clickNext: async () => {
      i++;
    },
    visited: () => i + 1,
  };
}

describe("parseAccountsFromText", () => {
  it("reads both names off each row", () => {
    const accounts = parseAccountsFromText(PAGE1);
    expect(accounts).toHaveLength(20);
    expect(accounts[0]).toEqual({
      accountNumber: "1011100011",
      accountName: "MS. TESTONE SAMPLE",
      payeeName: "นางสาวทดสอบ หนึ่ง",
    });
  });

  it("ignores page chrome that isn't a row", () => {
    const accounts = parseAccountsFromText(
      ["Add or delete Payroll Accounts", "(maximum limit of 500 accounts in system)", "No.", "Account Number"].join("\n")
    );
    expect(accounts).toEqual([]);
  });

  it("skips a row whose name cell is the row counter", () => {
    // Guards against inventing an account when the row renders unexpectedly.
    expect(parseAccountsFromText(["7", "101-1-10001-1"].join("\n"))).toEqual([]);
  });
});

describe("parseTotalFromText", () => {
  it("reads the bank's own total off the paginator", () => {
    expect(parseTotalFromText(PAGE1)).toBe(21);
    expect(parseTotalFromText(PAGE2)).toBe(21);
  });

  it("returns null when the page renders no paginator", () => {
    expect(parseTotalFromText("Add or delete Payroll Accounts")).toBeNull();
  });
});

describe("collectRegisteredAccounts", () => {
  it("walks every page, so the 21st account is not lost", async () => {
    const driver = pagedDriver([PAGE1, PAGE2]);
    const accounts = await collectRegisteredAccounts(driver);

    expect(accounts).toHaveLength(21);
    expect(driver.visited()).toBe(2);
    expect(accounts.map((a) => a.accountNumber)).toContain(ON_PAGE_2);
    expect(accounts.at(-1)).toEqual({
      accountNumber: ON_PAGE_2,
      accountName: "MS. TESTTWENTYONE SAMPLE",
      payeeName: "นางสาวทดสอบ ยี่สิบเอ็ด",
    });
  });

  it("refuses a truncated scrape rather than overwriting the cache", async () => {
    // Exactly the old behaviour: read page 1, never page 2. The paginator
    // still says "of 21", so a 20-row result is provably short.
    const onlyFirstPage: ListDriver = {
      readText: async () => PAGE1,
      hasEnabledNext: async () => false,
      clickNext: async () => {},
    };
    await expect(collectRegisteredAccounts(onlyFirstPage)).rejects.toThrow(/21 registered accounts but only 20/);
  });

  it("dedupes when a page repeats", async () => {
    const accounts = await collectRegisteredAccounts(pagedDriver([PAGE1, PAGE1, PAGE2]));
    expect(accounts).toHaveLength(21);
  });

  it("accepts a single page when the bank reports no more", async () => {
    const singlePage = PAGE1.replace("Accounts 1-20 of 21 accounts", "Accounts 1-20 of 20 accounts");
    const accounts = await collectRegisteredAccounts({
      readText: async () => singlePage,
      hasEnabledNext: async () => false,
      clickNext: async () => {},
    });
    expect(accounts).toHaveLength(20);
  });
});
