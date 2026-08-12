import type { Page } from "playwright";
import { sanitizeKbizMemo } from "@reimbursement/shared";
import { gotoAuthenticated, isUnauthenticatedUrl } from "../lib/session";
import { captureSlip, ensureSlipsDir, SLIPS_DIR, type SlipCapture } from "../lib/capture-slip";
import { aliasesForBank, matchFavoriteRows } from "../lib/scrape-favorites";

/**
 * Ad-hoc single transfer on KBIZ's "โอนเงินไปบัญชีบุคคลอื่น" page
 * (fundtranfer-other, "Other Account" / "New" tab). Two destination modes:
 *
 *   - "favorite": select a SAVED payee. The bot opens the saved-account picker,
 *     finds the one row matching ALL THREE of { nickname, account number, bank },
 *     requires EXACTLY ONE, clicks it, and re-reads "To" to confirm KBIZ filled
 *     OUR account. A mis-keyed number can't misroute — it's only a lookup key
 *     into the vetted list. This is the safe default. The account verifier is
 *     the full number when the payee book has one, or the last 4 digits when
 *     the payee came from the synced (masked) favorites list.
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
const APPROVAL_TIMEOUT_MS = 5.5 * 60_000; // KBIZ allows 5:58 for the phone tap

export interface Payee {
  mode: "favorite" | "custom";
  /** Favorite only: Display Name (nickname) to select + verify, e.g. "พี่วิว". */
  nickname?: string;
  /**
   * Destination account number (favorite: verifier; custom: typed). Dashes
   * optional. REQUIRED for "custom"; a "favorite" may instead carry only
   * `accountLast4`, which is all a synced favorite ever knows.
   */
  accountNo?: string;
  /**
   * Favorite only: last 4 digits, when the full number isn't available (the
   * synced favorites list is masked by contract). Used as the row verifier
   * and re-checked against the filled "To" field after selection.
   */
  accountLast4?: string;
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
  /**
   * KBIZ's own category picker anchor id (e.g. "30" = Refund) — see
   * KBIZ_CATEGORIES in reimbursement's packages/shared. Selected by id, never
   * by label text: the picker's id is what the anchor actually carries, and a
   * label-text click was the live-verified bug that silently left the
   * category on "Other". Omit to leave KBIZ's default.
   */
  kbizCategoryId?: string;
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

/**
 * Last 4 digits only ("…7394"), for anything that names a destination account
 * in a message. Every throw below becomes `result.error` in the queue file,
 * which process-queue posts to Slack and reimbursement persists as
 * `bundle.paymentError` — a full account number belongs in none of those (the
 * same rule describeDestination applies, and ADR 0001 decision 4). Nothing
 * diagnostic is lost: each throw captures a screenshot first, and the number
 * is in the queue file's own destination.
 */
const maskAccount = (s: string) => {
  const d = digitsOnly(s);
  return d ? `…${d.slice(-4)}` : "?";
};

// The memo rule (KBIZ rejects everything outside Thai / ASCII alnum / space)
// used to live here as a bot-local `sanitizeMemo`. It belongs to the contract:
// reimbursement BUILDS the memo with the very same function (`buildKbizMemo` →
// `sanitizeKbizMemo`), so the bot re-sanitizing an intent's memo is now
// provably a no-op instead of "two regexes we believe agree".
//
// Deliberately NOT re-exported under the old name. This module imports
// ../lib/session and ../lib/capture-slip, both of which import playwright for
// real, and root CI runs `bun test` WITHOUT kbiz-bot/node_modules — a test that
// reached for the memo rule here would drag the browser stack in and break it.
// Need the rule? `import { sanitizeKbizMemo } from "@reimbursement/shared"`,
// which pulls nothing.

/** Select a SAVED payee via the picker, triple-verified. Throws on any ambiguity. */
async function selectFavoritePayee(page: Page, payee: Payee, slug: string): Promise<void> {
  const acctD = payee.accountNo ? digitsOnly(payee.accountNo) : "";
  const last4 = payee.accountLast4 ? digitsOnly(payee.accountLast4) : "";
  const nickname = payee.nickname ?? "";
  // matchFavoriteRows tests `t.includes(criteria.nickname)`, which every row
  // passes when the nickname is "" — that would quietly degrade the
  // triple-verify to bank + verifier. Refuse before opening the picker.
  if (!nickname) throw new Error('A "favorite" payee needs a nickname (the KBIZ Display Name) — none was given.');
  // The verifier is what makes this path safe — without one, "the row whose
  // nickname matches" is a single unverified check. Fail before opening it.
  if (!acctD && last4.length !== 4) {
    throw new Error(
      `Favorite "${nickname}" carries neither an account number nor a 4-digit accountLast4 — refusing to select.`,
    );
  }
  // What errors name the destination as — masked either way, since they travel
  // to Slack and into reimbursement's stored paymentError.
  const shown = maskAccount(payee.accountNo ?? last4);

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
  const texts: string[] = [];
  for (let i = 0; i < n; i++) {
    texts.push(await rows.nth(i).innerText().catch(() => ""));
  }
  const matches = matchFavoriteRows(texts, {
    nickname,
    bank: payee.bank,
    accountNo: payee.accountNo,
    accountLast4: last4 || undefined,
  });
  console.log(`   scanned ${n} saved rows, ${matches.length} triple-verified`);
  if (matches.length !== 1) {
    await page.screenshot({ path: `${SLIPS_DIR}/_picker-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(
      `Favorite "${nickname}" (${shown}, ${payee.bank}): expected exactly one matching ` +
        `saved account, found ${matches.length}. Refusing to select.`,
    );
  }

  console.log(`→ Select verified favorite "${nickname}"`);
  await rows.nth(matches[0]).locator("a.c-bold.c-green.pointer:visible").first().click({ timeout: 15_000 });
  await page.waitForTimeout(2_000);

  const filled = await page.locator('input[name="accountTo"]').first().inputValue().catch(() => "");
  const filledD = digitsOnly(filled);
  // Full number when we have one; otherwise the last 4 KBIZ itself filled in —
  // over a field that must still hold a whole account number. 8 is the same
  // floor rowHasAccountEndingWith uses to decide a token IS an account, and it
  // stops a masked or half-rendered field ("…5678") from confirming only the 4
  // digits we already assumed.
  const toOk = acctD ? filledD === acctD : filledD.length >= 8 && filledD.endsWith(last4);
  if (!toOk) {
    await page.screenshot({ path: `${SLIPS_DIR}/_toMismatch-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(`After selecting "${nickname}", To account is ${maskAccount(filled)}, expected ${shown}.`);
  }
  console.log(`   ✓ To account = ${filled}`);
}

/**
 * Select KBIZ's transfer category by picker anchor id — never by label text
 * (a live-verified bug: clicking on visible text left the category on
 * "Other" when the popup rendered a translated/mismatched label). Category is
 * metadata, never a transfer-blocker: any step failing just warns and moves
 * on, it never throws.
 */
async function selectCategory(page: Page, kbizCategoryId: string): Promise<void> {
  try {
    const toggle = page.locator("a.popup-content-type").first();
    if (!(await toggle.isVisible().catch(() => false))) {
      console.warn(`⚠ category toggle (a.popup-content-type) not found — leaving category as-is (wanted id "${kbizCategoryId}").`);
      return;
    }
    const before = (await toggle.innerText().catch(() => "")).trim();

    await toggle.click();
    const popup = page.locator(".content-type-list, .type-list").first();
    await popup.waitFor({ state: "visible", timeout: 5_000 }).catch(() => {});

    const opt = page.locator(`a[id="${kbizCategoryId}"]:visible`).first();
    if (!(await opt.count())) {
      console.warn(`⚠ no visible category anchor with id "${kbizCategoryId}" — leaving category as-is.`);
      return;
    }
    await opt.click();
    await page.waitForTimeout(500);

    const after = (await toggle.innerText().catch(() => "")).trim();
    if (after === before) {
      console.warn(`⚠ category text unchanged after selecting id "${kbizCategoryId}" (still "${after}") — click may not have registered.`);
    } else {
      console.log(`   ✓ category → "${after}"`);
    }
  } catch (e) {
    console.warn(`⚠ category selection failed, continuing without it: ${(e as Error).message}`);
  }
}

/** Type the bank + account for a payee NOT in the saved list. */
async function selectCustomAccount(page: Page, payee: Payee, slug: string): Promise<void> {
  // Custom is the one mode that must type the number, so it must have one —
  // a favorite's masked last-4 is not enough to address a transfer.
  if (!payee.accountNo) throw new Error('A "custom" payee needs a full account number — none was given.');
  const acctD = digitsOnly(payee.accountNo);

  console.log(`→ Custom account: select bank "${payee.bank}"`);
  // Set the native <select> + sync jQuery/select2 (string eval avoids esbuild __name).
  const bankChosen = await page
    .evaluate(
      `(function(){
         var sel=document.querySelector('select[name="bank"]');
         if(!sel)return 'no-select';
         var wants=${JSON.stringify(aliasesForBank(payee.bank).map((a) => a.toLowerCase()))};
         var opt=Array.prototype.find.call(sel.options,function(o){var t=(o.textContent||'').toLowerCase();return wants.some(function(w){return t.indexOf(w)>=0;});});
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
    await page.screenshot({ path: `${SLIPS_DIR}/_toMismatch-${slug}.png`, fullPage: true }).catch(() => {});
    throw new Error(`Typed account did not stick: field shows ${maskAccount(filled)}, expected ${maskAccount(payee.accountNo)}.`);
  }
  console.log(`   ✓ To account = ${filled}`);
}

export async function runTransferOtherFlow(
  page: Page,
  input: TransferOtherInput,
): Promise<TransferOtherResult> {
  const amountStr = input.amount.toFixed(2);
  const p = input.payee;
  const memo = sanitizeKbizMemo(input.memo);

  if (input.amount > input.maxTransfer) {
    return { success: false, error: `Amount ฿${amountStr} exceeds ceiling ฿${input.maxTransfer.toLocaleString()} — refusing.` };
  }

  console.log("\n──────── โอนเงินไปบัญชีบุคคลอื่น (fundtranfer-other) ────────");
  console.log(
    `   payee:  [${p.mode}] ${p.nickname ?? p.accountName ?? "?"} · ${p.bank} · ` +
      `${maskAccount(p.accountNo ?? p.accountLast4 ?? "")}`,
  );
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

  // Built here (never throws — a Locator is a lazy handle, not a DOM query)
  // so it's reachable both inside the try below (preview return) and after
  // it closes (the Next click that arms the phone push).
  const next = page
    .locator('a.btn-gradient:has-text("Next"), a.btn:has-text("Next"), button:has-text("Next"), a:has-text("ต่อไป")')
    .filter({ hasNot: page.locator(".disabled-button") })
    .first();

  // Everything through the Next-visibility wait can fail closed: nothing has
  // been submitted to KBIZ yet, so any throw in this block returns
  // { success: false } with no `outcome` — mapFlowOutcomeToPatch files that
  // as "failed"/retryable, never "unconfirmed". Only next.click() below
  // (outside this try) arms the phone push and starts genuine ambiguity.
  try {
    console.log("→ Fill amount");
    const amt = page.locator('input[name="amount"]').first();
    await amt.click().catch(() => {});
    await amt.fill(amountStr);
    await amt.press("Tab").catch(() => {});
    await page.waitForTimeout(500);

    // fill() proves the DOM call succeeded, not that KBIZ's input mask kept
    // what we typed — read it back the same way selectFavoritePayee /
    // selectCustomAccount already verify accountTo, so a mask that reformats
    // (e.g. drops the decimal point) fails closed instead of arming with the
    // wrong sum.
    const filledAmount = await amt.inputValue().catch(() => "");
    const strippedAmount = filledAmount.replace(/,/g, "").trim();
    if (strippedAmount !== amountStr) {
      await page.screenshot({ path: `${SLIPS_DIR}/_amountMismatch-${input.slug}.png`, fullPage: true }).catch(() => {});
      throw new Error(`Amount did not stick: field shows "${filledAmount}", expected ฿${amountStr}.`);
    }
    console.log(`   ✓ amount = ${filledAmount}`);

    if (memo) {
      console.log("→ Fill memo");
      const m = page.locator('input[name="memo"]').first();
      await m.fill(memo);
      await m.press("Tab").catch(() => {});
    }

    if (input.kbizCategoryId) {
      console.log(`→ Set category (id "${input.kbizCategoryId}")`);
      await selectCategory(page, input.kbizCategoryId);
    }

    if (input.attachmentPath) {
      console.log("→ Attach file");
      // Best-effort, matching html-to-pdf's contract: a voucher problem is
      // metadata, never a transfer-blocker, so warn and continue instead of
      // throwing (which would otherwise escape as a mid-flow crash and file
      // needs-review for a payment that was never even attempted).
      try {
        const fileInput = page.locator('input[name="uploadfile"], input[type="file"]').first();
        if (!(await fileInput.count())) throw new Error("No file input found for the attachment.");
        await fileInput.setInputFiles(input.attachmentPath);
        await page.waitForTimeout(1_000);
      } catch (e) {
        console.warn(`⚠ attachment failed, continuing without it: ${(e as Error).message}`);
      }
    }

    const formShot = `${SLIPS_DIR}/_form-${input.slug}.png`;
    await page.screenshot({ path: formShot, fullPage: true }).catch(() => {});

    // PREVIEW: stop here. "Next" arms the push, so we never click it in preview.
    if (!input.confirm) {
      const ready = await next.isVisible().catch(() => false);
      console.log(`\n   PREVIEW — filled form captured (${formShot}). Next ${ready ? "is ready" : "NOT ready — check the form"}.`);
      console.log("   Nothing submitted, no phone push. Re-run with confirm to arm.\n");
      return { success: true, finalUrl: page.url(), previewOnly: true, formShot };
    }

    await next.waitFor({ state: "visible", timeout: 15_000 });
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }

  // CONFIRM: clicking Next sends the phone push.
  console.log("→ Click Next — KBIZ sends the approval push to your phone");
  await next.click();
  await page.waitForTimeout(2_500);
  await page.screenshot({ path: `${SLIPS_DIR}/_waiting-${input.slug}.png`, fullPage: true }).catch(() => {});
  console.log(`   armed — waiting for your phone tap (up to ${Math.floor(APPROVAL_TIMEOUT_MS / 60000)} min)…`);

  // Success is ONLY the final slip page. The waiting screen also contains
  // "successfully", so we key on tokens unique to the success page.
  const SUCCESS_RE = /Transfer successfully|โอนเงินสำเร็จ|ทำรายการสำเร็จ|Transaction ID|TRBS[0-9]{6}/i;
  // KBIZ's own transaction-level rejection text ONLY — the bank explicitly
  // saying the transfer did not go through. This is the sole condition safe
  // to file as "confirmed-failed" (nothing moved, safe to retry).
  //
  // "เกิดข้อผิดพลาด" is deliberately NOT here: it is KBIZ's generic "an error
  // occurred" (system/500/maintenance pages say it too), and a generic error
  // rendered after the push was armed proves nothing about the transaction —
  // it may still be approvable on the phone. It classifies as unconfirmed via
  // AMBIGUOUS_RE below, so nothing ever auto-retries against it.
  const FAILED_RE = /ไม่สำเร็จ|unsuccessful/i;
  // Generic error page mid-wait: break out early as unconfirmed (fresh
  // screenshot, human verifies in K BIZ) instead of looping to the timeout.
  const AMBIGUOUS_RE = /เกิดข้อผิดพลาด/i;
  // Session-level signals — OUR desktop session died mid-wait (bounced to
  // /login|/authen, or hit the exact "session expired" text session.ts's
  // gotoAuthenticated already probes for to mean "re-login", not "transfer
  // failed"). This proves NOTHING about the pending transaction: the phone
  // push lives server-side at KBIZ, not in the killed browser session, so it
  // may already be approved. Must resolve to "unconfirmed" (needs-review,
  // human checks K BIZ before anyone re-pays), never "confirmed-failed"
  // (auto-retried by process-queue) — see decision 3 in
  // docs/adr/0001-kbiz-transfer-automation.md.
  const SESSION_DEAD_RE = /หมดเวลา|expired|session has expired|signed in on another|session expired or you are signed in/i;
  const started = Date.now();
  let outcome: TransferOutcome = "unconfirmed";
  while (Date.now() - started < APPROVAL_TIMEOUT_MS) {
    await page.waitForTimeout(4_000);
    const txt = (await page.evaluate(() => (document.body as any).innerText).catch(() => "")) as string;
    if (isUnauthenticatedUrl(page.url()) || SESSION_DEAD_RE.test(txt)) { outcome = "unconfirmed"; break; }
    // FAILED before SUCCESS: a rejection page may well render a "Transaction
    // ID" for the failed attempt (which SUCCESS_RE would match), while the
    // live-verified success page carries none of the failure tokens — the two
    // ฿1 test transfers classified correctly under exactly this order.
    if (FAILED_RE.test(txt)) { outcome = "confirmed-failed"; break; }
    if (SUCCESS_RE.test(txt)) { outcome = "success"; break; }
    if (AMBIGUOUS_RE.test(txt)) { outcome = "unconfirmed"; break; }
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
