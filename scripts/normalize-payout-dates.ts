// One-time migration: normalize every sheet's payout date (effectiveDate) to
// the business rule "payout on the 5th of the following month".
//   2026-02 → 05/03/2026,  2026-05 → 05/06/2026,  2026-12 → 05/01/2027
//
// effectiveDate is stored as DD/MM/YYYY *Gregorian* (the UI reformats to BE for
// display). We only rewrite sheets whose stored date differs from the rule, and
// we write a .bak copy of each changed file first.
//
// Usage:
//   bun run scripts/normalize-payout-dates.ts            # dry run — report only
//   bun run scripts/normalize-payout-dates.ts --apply    # write changes (+ .bak)
//   SHEETS_DIR=/app/data/sheets bun run scripts/normalize-payout-dates.ts --apply
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const SHEETS_DIR = process.env.SHEETS_DIR ?? "data/sheets";
const APPLY = process.argv.includes("--apply");

function pad(n: number) { return String(n).padStart(2, "0"); }

// 5th of the month after `period` (YYYY-MM), as DD/MM/YYYY Gregorian.
function payoutFor(period: string): string | null {
  const m = /^(\d{4})-(\d{2})$/.exec(period);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]), 5); // month index = next month
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

const files = (await readdir(SHEETS_DIR)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort();
let changed = 0, skipped = 0;

for (const file of files) {
  const period = file.replace(/\.json$/, "");
  const want = payoutFor(period);
  if (!want) continue;
  const full = join(SHEETS_DIR, file);
  const sheet = JSON.parse(await readFile(full, "utf8"));
  const have = sheet.effectiveDate || "(blank)";
  if (sheet.effectiveDate === want) { skipped++; continue; }
  changed++;
  console.log(`${period}: ${have}  →  ${want}${APPLY ? "" : "   (dry run)"}`);
  if (APPLY) {
    await writeFile(`${full}.bak`, JSON.stringify(sheet, null, 2), "utf8");
    sheet.effectiveDate = want;
    await writeFile(full, JSON.stringify(sheet, null, 2), "utf8");
  }
}

console.log(
  `\n${files.length} sheet(s): ${changed} ${APPLY ? "updated" : "would change"}, ${skipped} already correct.` +
  (APPLY || changed === 0 ? "" : `\nRe-run with --apply to write the changes (a .bak is saved for each).`)
);
