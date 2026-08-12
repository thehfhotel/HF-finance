// The saved-payee picker, both directions: scraping it read-only into the
// masked queue/kbiz-favorites.json, and matching a row back at transfer time.
//
// Every row here is invented — the picker's real contents are bank data and
// never enter this repo. What IS real is the shape: cells arrive as
// <p>label</p><p>value</p> pairs and every row renders twice (the desktop
// hidden-ip-pro variant plus the ipad visible-ip-pro one), which is what the
// dedupe and the first-wins parsing exist for.
//
// Run with `bun test`.

import { describe, expect, it } from "bun:test";
import {
  collectFavorites,
  matchFavoriteRows,
  parseFavoriteRowCells,
  rowHasAccountEndingWith,
  toFavorite,
  type FavoritesDriver,
} from "../src/lib/favorites-core";

/** One rendered row's <p> texts, in DOM order. */
const row = (nickname: string, accountName: string, bank: string, accountNo: string) => [
  "Display Name",
  nickname,
  "Account Name",
  accountName,
  "Bank",
  bank,
  "Account No.",
  accountNo,
];

const ROW_A = row("พี่วิว", "MS. TESTONE SAMPLE", "Siam Commercial Bank", "111-2-34567-8");
const ROW_B = row("ร้านวัสดุ", "MR. TESTTWO SAMPLE", "Kasikornbank", "222-3-45678-9");

describe("parseFavoriteRowCells", () => {
  it("reads every cell off the label/value pairs", () => {
    expect(parseFavoriteRowCells(ROW_A)).toEqual({
      nickname: "พี่วิว",
      accountName: "MS. TESTONE SAMPLE",
      bank: "Siam Commercial Bank",
      accountNo: "111-2-34567-8",
    });
  });

  it("takes the first value when a row renders both viewport variants inside it", () => {
    expect(parseFavoriteRowCells([...ROW_A, ...ROW_A])).toEqual(parseFavoriteRowCells(ROW_A));
  });

  it("tolerates label punctuation, whitespace and the Thai labels", () => {
    expect(
      parseFavoriteRowCells(["ชื่อที่แสดง :", "  พี่วิว ", "ธนาคาร:", "Siam Commercial Bank", "เลขที่บัญชี", "111-2-34567-8"]),
    ).toEqual({
      nickname: "พี่วิว",
      accountName: "",
      bank: "Siam Commercial Bank",
      accountNo: "111-2-34567-8",
    });
  });

  it("returns null for a row missing the nickname, bank or account number", () => {
    expect(parseFavoriteRowCells(["Account Name", "MS. TESTONE SAMPLE", "Bank", "Siam Commercial Bank"])).toBeNull();
    expect(parseFavoriteRowCells(["Display Name", "พี่วิว", "Bank", "Siam Commercial Bank"])).toBeNull();
    expect(parseFavoriteRowCells(["Display Name", "พี่วิว", "Account No.", "111-2-34567-8"])).toBeNull();
  });

  it("returns null when a label rendered no value, rather than eating the next label", () => {
    expect(parseFavoriteRowCells(["Display Name", "Account No.", "111-2-34567-8"])).toBeNull();
  });

  it("returns null for something too short to be an account number", () => {
    expect(parseFavoriteRowCells(row("พี่วิว", "MS. TESTONE SAMPLE", "Kasikornbank", "12-3"))).toBeNull();
  });

  it("ignores page chrome that isn't a row", () => {
    expect(parseFavoriteRowCells(["Search", "Favorite Account", "Close"])).toBeNull();
  });
});

describe("toFavorite", () => {
  it("publishes only the last 4 digits", () => {
    const fav = toFavorite({
      nickname: "พี่วิว",
      accountName: "MS. TESTONE SAMPLE",
      bank: "Siam Commercial Bank",
      accountNo: "111-2-34567-8",
    });
    expect(fav).toEqual({
      nickname: "พี่วิว",
      accountName: "MS. TESTONE SAMPLE",
      bank: "Siam Commercial Bank",
      accountMasked: "…5678",
      accountLast4: "5678",
    });
    expect(JSON.stringify(fav)).not.toContain("1112345678");
  });
});

function pagedDriver(pages: string[][][]): FavoritesDriver & { visited: () => number } {
  let i = 0;
  return {
    readRows: async () => pages[i],
    hasNextPage: async () => i < pages.length - 1,
    clickNextPage: async () => {
      i++;
    },
    visited: () => i + 1,
  };
}

describe("collectFavorites", () => {
  it("walks every page and dedupes the double-rendered rows", async () => {
    // Each row appears twice per page (desktop + ipad variants).
    const driver = pagedDriver([
      [ROW_A, ROW_A, ROW_B, ROW_B],
      [row("ป้าหนู", "MS. TESTTHREE SAMPLE", "Bangkok Bank", "020-4-01234-567")],
    ]);

    const favorites = await collectFavorites(driver);

    expect(driver.visited()).toBe(2);
    expect(favorites.map((f) => f.nickname)).toEqual(["พี่วิว", "ร้านวัสดุ", "ป้าหนู"]);
    expect(favorites.map((f) => f.accountLast4)).toEqual(["5678", "6789", "4567"]);
    expect(favorites.every((f) => f.accountMasked.startsWith("…"))).toBe(true);
  });

  it("keeps two saved accounts that share a nickname", async () => {
    const favorites = await collectFavorites(
      pagedDriver([[row("พี่วิว", "MS. TESTONE SAMPLE", "Kasikornbank", "111-2-34567-8"), row("พี่วิว", "MS. TESTONE SAMPLE", "Bangkok Bank", "222-3-45678-9")]]),
    );
    expect(favorites).toHaveLength(2);
  });

  it("refuses a picker that rendered no rows at all", async () => {
    // Publishing [] would overwrite a good manifest with "you have no saved
    // accounts" — a modal that hasn't painted must fail the sync instead, so
    // the previous list survives.
    await expect(collectFavorites(pagedDriver([[]]))).rejects.toThrow(/no picker rows at all/);
  });

  it("refuses a truncated list when the paginator never runs out", async () => {
    const endless: FavoritesDriver = {
      readRows: async () => [ROW_A],
      hasNextPage: async () => true,
      clickNextPage: async () => {},
    };
    await expect(collectFavorites(endless)).rejects.toThrow(/refusing a truncated list/);
  });

  it("refuses to publish an empty list when rows were there but none parsed", async () => {
    // The markup changed — publishing [] would read as "you have no saved
    // accounts" in the approver's picker.
    const driver = pagedDriver([[["Nickname", "พี่วิว", "Acct", "111-2-34567-8"]]]);
    await expect(collectFavorites(driver)).rejects.toThrow(/parsed none/);
  });
});

describe("rowHasAccountEndingWith", () => {
  it("matches a dashed account token by its last 4 digits", () => {
    expect(rowHasAccountEndingWith("พี่วิว MS. TESTONE SAMPLE Siam Commercial Bank 111-2-34567-8", "5678")).toBe(true);
    expect(rowHasAccountEndingWith("พี่วิว 020-4-01234-567", "4567")).toBe(true);
  });

  it("does not match a different account", () => {
    expect(rowHasAccountEndingWith("พี่วิว 222-3-45678-9", "5678")).toBe(false);
  });

  it("ignores short numbers that cannot be account numbers", () => {
    expect(rowHasAccountEndingWith("row 5678", "5678")).toBe(false);
  });

  it("needs exactly 4 digits to verify anything", () => {
    expect(rowHasAccountEndingWith("พี่วิว 111-2-34567-8", "678")).toBe(false);
    expect(rowHasAccountEndingWith("พี่วิว 111-2-34567-8", "")).toBe(false);
  });
});

describe("matchFavoriteRows", () => {
  const text = (nickname: string, bank: string, accountNo: string) =>
    `${nickname}\nMS. TESTONE SAMPLE\n${bank}\n${accountNo}`;

  const ROWS = [
    text("พี่วิว", "Siam Commercial Bank", "111-2-34567-8"),
    text("ร้านวัสดุ", "Kasikornbank", "222-3-45678-9"),
    "", // the hidden half of a double-rendered row: innerText gives nothing
  ];

  it("matches exactly one row on nickname + bank + last 4", () => {
    expect(matchFavoriteRows(ROWS, { nickname: "พี่วิว", bank: "Siam Commercial", accountLast4: "5678" })).toEqual([0]);
  });

  it("matches exactly one row on the full account number (the payee-book path)", () => {
    expect(matchFavoriteRows(ROWS, { nickname: "ร้านวัสดุ", bank: "Kasikornbank", accountNo: "222-3-45678-9" })).toEqual([1]);
    // Either rendering counts — the configured value as written, or its bare
    // digits — so a row that prints the number undashed still matches.
    const undashed = [text("ร้านวัสดุ", "Kasikornbank", "2223456789")];
    expect(matchFavoriteRows(undashed, { nickname: "ร้านวัสดุ", bank: "Kasikornbank", accountNo: "222-3-45678-9" })).toEqual([0]);
  });

  it("reports BOTH rows when two saved accounts fit — the caller then refuses", () => {
    // Same nickname, same bank, two accounts ending 5678: the picker cannot
    // be disambiguated by last 4 alone, so nothing may be selected.
    const ambiguous = [
      text("พี่วิว", "Siam Commercial Bank", "111-2-34567-8"),
      text("พี่วิว", "Siam Commercial Bank", "333-1-11567-8"),
    ];
    expect(matchFavoriteRows(ambiguous, { nickname: "พี่วิว", bank: "Siam Commercial Bank", accountLast4: "5678" })).toEqual([0, 1]);
  });

  it("matches nothing when the bank, nickname or last 4 disagree", () => {
    expect(matchFavoriteRows(ROWS, { nickname: "พี่วิว", bank: "Kasikornbank", accountLast4: "5678" })).toEqual([]);
    expect(matchFavoriteRows(ROWS, { nickname: "ป้าหนู", bank: "Siam Commercial Bank", accountLast4: "5678" })).toEqual([]);
    expect(matchFavoriteRows(ROWS, { nickname: "พี่วิว", bank: "Siam Commercial Bank", accountLast4: "9999" })).toEqual([]);
  });

  it("matches nothing when no verifier is given at all", () => {
    expect(matchFavoriteRows(ROWS, { nickname: "พี่วิว", bank: "Siam Commercial Bank" })).toEqual([]);
  });

  it("treats the bank as a literal substring, not a pattern", () => {
    expect(matchFavoriteRows(ROWS, { nickname: "พี่วิว", bank: "Siam.Commercial", accountLast4: "5678" })).toEqual([]);
  });
});

// ── bank alias matching (the Thai-session transition) ───────────────────────
import { aliasesForBank, bankPattern } from "../src/lib/favorites-core";

describe("bank aliases", () => {
  it("EN config matches a Thai-rendered row and vice versa", () => {
    expect(bankPattern("Siam Commercial").test("พี่วิว สลิลทิพย์ ธนาคารไทยพาณิชย์ 811-2-56739-4")).toBe(true);
    expect(bankPattern("ไทยพาณิชย์").test("พี่วิว SALINTHIP Siam Commercial Bank 811-2-56739-4")).toBe(true);
    expect(bankPattern("Kasikornbank").test("ร้าน 47 ธนาคารกสิกรไทย 317-2-51625-3")).toBe(true);
  });
  it("กรุงไทย and กรุงเทพ and กรุงศรี never cross-match", () => {
    expect(bankPattern("Krung Thai Bank").test("ธนาคารกรุงเทพ")).toBe(false);
    expect(bankPattern("Bangkok Bank").test("ธนาคารกรุงไทย")).toBe(false);
    expect(bankPattern("Ayudhya").test("ธนาคารกรุงไทย")).toBe(false);
    expect(bankPattern("Ayudhya").test("ธนาคารกรุงศรีอยุธยา")).toBe(true);
  });
  it("unknown bank falls back to itself", () => {
    expect(aliasesForBank("Some Future Bank")).toEqual(["Some Future Bank"]);
  });
});

describe("Thai UI (pinned from the 2026-08-12 live probe)", () => {
  it("parses a real Thai picker row, merged mobile label included", () => {
    const row = parseFavoriteRowCells([
      "ชื่อย่อบัญชี/ชื่อบัญชี", "Guide HF",
      "ชื่อย่อบัญชี", "Guide HF",
      "ชื่อบัญชี", "น.ส. กฤษณา บุญนาค",
      "ธนาคาร", "ธนาคารกรุงศรีอยุธยา",
      "เลขบัญชี", "803-1-20509-8",
    ]);
    expect(row).not.toBeNull();
    expect(toFavorite(row!)).toEqual({
      nickname: "Guide HF",
      accountName: "น.ส. กฤษณา บุญนาค",
      bank: "ธนาคารกรุงศรีอยุธยา",
      accountMasked: "…5098",
      accountLast4: "5098",
    });
  });
  it("BAAC and Bank of China match their real Thai option texts", () => {
    expect(bankPattern("BAAC").test("ธนาคาร ธ.ก.ส.")).toBe(true);
    expect(bankPattern("Bank of China").test("ธนาคารแห่งประเทศจีน (ไทย)")).toBe(true);
  });
});
