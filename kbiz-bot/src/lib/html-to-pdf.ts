import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";

/**
 * Render an HTML file (reimbursement's Thai payment voucher) to a PDF, using
 * a throwaway Chromium instance — a **separate `chromium.launch()`**, never
 * the persistent KBIZ session context from lib/session.ts. Two unrelated
 * browsers can run side by side in the same process; only the KBIZ profile
 * itself must stay single.
 *
 * A voucher attachment is a nice-to-have, never a transfer-blocker: any
 * failure, or a PDF over KBIZ's 3MB attachment ceiling, returns `null` and
 * logs a warning. The caller proceeds without an attachment.
 */

const MAX_PDF_BYTES = 3 * 1024 * 1024;

export interface HtmlToPdfResult {
  path: string;
  bytes: number;
}

export async function htmlToPdf(html: string, outPath: string): Promise<HtmlToPdfResult | null> {
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "networkidle" });
    const pdf = await page.pdf({ format: "A4", printBackground: true });

    if (pdf.byteLength > MAX_PDF_BYTES) {
      console.warn(
        `⚠ voucher PDF is ${(pdf.byteLength / 1024 / 1024).toFixed(2)}MB, over the 3MB attachment ceiling — proceeding without attachment.`,
      );
      return null;
    }

    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, pdf);
    return { path: outPath, bytes: pdf.byteLength };
  } catch (e) {
    console.warn(`⚠ voucher HTML→PDF conversion failed — proceeding without attachment: ${(e as Error).message}`);
    return null;
  } finally {
    await browser?.close().catch(() => {});
  }
}
