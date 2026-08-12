/**
 * PURE core of the favorites scrape — parsing, paging, masking, matching.
 * NO playwright/session imports: payroll's repo-root CI runs `bun test`
 * without kbiz-bot's node_modules, so anything a test touches must not pull
 * the browser stack (same split as scrape-registered's driver pattern).
 */

/**
 * Read-only scrape of KBIZ's saved-payee ("favorites") picker on the
 * fundtranfer-other page, published as `queue/kbiz-favorites.json` so the
 * reimbursement approver can pick a destination from the vetted list instead
 * of anyone re-typing an account number.
 *
 * READ-ONLY IS THE WHOLE POINT. The account-number link in a picker row
 * (a.c-bold.c-green.pointer) SELECTS that payee when clicked, so this walker
 * never clicks a row, a Next, or a Confirm — only the numeric page anchors.
 *
 * MASKED BY CONTRACT: only the last 4 digits cross the boundary ("…7394"),
 * the same rule payee-handles.ts publishes the payee book under. The bot
 * re-verifies nickname + bank + last-4 against the live picker at transfer
 * time (see matchFavoriteRows below), so nothing downstream ever needs the
 * full number.
 *
 * The manifest lives INSIDE queue/ for the same reason payee-handles.json
 * does: it is the only bot→reimbursement-visible path needing no new mount.
 * Both queue scanners skip it by name.
 *
 * PINNED DOM (probed + live-verified 2026-08-12):
 *   - the page needs a desktop viewport (1600) — 1366 is KBIZ's iPad-pro edge;
 *   - the picker opens from a.input-search-acc beside "Account No.";
 *   - rows are div.lists carrying a.c-bold.c-green.pointer;
 *   - each row renders its cells as <p>label</p><p>value</p> pairs
 *     (Display Name / Account Name / Bank / Account No.) — which is why this
 *     reads cell pairs and never splits a row's innerText into lines;
 *   - EVERY ROW RENDERS TWICE (desktop hidden-ip-pro + ipad visible-ip-pro
 *     variants), so rows are deduped by nickname + account number;
 *   - pages are plain numeric a.pointer anchors ("2", "3", …) in the modal.
 */


/** Shared-file name for the synced favorites — both queue scanners skip it. */
export const FAVORITES_FILE = "kbiz-favorites.json";

// The picker paginates in the modal and the book is small in practice; 40
// bounds the walk if the paginator ever misbehaves, matching scrape-registered.
const MAX_PAGES = 40;

/**
 * One synced saved account. Mirrors reimbursement's `KbizFavorite`
 * (packages/shared/src/index.ts) field-for-field — a cross-repo JSON
 * contract, not a shared import. Keep the names in lockstep.
 */
export interface KbizFavorite {
  /** Display Name in KBIZ — what the bot matches to select the row. */
  nickname: string;
  /** The bank's own name-on-account. */
  accountName: string;
  bank: string;
  /** e.g. "…7394" — display only. */
  accountMasked: string;
  /** Last 4 digits — the verifier the bot matches at transfer time. */
  accountLast4: string;
}

/** The published `queue/kbiz-favorites.json` payload. */
export interface FavoritesManifest {
  favorites: KbizFavorite[];
  updatedAt: string;
}

/** One picker row as read off the page, before masking. */
export interface RawFavoriteRow {
  nickname: string;
  accountName: string;
  bank: string;
  /** Full number, as rendered (e.g. "811-2-56739-4"). NEVER published. */
  accountNo: string;
}

const digitsOnly = (s: string) => s.replace(/\D+/g, "");

// The picker's cell labels. English is what the live page renders (we log in
// with lang=en); the Thai alternates cost nothing and keep a language flip
// from silently scraping zero rows.
const CELL_LABELS: { key: keyof RawFavoriteRow; re: RegExp }[] = [
  { key: "nickname", re: /^(display name|ชื่อที่แสดง|ชื่อเล่น)$/i },
  { key: "accountName", re: /^(account name|ชื่อบัญชี)$/i },
  { key: "bank", re: /^(bank|ธนาคาร)$/i },
  { key: "accountNo", re: /^(account no|account number|เลขที่บัญชี|บัญชีเลขที่)$/i },
];

/** Normalize a cell to its label key, or null when it isn't a label. */
function labelKey(cell: string): keyof RawFavoriteRow | null {
  const norm = cell.replace(/\s+/g, " ").replace(/[:.]+$/, "").trim();
  if (!norm) return null;
  return CELL_LABELS.find((l) => l.re.test(norm))?.key ?? null;
}

/**
 * Parse one row from its <p> cell texts, in DOM order.
 *
 * The row is a flat run of `label, value, label, value …` pairs, so a label
 * takes the cell after it as its value — and FIRST WINS, because a row that
 * renders both the desktop and the iPad variant repeats every label.
 *
 * Returns null for anything we can't both name and verify (nickname + bank +
 * account number): a half-read row must never become a selectable
 * destination.
 */
export function parseFavoriteRowCells(cells: string[]): RawFavoriteRow | null {
  const found: Partial<RawFavoriteRow> = {};
  for (let i = 0; i < cells.length - 1; i++) {
    const key = labelKey(cells[i]);
    if (!key || found[key] !== undefined) continue;
    const value = (cells[i + 1] ?? "").replace(/\s+/g, " ").trim();
    // The next cell is another label — this one rendered no value.
    if (!value || labelKey(value)) continue;
    found[key] = value;
  }
  if (!found.nickname || !found.bank || !found.accountNo) return null;
  if (digitsOnly(found.accountNo).length < 8) return null;
  return {
    nickname: found.nickname,
    accountName: found.accountName ?? "",
    bank: found.bank,
    accountNo: found.accountNo,
  };
}

/** Mask a scraped row down to what may leave this container. */
export function toFavorite(row: RawFavoriteRow): KbizFavorite {
  const last4 = digitsOnly(row.accountNo).slice(-4);
  return {
    nickname: row.nickname,
    accountName: row.accountName,
    bank: row.bank,
    accountMasked: `…${last4}`,
    accountLast4: last4,
  };
}

/**
 * The page operations collectFavorites needs, split out from Playwright so
 * the paging + dedupe logic is testable without a browser (the same driver
 * split scrape-registered.ts uses).
 */
export type FavoritesDriver = {
  /** The <p> cell texts of every picker row rendered on the current page. */
  readRows(): Promise<string[][]>;
  /** Is there a numeric page anchor after the current one? */
  hasNextPage(): Promise<boolean>;
  /** Click it. Never clicks a row, a Next, or a Confirm. */
  clickNextPage(): Promise<void>;
};

/**
 * Walk every page of the picker, accumulating masked favorites.
 *
 * Deduped by nickname + account number because each row renders twice (the
 * desktop and iPad variants), and both are read here — unlike the selection
 * path, which reads innerText and therefore only ever sees the visible one.
 *
 * Fails loudly instead of publishing a short list: a truncated
 * kbiz-favorites.json would quietly hide real saved accounts from the
 * approver's picker, which reads like "that payee isn't in KBIZ" — and pushes
 * the approver off the vetted saved-account path onto a typed number, the very
 * thing this list exists to avoid. A read of zero rows is refused for the same
 * reason: an operator with a destination picker has saved accounts, so "none"
 * means the modal never painted, not that the book is empty.
 */
export async function collectFavorites(driver: FavoritesDriver): Promise<KbizFavorite[]> {
  const byKey = new Map<string, KbizFavorite>();
  let rowsSeen = 0;
  let exhausted = false;

  for (let i = 0; i < MAX_PAGES; i++) {
    const rows = await driver.readRows();
    rowsSeen += rows.length;
    for (const cells of rows) {
      const row = parseFavoriteRowCells(cells);
      if (!row) continue;
      // "|" can't appear in the digits half, so nickname and number can never
      // blur into each other's key.
      const key = `${row.nickname}|${digitsOnly(row.accountNo)}`;
      if (!byKey.has(key)) byKey.set(key, toFavorite(row));
    }
    if (!(await driver.hasNextPage())) {
      exhausted = true;
      break;
    }
    await driver.clickNextPage();
  }

  if (!exhausted) {
    throw new Error(`Favorites paginator still offered more pages after ${MAX_PAGES} — refusing a truncated list`);
  }

  const favorites = [...byKey.values()];
  if (rowsSeen === 0) {
    throw new Error("Read no picker rows at all — the saved list never rendered; refusing to publish an empty list");
  }
  if (favorites.length === 0) {
    throw new Error(
      `Read ${rowsSeen} picker row(s) but parsed none — the picker markup changed; refusing to publish an empty list`,
    );
  }
  return favorites;
}

// ── selecting a favorite at transfer time ──────────────────────────────────
// Same picker, read the other way round: transfer-other-flow.ts matches the
// intended payee against the rendered rows and refuses anything but exactly
// one hit. Kept here so both directions share one description of the picker.

export interface FavoriteRowCriteria {
  /** KBIZ Display Name; must appear in the row. */
  nickname: string;
  /** Destination bank, matched case-insensitively as a substring. */
  bank: string;
  /** Full account number, when the caller has one (the payee-book path). */
  accountNo?: string;
  /** Last 4 digits, when it doesn't — a synced favorite carries only these. */
  accountLast4?: string;
}

// An account renders as "811-2-56739-4" / "020-4-02827-339"; a token of 8+
// digits is the only thing in a picker row that can be an account number.
const ACCOUNT_TOKEN_RE = /\d[\d-]{6,}\d/g;

/** Does this row render an account number whose digits end with `last4`? */
export function rowHasAccountEndingWith(text: string, last4: string): boolean {
  const want = digitsOnly(last4);
  if (want.length !== 4) return false;
  for (const token of text.match(ACCOUNT_TOKEN_RE) ?? []) {
    const d = digitsOnly(token);
    if (d.length >= 8 && d.endsWith(want)) return true;
  }
  return false;
}

/**
 * Indices of the picker rows matching ALL THREE of nickname, bank, and the
 * account verifier — the full number when we have it, otherwise an account
 * token ending in the synced last 4. The caller requires EXACTLY ONE: a
 * mis-keyed verifier can then never misroute money, it can only fail to find
 * its row.
 *
 * Rows arrive as innerText, so the hidden half of each double-rendered row is
 * empty and drops out on its own.
 */
export function matchFavoriteRows(rowTexts: string[], criteria: FavoriteRowCriteria): number[] {
  const bankRe = new RegExp(criteria.bank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const acctD = criteria.accountNo ? digitsOnly(criteria.accountNo) : "";
  const out: number[] = [];

  rowTexts.forEach((raw, i) => {
    const t = raw.replace(/\s+/g, " ").trim();
    if (!t || !t.includes(criteria.nickname) || !bankRe.test(t)) return;
    const accountOk = criteria.accountNo
      ? t.includes(criteria.accountNo) || (!!acctD && t.includes(acctD))
      : !!criteria.accountLast4 && rowHasAccountEndingWith(t, criteria.accountLast4);
    if (accountOk) out.push(i);
  });

  return out;
}
