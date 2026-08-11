import type { Page } from "playwright";
import { gotoAuthenticated } from "../lib/session";
import { captureSlip, ensureSlipsDir, type SlipCapture } from "../lib/capture-slip";

/**
 * Ad-hoc single transfer on KBIZ's "โอนเงินไปบัญชีบุคคลอื่น" page
 * (fundtranfer-other, "Other Account" / "New" tab). Two destination modes:
 *
 *   - "favorite": select a SAVED payee. The bot opens the saved-account picker,
 *     finds the one row matching ALL THREE of { nickname, account number, bank },
 *     requires EXACTLY ONE, clicks it, and re-reads "To" to confirm KBIZ filled
 *     OUR account. A mis-keyed number can't misroute — it's only a lookup key
 *     into the vetted list. This is the safe default.
 *   - "custom": type the bank + account number for a payee not in the saved list.
 *     Less safe (the number is typed); use only when a saved favorite doesn't
 *     exist. The account name KBIZ resolves + your phone approval are the checks.
 *
 * FLOW FACTS pinned against the live page (2026-08-12):
 *   - The saved list is hidden until the address-book icon (a.input-search-acc)
 *     beside "Account No." is clicked.
 *   - Needs a desktop viewport (1600) — 1366 is KBIZ's iPad-pro breakpoint edge.
 *   - **"Next" IS the commit**: clicking it sends the phone push (there is no
 *     separate Confirm button). So PREVIEW stops BEFORE Next; CONFIRM clicks Next.
 *   - The memo rejects special characters — it is sanitized to Thai/alnum/space.
 *   - The desktop success page says "Transfer successfully" + "Transaction ID:
 *     TRBS…". The WAITING screen also contains the word "successfully", so success
 *     is keyed on those specific tokens, never bare "success".
 *
 * Two gates guard the money: `input.confirm` (default false → preview), and your
 * phone tap (the bot only arms; it never approves).
 */

const URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";
const SLIP_DIR = "../data/slips";
const APPROVAL_TIMEOUT_MS = 5.5 * 60_000; // KBIZ allows 5:58 for the phone tap

export interface Payee {
  mode: "favorite" | "custom";
  /** Favorite only: Display Name (nickname) to select + verify, e.g. "พี่วิว". */
  nickname?: string;
  /** Destination account number (favorite: verifier; custom: typed). Dashes optional. */
  accountNo: string;
  /** Destination bank, matched case-insensitively as a substring / alternation. */
  bank: string;
  /** Name on the account (logging + a soft check). */
  accountName?: string;
}

export interface TransferOtherInput {
  payee: Payee;
  amount: number;
  /** Raw memo; sanitized to KBIZ's allowed set before typing. May be "". */
  memo: string;
  attachmentPath?: string;
  /** Transfer category label to select, e.g. "Refund". Omit to leave default. */
  category?: string;
  slug: string;
  maxTransfer: number;
  /** false = preview (stop BEFORE Next). true = click Next (arm the phone push). */
  confirm: boolean;
}

export type TransferOutcome = "success" | "confirmed-failed" | "unconfirmed";

export type TransferOtherResult =
  | {
      success: true;
      finalUrl: string;
      previewOnly: boolean;
      formShot?: string;
      slip?: SlipCapture;
      reference?: string;
    }
  | { success: false; outcome?: TransferOutcome; error: string; shot?: string };

const digitsOnly = (s: string) => s.replace(/\D+/g, "");

/** KBIZ memo rejects special characters — keep only Thai, alphanumerics, space. */
export function sanitizeMemo(s: string): string {
  return s
    .replace(/[^฀-๿a-zA-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

/** Select a SAVED payee via the picker, triple-verified. Throws on any ambiguity. */
async function selectFavoritePayee(page: Page, payee: Payee, slug: string): Promise<void> {
  const acctD = digitsOnly(payee.accountNo);
  const bankRe = new RegExp(payee.bank.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
  const nickname = payee.nickname ?? "";

  console.log("→ Open saved-payee picker");
  const pick = page.locator("a.input-search-acc").first();
  await pick.waitFor({ state: "visible", timeout: 15_000 });
  await pick.click();
  await page.waitForTimeout(1_800);

  const search = page.locator('input[name="acctSearch"]').first();
  if (nickname && (await search.isVisible().catch(() => false))) {
    await search.fill(nickname).catch(() => {});
    const sb = page.locator("a#search-acct-to-btn").first();
    if (await sb.isVisible().catch(() => false)) await sb.click().catch(() => {});
    await search.press("Enter").catch(() => {});
    await page.waitForTimeout(1_500);
  }

  const rows = page.locator("div.lists").filter({ has: page.locator("a.c-bold.c-green.pointer") });
  const n = await rows.count();
  const matches: number[] = [];
  for (let i = 0; i < n; i++) {
    const t = (await rows.nth(i).innerText().catch(() => "")).replace(/\s+/g, " ").trim();
    if (t.includes(nickname) && (t.includes(payee.accountNo) || t.includes(acctD)) && bankRe.test(t)) {
      matches.push(i);
    }
  }
  console.log(`   scanned ${n} saved rows, ${matches.length} triple-verified`);
  if (matches.length !== 1) {
    await page.screenshot({ path: `${SLIP_DIR}/_picker-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Favorite "${nickname}" (${payee.accountNo}, ${payee.bank}): expected exactly one matching ` +
        `saved account, found ${matches.length}. Refusing to select.`,
    );
  }

  console.log(`→ Select verified favorite "${nickname}"`);
  await rows.nth(matches[0]).locator("a.c-bold.c-green.pointer:visible").first().click({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  const filled = await page.locator('input[name="accountTo"]').first().inputValue().catch(() => "");
  if (digitsOnly(filled) !== acctD) {
    await page.screenshot({ path: `${SLIP_DIR}/_toMismatch-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(`After selecting "${nickname}", To account is "${filled}", expected ${payee.accountNo}.`);
  }
  console.log(`   ✓ To account = ${filled}`);
}

/** Type the bank + account for a payee NOT in the saved list. */
async function selectCustomAccount(page: Page, payee: Payee, slug: string): Promise<void> {
  const acctD = digitsOnly(payee.accountNo);

  console.log(`→ Custom account: select bank "${payee.bank}"`);
  // Set the native <select> + sync jQuery/select2 (string eval avoids esbuild __name).
  const bankChosen = await page
    .evaluate(
      `(function(){
         var sel=document.querySelector('select[name="bank"]');
         if(!sel)return 'no-select';
         var want=${JSON.stringify(payee.bank.toLowerCase())};
         var opt=Array.prototype.find.call(sel.options,function(o){return (o.textContent||'').toLowerCase().indexOf(want)>=0;});
         if(!opt)return 'no-option';
         sel.value=opt.value; sel.dispatchEvent(new Event('change',{bubbles:true}));
         if(window.jQuery){try{window.jQuery(sel).val(opt.value).trigger('change');}catch(e){}}
         return (opt.textContent||'').trim();
       })()`,
    )
    .catch((e) => "eval-fail:" + (e as Error).message);
  console.log(`   bank → ${bankChosen}`);
  if (typeof bankChosen === "string" && bankChosen.startsWith("no-")) {
    throw new Error(`Could not select bank "${payee.bank}" (${bankChosen}).`);
  }
  await page.waitForTimeout(1_000);

  console.log("→ Type destination account number");
  const acct = page.locator('input[name="accountTo"]').first();
  await acct.waitFor({ state: "visible", timeout: 10_000 });
  await acct.click().catch(() => {});
  await acct.fill(acctD);
  await acct.press("Tab").catch(() => {});
  await page.waitForTimeout(3_500); // KBIZ resolves the account name async

  const filled = await acct.inputValue().catch(() => "");
  if (digitsOnly(filled) !== acctD) {
    await page.screenshot({ path: `${SLIP_DIR}/_toMismatch-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(`Typed account did not stick: field shows "${filled}", expected ${payee.accountNo}.`);
  }
  console.log(`   ✓ To account = ${filled}`);
}

export async function runTransferOtherFlow(
  page: Page,
  input: TransferOtherInput,
): Promise<TransferOtherResult> {
  const amountStr = input.amount.toFixed(2);
  const p = input.payee;
  const memo = sanitizeMemo(input.memo);

  if (input.amount > input.maxTransfer) {
    return { success: false, error: `Amount ฿${amountStr} exceeds ceiling ฿${input.maxTransfer.toLocaleString()} — refusing.` };
  }

  console.log("\n──────── โอนเงินไปบัญชีบุคคลอื่น (fundtranfer-other) ────────");
  console.log(`   payee:  [${p.mode}] ${p.nickname ?? p.accountName ?? "?"} · ${p.bank} · ${p.accountNo}`);
  console.log(`   amount: ฿${amountStr}`);
  console.log(`   memo:   ${memo || "—"}${memo !== input.memo.trim() ? "  (sanitized)" : ""}`);
  console.log(`   mode:   ${input.confirm ? "CONFIRM (Next arms the phone push)" : "PREVIEW (stops before Next)"}`);
  console.log("────────────────────────────────────────────────────────────\n");

  ensureSlipsDir();
  await gotoAuthenticated(page, URL);
  await page.setViewportSize({ width: 1600, height: 1000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  try {
    if (p.mode === "favorite") await selectFavoritePayee(page, p, input.slug);
    else await selectCustomAccount(page, p, input.slug);
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  console.log("→ Fill amount");
  const amt = page.locator('input[name="amount"]').first();
  await amt.click().catch(() => {});
  await amt.fill(amountStr);
  await amt.press("Tab").catch(() => {});

  if (memo) {
    console.log("→ Fill memo");
    const m = page.locator('input[name="memo"]').first();
    await m.fill(memo);
    await m.press("Tab").catch(() => {});
  }

  if (input.category) {
    console.log(`→ Set category "${input.category}"`);
    const catToggle = page.locator("a.popup-content-type, .category").first();
    if (await catToggle.isVisible().catch(() => false)) {
      await catToggle.click().catch(() => {});
      await page.waitForTimeout(500);
      const opt = page.locator(`a:has-text("${input.category}"):visible`).first();
      if (await opt.isVisible().catch(() => false)) await opt.click().catch(() => {});
      await page.waitForTimeout(300);
    }
  }

  if (input.attachmentPath) {
    console.log("→ Attach file");
    const fileInput = page.locator('input[name="uploadfile"], input[type="file"]').first();
    if (!(await fileInput.count())) throw new Error("No file input found for the attachment.");
    await fileInput.setInputFiles(input.attachmentPath);
    await page.waitForTimeout(1_000);
  }

  const formShot = `${SLIP_DIR}/_form-${input.slug}.png`;
  await page.screenshot({ path: formShot, fullPage: true }).catch(() => {});

  const next = page
    .locator('a.btn-gradient:has-text("Next"), a.btn:has-text("Next"), button:has-text("Next"), a:has-text("ต่อไป")')
    .filter({ hasNot: page.locator(".disabled-button") })
    .first();

  // PREVIEW: stop here. "Next" arms the push, so we never click it in preview.
  if (!input.confirm) {
    const ready = await next.isVisible().catch(() => false);
    console.log(`\n   PREVIEW — filled form captured (${formShot}). Next ${ready ? "is ready" : "NOT ready — check the form"}.`);
    console.log("   Nothing submitted, no phone push. Re-run with confirm to arm.\n");
    return { success: true, finalUrl: page.url(), previewOnly: true, formShot };
  }

  // CONFIRM: clicking Next sends the phone push.
  console.log("→ Click Next — KBIZ sends the approval push to your phone");
  await next.waitFor({ state: "visible", timeout: 15_000 });
  await next.click();
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: `${SLIP_DIR}/_waiting-${input.slug}.png`, fullPage: true }).catch(() => {});
  console.log(`   armed — waiting for your phone tap (up to ${Math.floor(APPROVAL_TIMEOUT_MS / 60000)} min)…`);

  // Success is ONLY the final slip page. The waiting screen also contains
  // "successfully", so we key on tokens unique to the success page.
  const SUCCESS_RE = /Transfer successfully|โอนเงินสำเร็จ|ทำรายการสำเร็จ|Transaction ID|TRBS[0-9]{6}/i;
  const ERROR_RE = /ไม่สำเร็จ|unsuccessful|เกิดข้อผิดพลาด|หมดเวลา|expired|session has expired|signed in on another/i;
  const started = Date.now();
  let outcome: TransferOutcome = "unconfirmed";
  while (Date.now() - started < APPROVAL_TIMEOUT_MS) {
    await page.waitForTimeout(4_000);
    const txt = (await page.evaluate(() => (document.body as any).innerText).catch(() => "")) as string;
    if (/\/error|\/login|\/authen/.test(page.url()) || ERROR_RE.test(txt)) { outcome = "confirmed-failed"; break; }
    if (SUCCESS_RE.test(txt)) { outcome = "success"; break; }
    const s = Math.floor((Date.now() - started) / 1000);
    if (s % 20 < 4) console.log(`   …waiting ${s}s`);
  }
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const slip = await captureSlip(page, input.slug);
  if (outcome === "success" && slip.reference) {
    console.log(`✅ Transfer successful. ref=${slip.reference}`);
    return { success: true, finalUrl: page.url(), previewOnly: false, slip, reference: slip.reference };
  }
  if (outcome === "success") {
    // Success page detected but no reference parsed — still a success; slip shot saved.
    console.log("✅ Transfer successful (reference not parsed — slip screenshot saved).");
    return { success: true, finalUrl: page.url(), previewOnly: false, slip };
  }
  if (outcome === "confirmed-failed") {
    return { success: false, outcome, error: `KBIZ reported the transfer did not complete. Slip: ${slip.screenshotPath}.`, shot: slip.screenshotPath };
  }
  return {
    success: false,
    outcome: "unconfirmed",
    error: `No success/failure seen within the window — the transfer may or may not have gone through. ` +
      `Check your K BIZ app + KBIZ history; attach the phone e-slip to close it. Screenshot: ${slip.screenshotPath}.`,
    shot: slip.screenshotPath,
  };
}
