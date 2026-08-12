import { rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright";
import { gotoAuthenticated } from "./session";
import {
  collectFavorites,
  FAVORITES_FILE,
  parseFavoriteRowCells,
  type FavoritesDriver,
  type FavoritesManifest,
} from "./favorites-core";

// The Playwright half of the favorites scrape — the driver that walks the
// live picker and publishes the manifest. Everything testable lives in
// favorites-core.ts; the re-export keeps existing imports working.
export * from "./favorites-core";

// Same page transfer-other-flow.ts drives. Deliberately re-declared rather
// than imported from the flow: that flow imports this module for
// matchFavoriteRows, and a cycle would be worse than one duplicated string.
const URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

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
