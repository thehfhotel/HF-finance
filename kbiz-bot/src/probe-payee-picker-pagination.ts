/**
 * Selector-vs-real-DOM probe for the SAVED-PAYEE PICKER's pagination.
 *
 * The defect this pins: selectFavoritePayee used to read `div.lists` once and
 * match, so it only ever saw PAGE ONE of a picker that paginates at ten rows
 * per page (operator's devtools capture, 2026-08-19 — footer "บัญชีที่ 1-10
 * จาก 14 บัญชี"). The ฿1 test target sorts to ~row 11, i.e. page 2, and every
 * step of the picker's search box is best-effort, so a silent search failure
 * left the target unreachable — or, worse, left a last-4 COLLISION on page 1
 * looking like the unique match (case D below: that is a misroute, not a
 * refusal).
 *
 * This drives the REAL selectFavoritePayee (imported, not copied) against the
 * captured markup in test/fixtures/kbiz-payee-picker.dom.html in a local
 * chromium at the 1600px viewport the flow forces.
 *
 * NOT part of root `bun test` (imports playwright — root CI runs without
 * kbiz-bot/node_modules). Run manually:
 *     cd kbiz-bot && bun run probe-payee-picker
 * Exit code 0 = every assertion held; non-zero = regression.
 */
import { chromium, type Browser, type Page } from "playwright";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { selectFavoritePayee, type Payee } from "./flows/transfer-other-flow";

const FIXTURE = resolve(dirname(fileURLToPath(import.meta.url)), "../test/fixtures/kbiz-payee-picker.dom.html");

/** The ฿1 test destination as a masked (synced-favorite) payee: last 4 only. */
const PAYEE: Payee = {
  mode: "favorite",
  nickname: "ทดสอบ โอนหนึ่งบาท",
  bank: "ธนาคารกสิกรไทย",
  accountLast4: "1117",
  accountName: "MR. TEST PAYEE",
};

/** The placeholder account those criteria must resolve to (fixture row #11). */
const TARGET_ACCOUNT = "111-1-11111-7";
/** The page-1 decoy in the collision scenario — a DIFFERENT account, same last 4. */
const COLLIDING_ACCOUNT = "222-2-22111-7";

let failures = 0;
/** `detail` is printed only when the check fails — it describes what went wrong. */
const check = (label: string, ok: boolean, detail?: string) => {
  console.log(`${ok ? "  ✓" : "  ✗ FAIL"} ${label}${!ok && detail ? ` — ${detail}` : ""}`);
  if (!ok) failures++;
};

type Attempt = {
  error: string | null;
  /** Which account the fixture says was clicked, if any. */
  selected: string | null;
  fromHiddenTemplate: boolean;
  /** The To field the flow verified. */
  accountTo: string;
  /** Everything the flow logged, so the search-failure note can be asserted. */
  log: string[];
};

/** Run the real selection against one fixture scenario, capturing its logs. */
async function attempt(browser: Browser, query: string): Promise<Attempt> {
  const page: Page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  const log: string[] = [];
  const realLog = console.log;
  const realWarn = console.warn;
  const capture = (...args: unknown[]) => {
    log.push(args.map(String).join(" "));
  };
  let error: string | null = null;
  try {
    await page.goto(`${pathToFileURL(FIXTURE).href}?${query}`);
    console.log = capture;
    console.warn = capture;
    try {
      await selectFavoritePayee(page, PAYEE, "probe");
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  } finally {
    console.log = realLog;
    console.warn = realWarn;
  }
  const selected = await page.evaluate(() => (window as unknown as { __selected?: string }).__selected ?? null);
  const fromHiddenTemplate = await page.evaluate(
    () => (window as unknown as { __selectedFromHiddenTemplate?: boolean }).__selectedFromHiddenTemplate === true,
  );
  const accountTo = await page.locator('input[name="accountTo"]').first().inputValue().catch(() => "");
  await page.close();
  for (const line of log) realLog(`      | ${line}`);
  if (error) realLog(`      | REFUSED: ${error}`);
  return { error, selected, fromHiddenTemplate, accountTo, log };
}

async function run(browser: Browser) {
  // ── A) target on page 2, search WORKING ─────────────────────────────────
  console.log("\nA) target on page 2, picker search works (filters to the row)");
  {
    const r = await attempt(browser, "rows=base&search=on");
    check("selected the target account", r.selected === TARGET_ACCOUNT, `selected ${r.selected}`);
    check("no refusal", r.error === null, r.error ?? "");
    check("To field holds the target", r.accountTo === TARGET_ACCOUNT, `got "${r.accountTo}"`);
  }

  // ── B) target on page 2, search SILENTLY BROKEN — the real bug ──────────
  console.log("\nB) target on page 2, search silently broken (THE DEFECT: page 2 was unreachable)");
  {
    const r = await attempt(browser, "rows=base&search=broken");
    check("selected the target account anyway (paginated to page 2)", r.selected === TARGET_ACCOUNT, `selected ${r.selected}`);
    check("no refusal", r.error === null, r.error ?? "");
    check("To field holds the target", r.accountTo === TARGET_ACCOUNT, `got "${r.accountTo}"`);
    check(
      "the silent search failure was LOGGED (observability, deliverable b)",
      r.log.some((l) => /picker search/i.test(l)),
      "no line mentioning the picker search",
    );
    check(
      "the walk logged more than one page",
      r.log.filter((l) => /saved rows on picker page/i.test(l)).length >= 2,
      `${r.log.filter((l) => /saved rows on picker page/i.test(l)).length} page line(s)`,
    );
  }

  // ── C) one account rendered twice must not become two matches ───────────
  console.log("\nC) target saved twice + a hidden duplicate render, search broken (dedupe, deliverable c)");
  {
    const r = await attempt(browser, "rows=dupe&search=broken");
    check("still selected the target account", r.selected === TARGET_ACCOUNT, `selected ${r.selected}`);
    check("no false ambiguity refusal", r.error === null, r.error ?? "");
    check("clicked a RENDERED row, not the hidden duplicate", r.fromHiddenTemplate === false);
    check("To field holds the target", r.accountTo === TARGET_ACCOUNT, `got "${r.accountTo}"`);
  }

  // ── D) genuine cross-page ambiguity must refuse ─────────────────────────
  console.log("\nD) two DIFFERENT accounts sharing the last 4, one per page, search broken (must refuse)");
  {
    const r = await attempt(browser, "rows=collision&search=broken");
    check("refused", r.error !== null, "no error thrown");
    check("refusal says it refuses to select", (r.error ?? "").includes("Refusing to select"), r.error ?? "");
    check("clicked nothing at all", r.selected === null, `selected ${r.selected}`);
    check("did NOT misroute to the page-1 collision", r.accountTo !== COLLIDING_ACCOUNT, `To = "${r.accountTo}"`);
    check("To field untouched", r.accountTo === "", `To = "${r.accountTo}"`);
    check(
      "the refusal is masked — no full account number in the message",
      !/\d{5,}/.test(r.error ?? ""),
      r.error ?? "",
    );
  }

  // ── D2) the same ambiguity with the search working ──────────────────────
  console.log("\nD2) same collision, search WORKING (both rows survive the filter → still refuses)");
  {
    const r = await attempt(browser, "rows=collision&search=on");
    check("refused", r.error !== null, "no error thrown");
    check("clicked nothing", r.selected === null, `selected ${r.selected}`);
  }

  // ── E) target absent entirely ──────────────────────────────────────────
  console.log("\nE) target not in the book at all, search broken (must refuse, having walked every page)");
  {
    const r = await attempt(browser, "rows=absent&search=broken");
    check("refused", r.error !== null, "no error thrown");
    check("refusal says it refuses to select", (r.error ?? "").includes("Refusing to select"), r.error ?? "");
    check("clicked nothing", r.selected === null, `selected ${r.selected}`);
    check("To field untouched", r.accountTo === "", `To = "${r.accountTo}"`);
  }

  // ── F) the paginator advertises a page it never renders ────────────────
  console.log("\nF) page 2 advertised but inert, search broken (a partial scan is not the list → refuse)");
  {
    const r = await attempt(browser, "rows=base&search=broken&pager=stalled");
    check("refused", r.error !== null, "no error thrown");
    check(
      "says WHY it could not decide",
      (r.error ?? "").includes("could not read the whole saved list"),
      r.error ?? "",
    );
    check("clicked nothing", r.selected === null, `selected ${r.selected}`);
    check("To field untouched", r.accountTo === "", `To = "${r.accountTo}"`);
  }

  // ── G) the search "works" but filters on the wrong field ───────────────
  console.log("\nG) search matches account numbers only, so the nickname empties the list (clear the filter, then page)");
  {
    const r = await attempt(browser, "rows=base&search=acctonly");
    check("selected the target account anyway", r.selected === TARGET_ACCOUNT, `selected ${r.selected}`);
    check("no refusal", r.error === null, r.error ?? "");
    check("To field holds the target", r.accountTo === TARGET_ACCOUNT, `got "${r.accountTo}"`);
    check(
      "said the filter emptied the list",
      r.log.some((l) => /emptied the list/.test(l)),
      "nothing logged about an emptied list",
    );
    check(
      "paged the whole book after clearing the filter",
      r.log.filter((l) => /saved rows on picker page/i.test(l)).length >= 2,
      `${r.log.filter((l) => /saved rows on picker page/i.test(l)).length} page line(s)`,
    );
  }

  console.log(failures === 0 ? "\nALL GREEN" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  try {
    return await run(browser);
  } finally {
    await browser.close().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
