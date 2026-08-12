import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { gotoAuthenticated } from "./session";

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

// Same page transfer-other-flow.ts drives. Deliberately re-declared rather
// than imported from the flow: that flow imports this module for
// matchFavoriteRows, and a cycle would be worse than one duplicated string.
const URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

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

function playwrightDriver(page: Page): FavoritesDriver {
  let current = 1;

  const readRows = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll("div.lists"))
        .filter((row) => row.querySelector("a.c-bold.c-green.pointer"))
        .map((row) =>
          Array.from(row.querySelectorAll("p")).map((p) => (p.textContent ?? "").replace(/\s+/g, " ").trim()),
        ),
    );

  // Pages are bare numeric anchors ("2", "3", …) — anchored on the whole text
  // so "2" never matches a "12" further along the paginator.
  const pageAnchor = (n: number) =>
    page
      .locator("a.pointer:visible")
      .filter({ hasText: new RegExp(`^\\s*${n}\\s*$`) })
      .first();

  const signature = async () => (await readRows())[0]?.join("|") ?? "";

  return {
    readRows,
    hasNextPage: async () => (await pageAnchor(current + 1).count()) > 0,
    // Paging re-renders the modal's rows, so wait for the row set to actually
    // swap rather than sleeping a fixed amount — and if it never does, the
    // anchor wasn't the paginator (or the click was eaten). Re-reading the
    // same page would quietly publish a short list, so refuse instead.
    async clickNextPage() {
      const before = await signature();
      const next = current + 1;
      await pageAnchor(next).click({ timeout: 15_000 });
      let after = before;
      for (let i = 0; i < 40; i++) {
        await page.waitForTimeout(250);
        after = await signature();
        if (after !== before) break;
      }
      if (after === before) throw new Error(`Paging to page ${next} did not change the picker rows — refusing a truncated list`);
      // Rows that VANISHED are not a page that turned: signature() is "" for an
      // empty read, so a click that closed or blanked the modal would otherwise
      // pass as a swap and walk empty pages until hasNextPage() runs out —
      // publishing page 1 as if it were the whole list.
      if (after === "") throw new Error(`Paging to page ${next} left the picker with no rows — refusing a truncated list`);
      await page.waitForTimeout(400);
      current++;
    },
  };
}

/** Atomic tmp+rename, dot-prefixed so no queue scanner sees a half-write. */
async function publishFavorites(queueDir: string, manifest: FavoritesManifest): Promise<void> {
  const target = join(queueDir, FAVORITES_FILE);
  const tmp = join(queueDir, `.${FAVORITES_FILE}.tmp`);
  await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
  await rename(tmp, target);
  console.log(`→ published ${manifest.favorites.length} saved account(s) to ${FAVORITES_FILE}`);
}

/**
 * Navigate to fundtranfer-other, open the saved-payee picker, scrape every
 * page of it, and publish the masked list to `<queueDir>/kbiz-favorites.json`.
 *
 * Nothing here can move money: no row is clicked, no form is filled, and the
 * only controls touched are the picker icon and the numeric page anchors.
 */
export async function scrapeFavorites(page: Page, queueDir: string): Promise<FavoritesManifest> {
  await gotoAuthenticated(page, URL);
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  console.log("→ Open saved-payee picker (read-only)");
  const pick = page.locator("a.input-search-acc").first();
  await pick.waitFor({ state: "visible", timeout: 15_000 });
  await pick.click();

  // Wait for a row to actually render instead of sleeping a fixed amount: a
  // modal that hasn't painted yet reads as zero rows, and this scrape
  // OVERWRITES the manifest the approver's destination picker depends on.
  // Failing here leaves the previous good list in place, which is the right
  // degradation. `:visible` because every row also renders a hidden variant.
  await page
    .locator("div.lists a.c-bold.c-green.pointer:visible")
    .first()
    .waitFor({ state: "visible", timeout: 15_000 })
    .catch(() => {
      throw new Error("Saved-payee picker rendered no rows within 15s — refusing to publish an empty list");
    });
  await page.waitForTimeout(400);

  const favorites = await collectFavorites(playwrightDriver(page));

  // The modal is left open on purpose: every flow re-navigates through
  // gotoAuthenticated, and hunting for a close control is exactly the kind of
  // clicking around a read-only scrape must not do.
  const manifest: FavoritesManifest = { favorites, updatedAt: new Date().toISOString() };
  await publishFavorites(queueDir, manifest);
  return manifest;
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
