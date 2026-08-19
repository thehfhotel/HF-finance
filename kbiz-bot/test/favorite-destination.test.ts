// The "favorite" destination path, end to end across every PURE layer it
// touches — the thinnest-tested of the three kinds (all 9 production transfers
// to date went through kind:"handle"), and the only one that addresses money
// by a masked last-4 instead of a full account number.
//
// The scenario is the operator's own KBIZ saved account, because that is the
// row a `favorite` transfer will actually select first and because its
// nickname is a genuine Thai substring hazard: "วิณัฐ สาขาสุราษ" is a PREFIX
// of the longer province spelling ("...สุราษฎร์ธานี"), and matchFavoriteRows
// gates on `t.includes(nickname)` — a substring test, not an identity test.
//
// WHAT IS REAL HERE, AND WHY THAT IS ALLOWED: nickname + bank + last-4 +
// account name of the operator's own row. Those four fields are exactly what
// the masked contract already publishes (queue/kbiz-favorites.json carries
// accountLast4/accountMasked and NO full number, by design — see
// favorites-core.ts's "MASKED BY CONTRACT"), so pinning them costs nothing a
// reader of the manifest does not already have.
//
// WHAT IS INVENTED: every account number below (the leading digits carry no
// information — only the trailing 1627 is real, and 999-8-… is a deliberately
// impossible Kasikorn prefix), and every SIBLING row. The real picker's other
// payees are bank data and stay out of this repo, exactly as
// scrape-favorites.test.ts says. The siblings reproduce the STRUCTURE that
// makes the live list hazardous rather than its contents: 7 of the 13 synced
// favorites are Kasikorn rows, so "the bank" disambiguates almost nothing and
// the nickname + last-4 pair carries the whole verification load.
//
// Run with `bun test` (from the repo root too — nothing here imports
// playwright; the flow half is pinned as source text at the bottom).

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import { bankPattern, matchFavoriteRows, rowHasAccountEndingWith } from "../src/lib/favorites-core";
import {
  describeDestination,
  destinationSignature,
  parseDestination,
  resolveQueuePayee,
} from "../src/lib/transfer-other-queue";
import type { TransferConfig } from "../src/lib/transfer-config";

// ── the operator's row, as the masked contract knows it ─────────────────────

const OP = {
  nickname: "วิณัฐ สาขาสุราษ",
  bank: "ธนาคารกสิกรไทย",
  accountLast4: "1627",
  accountName: "นาย วิณัฐ จิรฤกษ์มงคล",
} as const;

/**
 * One picker row as innerText, in the Thai labelling the live session renders
 * (the bot logs in with lang=th since 2026-08-12). Labels are included on
 * purpose: matchFavoriteRows sees the WHOLE row text, labels and all, which is
 * why "does the nickname appear in this row" is a weaker question than "is
 * this row's Display Name the nickname".
 */
const rowText = (nickname: string, accountName: string, bank: string, accountNo: string) =>
  ["ชื่อย่อบัญชี", nickname, "ชื่อบัญชี", accountName, "ธนาคาร", bank, "เลขบัญชี", accountNo].join("\n");

/** The operator's row. Only the trailing 1627 is real. */
const OP_ROW = rowText(OP.nickname, OP.accountName, OP.bank, "999-8-77162-7");

/**
 * A realistic page of the picker: the operator's row among invented siblings,
 * keeping the live list's shape (Kasikorn dominant, plus the empty innerText
 * of every row's hidden viewport twin).
 */
const PAGE = [
  rowText("ร้านวัสดุ", "MR. TESTTWO SAMPLE", "ธนาคารกสิกรไทย", "111-2-34567-8"),
  rowText("พี่วิว", "MS. TESTONE SAMPLE", "ธนาคารไทยพาณิชย์", "222-3-45678-9"),
  OP_ROW,
  rowText("แม่บ้าน A", "MS. TESTTHREE SAMPLE", "ธนาคารกสิกรไทย", "333-4-56789-0"),
  "", // the hidden half of a double-rendered row: innerText gives nothing
  rowText("ช่างไฟ", "MR. TESTFOUR SAMPLE", "ธนาคารกสิกรไทย", "444-5-67890-1"),
  rowText("Guide HF", "MS. TESTFIVE SAMPLE", "ธนาคารกรุงศรีอยุธยา", "555-6-78901-2"),
  rowText("ร้าน 47", "MR. TESTSIX SAMPLE", "ธนาคารกสิกรไทย", "666-7-89012-3"),
];

const OP_INDEX = PAGE.indexOf(OP_ROW);

/** The criteria the flow builds from a kind:"favorite" destination. */
const opCriteria = { nickname: OP.nickname, bank: OP.bank, accountLast4: OP.accountLast4 };

// ── (a) exact resolution ───────────────────────────────────────────────────

describe("favorite → the operator's saved row resolves to exactly one index", () => {
  it("matches on nickname + bank + last 4, and only that row", () => {
    expect(matchFavoriteRows(PAGE, opCriteria)).toEqual([OP_INDEX]);
  });

  it("neither criterion alone would have picked it — the pair is load-bearing", () => {
    // The bank is nearly useless on this operator's list: 5 of the 7 rendered
    // rows here are Kasikorn (7 of 13 in the live synced set).
    const kasikorn = PAGE.filter((t) => t && bankPattern(OP.bank).test(t));
    expect(kasikorn.length).toBeGreaterThan(1);
    // And the last-4 alone is not addressed to anyone: it takes the nickname
    // to name a payee at all.
    expect(PAGE.filter((t) => rowHasAccountEndingWith(t, OP.accountLast4))).toEqual([OP_ROW]);
  });

  it("the Thai bank name in the manifest matches the Thai bank name on the page", () => {
    // The synced favorite carries "ธนาคารกสิกรไทย"; aliasesForBank has to
    // recognize it through the "กสิกร" stem, or every favorite transfer to a
    // Kasikorn account fails to find its row.
    expect(bankPattern(OP.bank).test(OP_ROW)).toBe(true);
    // …and an EN-spelled intent for the same bank still finds the Thai row.
    expect(matchFavoriteRows(PAGE, { ...opCriteria, bank: "Kasikornbank" })).toEqual([OP_INDEX]);
  });

  it("survives the picker's own whitespace: innerText is normalized before matching", () => {
    // KBIZ renders each cell in its own <p>, so innerText arrives newline- and
    // sometimes double-space-separated. The nickname's internal space must not
    // be what breaks the match.
    const wideRow = OP_ROW.replace(/\n/g, "  \n ");
    expect(matchFavoriteRows([wideRow], opCriteria)).toEqual([0]);
  });
});

// ── (b) the Thai substring hazard, asserted as IMPLEMENTED ─────────────────

describe("nickname is a SUBSTRING test, not an identity test", () => {
  it("FORGIVING DIRECTION: the synced nickname is a prefix of the rendered one → still matches", () => {
    // "วิณัฐ สาขาสุราษ" is a prefix of the full province spelling. If KBIZ
    // ever renders the longer form (or stops truncating it), the manifest's
    // shorter nickname keeps matching — deliberate, and the reason the
    // substring semantics is the right default.
    const longer = rowText(OP.nickname + "ฎร์ธานี", OP.accountName, OP.bank, "999-8-77162-7");
    expect(matchFavoriteRows([longer], opCriteria)).toEqual([0]);
  });

  it("STRICT DIRECTION: a nickname LONGER than the row's renders no match", () => {
    // Same asymmetry, the other way: an intent carrying the long spelling can
    // never select the row that renders the short one. It fails to find, which
    // is the safe failure — it does not fall back to the bank + last-4 pair.
    const shortRow = rowText("วิณัฐ", OP.accountName, OP.bank, "999-8-77162-7");
    expect(matchFavoriteRows([shortRow], { ...opCriteria, nickname: OP.nickname + "ฎร์ธานี" })).toEqual([]);
    expect(matchFavoriteRows([shortRow], { ...opCriteria, nickname: "วิณัฐ" })).toEqual([0]);
  });

  it("the nickname is matched against the WHOLE row, so the Account Name cell can satisfy it", () => {
    // A row whose Display Name is unrelated but whose Account Name carries the
    // person's name passes the nickname gate. This is real, implemented
    // behavior — assert it rather than pretend the gate is per-cell.
    const byAccountName = rowText("บัญชีสำรอง", OP.accountName, OP.bank, "999-8-77133-9");
    expect(byAccountName.includes("วิณัฐ")).toBe(true);
    expect(matchFavoriteRows([byAccountName], { ...opCriteria, nickname: "วิณัฐ" })).toEqual([]);
    //                                     ↑ no match, and the ONLY reason is
    // the last-4 verifier: the nickname gate let this row through.
    expect(bankPattern(OP.bank).test(byAccountName)).toBe(true);
    expect(rowHasAccountEndingWith(byAccountName, OP.accountLast4)).toBe(false);
  });

  it("a DIFFERENT account of the SAME person never matches", () => {
    // Same human, same bank, same nickname prefix, different account: the
    // last-4 is the whole defence and it holds.
    const secondAccount = rowText(OP.nickname + " 2", OP.accountName, OP.bank, "999-8-77133-9");
    expect(matchFavoriteRows([OP_ROW, secondAccount], opCriteria)).toEqual([0]);
  });
});

// ── (c) near misses fail closed ────────────────────────────────────────────

describe("a near-miss favorite finds nothing rather than something", () => {
  it("wrong bank (SCB intent against the Kasikorn row) → no match", () => {
    expect(matchFavoriteRows(PAGE, { ...opCriteria, bank: "ธนาคารไทยพาณิชย์" })).toEqual([]);
    expect(matchFavoriteRows(PAGE, { ...opCriteria, bank: "Siam Commercial" })).toEqual([]);
  });

  it("the Kasikorn ↔ SCB pair never cross-matches in either language", () => {
    expect(bankPattern("ธนาคารกสิกรไทย").test("ธนาคารไทยพาณิชย์")).toBe(false);
    expect(bankPattern("ธนาคารไทยพาณิชย์").test("ธนาคารกสิกรไทย")).toBe(false);
  });

  it("wrong last 4 → no match, including a transposition of the right one", () => {
    expect(matchFavoriteRows(PAGE, { ...opCriteria, accountLast4: "9999" })).toEqual([]);
    expect(matchFavoriteRows(PAGE, { ...opCriteria, accountLast4: "1672" })).toEqual([]); // 27 → 72
    expect(matchFavoriteRows(PAGE, { ...opCriteria, accountLast4: "162" })).toEqual([]); // short verifier verifies nothing
  });

  it("right nickname + right bank, but the last 4 of ANOTHER row's account → no match", () => {
    // 3456 is the sibling "ร้านวัสดุ" row's account, also Kasikorn. Borrowing
    // it must not select the operator's row, and must not select the sibling
    // either (its nickname is not the operator's).
    expect(matchFavoriteRows(PAGE, { ...opCriteria, accountLast4: "3456" })).toEqual([]);
  });

  it("no verifier at all → no match, never 'the row whose nickname fits'", () => {
    expect(matchFavoriteRows(PAGE, { nickname: OP.nickname, bank: OP.bank })).toEqual([]);
  });

  it("an empty nickname does NOT degrade to bank + last-4 (the flow refuses before this, belt and braces)", () => {
    // "".includes → every row passes the nickname gate, so this criteria set
    // reduces to bank + verifier and DOES return the operator's row. That is
    // exactly why selectFavoritePayee refuses an empty nickname before it ever
    // opens the picker — pinned as source text below.
    expect(matchFavoriteRows(PAGE, { nickname: "", bank: OP.bank, accountLast4: OP.accountLast4 })).toEqual([OP_INDEX]);
  });
});

// ── (d) ambiguity → more than one index, and the caller must refuse ────────

describe("ambiguity is reported, never resolved", () => {
  it("the same account saved twice (one nickname containing the other) → BOTH indices", () => {
    // The realistic way this happens on a KBIZ list: the payee is saved once,
    // then saved again with a longer Display Name. Both rows satisfy
    // nickname + bank + last-4, so there is no correct row to click.
    const dupe = rowText(OP.nickname + "ฎร์ธานี", OP.accountName, OP.bank, "999-8-77162-7");
    const rows = [OP_ROW, dupe];
    expect(matchFavoriteRows(rows, opCriteria)).toEqual([0, 1]);
  });

  it("two DIFFERENT accounts colliding on the last 4 → BOTH indices (last-4 cannot disambiguate)", () => {
    const collision = rowText(OP.nickname, OP.accountName, OP.bank, "123-4-56162-7");
    expect(matchFavoriteRows([OP_ROW, collision], opCriteria).length).toBe(2);
  });

  it("the two rows are genuinely different accounts — the ambiguity is real, not a fixture artifact", () => {
    const collision = rowText(OP.nickname, OP.accountName, OP.bank, "123-4-56162-7");
    expect(collision).not.toBe(OP_ROW);
    expect(rowHasAccountEndingWith(OP_ROW, OP.accountLast4)).toBe(true);
    expect(rowHasAccountEndingWith(collision, OP.accountLast4)).toBe(true);
  });
});

// ── the queue-item half: destination → Payee, with no number to leak ───────

describe("kind:'favorite' becomes a Payee that carries no account number", () => {
  // A payee book that DOES hold a full number, so "the favorite path leaked no
  // number" is a real claim about the favorite branch and not an artifact of an
  // empty config. (Invented handle + number; the production book holds exactly
  // one recipient and it is not the operator.)
  const config: TransferConfig = {
    maxTransfer: 50_000,
    recipients: {
      revew: { mode: "favorite", nickname: "พี่วิว", accountNo: "222-3-45678-9", bank: "Siam Commercial Bank" },
    },
  };

  const intent = {
    id: "op-favorite-1",
    payee: { handle: "revew" },
    destination: { kind: "favorite", ...OP },
  };

  it("parseDestination keeps the four masked fields and nothing else", () => {
    expect(parseDestination(intent.destination, intent.id)).toEqual({
      kind: "favorite",
      nickname: OP.nickname,
      bank: OP.bank,
      accountLast4: OP.accountLast4,
      accountName: OP.accountName,
    });
  });

  it("resolveQueuePayee hands the flow the last 4 and NO accountNo", () => {
    const payee = resolveQueuePayee(intent, config);
    expect(payee).toEqual({
      mode: "favorite",
      nickname: OP.nickname,
      bank: OP.bank,
      accountLast4: OP.accountLast4,
      accountName: OP.accountName,
    });
    expect(payee.accountNo).toBeUndefined();
  });

  it("the destination WINS over payee.handle — a favorite never falls back to the book's full number", () => {
    // Both are present here. If the precedence ever inverted, this favorite
    // would silently become a handle transfer to a different bank and a
    // different account, with a full number in hand.
    const payee = resolveQueuePayee(intent, config);
    expect(payee.bank).toBe(OP.bank);
    expect(payee.accountNo).toBeUndefined();
    expect(JSON.stringify(payee)).not.toContain("45678");
  });

  it("the resolved Payee reproduces the criteria that matched the row — one unbroken chain", () => {
    const payee = resolveQueuePayee(intent, config);
    expect(
      matchFavoriteRows(PAGE, {
        nickname: payee.nickname ?? "",
        bank: payee.bank,
        accountNo: payee.accountNo,
        accountLast4: payee.accountLast4,
      }),
    ).toEqual([OP_INDEX]);
  });
});

// ── (e) nothing wider than a last-4 is ever rendered ──────────────────────

describe("a favorite is never described with more than its last 4 digits", () => {
  const dest = { kind: "favorite", ...OP };

  it("describeDestination names nickname + bank + …last4, and no longer digit run exists to print", () => {
    const line = describeDestination({ payee: null, destination: dest });
    expect(line).toBe(`favorite "${OP.nickname}" (${OP.bank} …${OP.accountLast4})`);
    // Nothing in the line is a longer number than the 4 permitted digits.
    expect(line).not.toMatch(/\d{5,}/);
    expect((line.match(/\d/g) ?? []).join("")).toBe(OP.accountLast4);
  });

  it("destinationSignature (duplicate detection) is masked to the same 4 digits", () => {
    const sig = destinationSignature({ destination: dest });
    expect(sig).toBe(`favorite:${OP.bank.toLowerCase()}:${OP.nickname}:${OP.accountLast4}`);
    expect(sig).not.toMatch(/\d{5,}/);
  });

  it("even a favorite carrying a stray full number cannot widen either renderer", () => {
    // parseDestination has no accountNo field for a favorite, so a picker bug
    // on reimbursement's side that attached one is dropped, not printed.
    const polluted = { kind: "favorite", ...OP, accountNo: "9998771627" };
    expect(describeDestination({ payee: null, destination: polluted })).not.toContain("9998771627");
    expect(destinationSignature({ destination: polluted })).not.toContain("9998771627");
    expect(parseDestination(polluted)).not.toHaveProperty("accountNo");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The CALLER's exactly-one rule lives in src/flows/transfer-other-flow.ts,
// which imports playwright for real and therefore cannot be imported here
// (root CI runs this file before kbiz-bot/node_modules exists). Read it as
// TEXT, the same way transfer-other-queue.test.ts pins process-queue.ts's
// wiring. These are the four refusals that stand between a mis-keyed favorite
// and a misrouted transfer.
// ───────────────────────────────────────────────────────────────────────────

describe("transfer-other-flow.ts wiring — the favorite path's refusals", () => {
  const src = readFileSync(fileURLToPath(new URL("../src/flows/transfer-other-flow.ts", import.meta.url)), "utf8");
  const fn = src.slice(src.indexOf("async function selectFavoritePayee"), src.indexOf("async function selectCategory"));

  it("EXACTLY ONE match, or it throws — anything else refuses to click a row", () => {
    expect(fn).toMatch(/if \(matches\.length !== 1\)/);
    const guard = fn.slice(fn.indexOf("if (matches.length !== 1)"));
    expect(guard).toContain("throw new Error(");
    expect(guard).toContain("Refusing to select");
    // The refusal must come BEFORE the click that selects the payee.
    expect(fn.indexOf("if (matches.length !== 1)")).toBeLessThan(fn.indexOf("a.c-bold.c-green.pointer:visible"));
  });

  it("refuses an empty nickname before the picker is even opened", () => {
    // Without this, matchFavoriteRows' `t.includes("")` passes every row and
    // the triple-verify silently degrades to bank + last-4 (asserted above).
    expect(fn).toMatch(/if \(!nickname\) throw new Error\(/);
    expect(fn.indexOf("if (!nickname)")).toBeLessThan(fn.indexOf("input-search-acc"));
  });

  it("refuses a favorite with no verifier at all (no accountNo AND no 4-digit last4)", () => {
    expect(fn).toMatch(/if \(!acctD && last4\.length !== 4\)/);
    expect(fn.indexOf("if (!acctD && last4.length !== 4)")).toBeLessThan(fn.indexOf("input-search-acc"));
  });

  it("re-verifies the To field KBIZ filled in, requiring a whole account number ending in the last 4", () => {
    expect(fn).toMatch(/filledD\.length >= 8 && filledD\.endsWith\(last4\)/);
    expect(fn).toContain("if (!toOk)");
  });

  it("every refusal names the destination masked — no full number reaches Slack or paymentError", () => {
    // `shown` is maskAccount(...) and is what the throws interpolate.
    expect(fn).toMatch(/const shown = maskAccount\(/);
    for (const line of fn.split("\n").filter((l) => l.includes("throw new Error("))) {
      expect(line).not.toMatch(/payee\.accountNo(?!\s*\?)/);
    }
  });
});
