import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright";

/**
 * Capture the transfer e-slip after a KBIZ transaction completes.
 *
 * Nothing in kbiz-bot captured an audit artifact before this — every automated
 * transfer left the bank's own record and nothing on our side. Reimbursement
 * needs the slip to close a payment (attach proof, mark paid), and payroll
 * benefits from the same record, so this lives in lib/ and is caller-agnostic.
 *
 * We are deliberately forgiving here: a transfer that SUCCEEDED must never be
 * reported as failed just because we couldn't scrape a reference number off the
 * success page. So every extraction is best-effort — we always save the
 * screenshot (the real proof) and return whatever text we could parse.
 */

/**
 * `KBIZ_SLIPS_DIR` decouples this from the default `../data` layout so it can
 * point at a shared cross-repo dir (e.g. `/srv/kbiz-queue/slips` mounted into
 * the container) instead. Unset preserves today's behavior exactly.
 */
export const SLIPS_DIR = process.env.KBIZ_SLIPS_DIR ? resolve(process.env.KBIZ_SLIPS_DIR) : resolve("..", "data", "slips");

/** Make sure the slips/screenshots directory exists. Safe to call repeatedly. */
export function ensureSlipsDir(): string {
  mkdirSync(SLIPS_DIR, { recursive: true });
  return SLIPS_DIR;
}

export interface SlipCapture {
  /** Absolute path to the full-page PNG screenshot of the success/slip page. */
  screenshotPath: string;
  /** Absolute path to the saved page text, for later re-parsing / audit. */
  textPath: string;
  /** The KBIZ transaction reference, if one could be parsed. */
  reference?: string;
  /** The recipient name KBIZ resolved for the destination account, if shown. */
  resolvedRecipient?: string;
}

/**
 * Labels KBIZ uses for the transaction reference on a completed transfer,
 * in Thai and English. Matched case-insensitively; the first that yields a
 * value wins.
 */
const REFERENCE_LABELS = [
  // KBIZ desktop success page labels it "Transaction ID"; the phone e-slip uses
  // "เลขที่รายการ". Both carry the TRBS… reference.
  "Transaction ID",
  "เลขที่รายการ",
  "หมายเลขอ้างอิง",
  "เลขที่อ้างอิง",
  "รหัสอ้างอิง",
  "Reference No",
  "Reference Number",
  "Transaction Ref",
  "Transaction No",
];

/**
 * Pull a value that appears after one of `labels` in the page text. KBIZ
 * renders label/value either on the same line ("Reference No. : 0012345")
 * or on adjacent lines, so we handle both.
 */
export function extractLabelled(text: string, labels: string[]): string | undefined {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const label of labels) {
      const idx = line.toLowerCase().indexOf(label.toLowerCase());
      if (idx === -1) continue;

      // Same line: take what follows the label (after separators). The strip
      // set covers a trailing "." on the label itself ("Reference No." ),
      // colons (ASCII + full-width), dashes, and pipes.
      const after = line
        .slice(idx + label.length)
        .replace(/^[\s.:：\-–|]+/, "")
        .trim();
      if (after) return after;

      // Next non-empty line is the value — unless it is itself one of the
      // labels we're searching for (two stacked labels before the value).
      const next = lines[i + 1];
      if (next && !labels.some((l) => next.toLowerCase().includes(l.toLowerCase()))) {
        return next;
      }
    }
  }
  return undefined;
}

/**
 * Take the slip screenshot and best-effort-parse a reference number.
 *
 * `slug` is a short filename tag (e.g. a recipient key or bundle id) so slips
 * are recognizable on disk. It is sanitized to a safe filename fragment.
 */
export async function captureSlip(page: Page, slug: string): Promise<SlipCapture> {
  mkdirSync(SLIPS_DIR, { recursive: true });

  // No Date.now-free constraint here (this is a real Node process, not a
  // workflow sandbox) — a wall-clock stamp keeps successive slips distinct.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeSlug = (slug || "transfer").replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 40);
  const base = `transfer-${safeSlug}-${stamp}`;

  const screenshotPath = resolve(SLIPS_DIR, `${base}.png`);
  const textPath = resolve(SLIPS_DIR, `${base}.txt`);

  // Let the success page settle so the reference number has rendered.
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(1_000);

  await page.screenshot({ path: screenshotPath, fullPage: true }).catch((e) => {
    console.error(`   ⚠ slip screenshot failed: ${(e as Error).message}`);
  });

  const text = await page.evaluate(() => document.body.innerText).catch(() => "");
  writeFileSync(textPath, text, "utf8");

  const reference = extractLabelled(text, REFERENCE_LABELS);
  const resolvedRecipient = extractLabelled(text, [
    "ชื่อบัญชีผู้รับเงิน",
    "ชื่อบัญชีปลายทาง",
    "ชื่อผู้รับเงิน",
    "Recipient Name",
    "To Account Name",
    "Beneficiary Name",
  ]);

  console.log(`   🧾 slip saved: ${screenshotPath}`);
  if (reference) console.log(`   🧾 reference: ${reference}`);

  return { screenshotPath, textPath, reference, resolvedRecipient };
}
