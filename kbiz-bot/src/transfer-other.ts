import { existsSync, statSync } from "node:fs";
import { extname, resolve } from "node:path";
import { withSession } from "./lib/session";
import { runTransferOtherFlow } from "./flows/transfer-other-flow";
import { loadTransferConfig, resolveRecipient, toPayee } from "./lib/transfer-config";
import { parseArmLock } from "./lib/arm-gate";
import { readArmLockRaw } from "./lib/arm-lock";

/**
 * Run a single ad-hoc transfer to another person's account.
 *
 *   npm run transfer-other -- --amount 1234.50 --memo "REIMB-08 Revew"
 *      → PREVIEW: fills the form, stops at KBIZ's review screen, screenshots it.
 *        Nothing submitted, no phone push.
 *
 *   npm run transfer-other -- --amount 1234.50 --memo "REIMB-08 Revew" --confirm
 *      → arms the transfer; then you approve on your K BIZ phone app.
 *
 *   Options:
 *     --amount <baht>     required; must be ≤ config.maxTransfer
 *     --memo "<text>"     บันทึกช่วยจำ, ≤100 chars (recommended for audit)
 *     --to <handle>       recipient key from config (optional if only one)
 *     --attach <path>     jpeg/png/pdf, ≤3MB
 *     --confirm           actually arm the transfer (default is preview)
 */

const MAX_ATTACH_BYTES = 3 * 1024 * 1024;
const ATTACH_EXTS = new Set([".jpg", ".jpeg", ".png", ".pdf"]);

function getFlag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : undefined;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

function die(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

function maskAccount(n: string): string {
  const d = n.replace(/\D+/g, "");
  return d.length <= 4 ? d : `${"•".repeat(d.length - 4)}${d.slice(-4)}`;
}

// ── parse + validate ──────────────────────────────────────────────────────
const config = (() => {
  try {
    return loadTransferConfig();
  } catch (e) {
    die((e as Error).message);
  }
})();

const { key, recipient } = (() => {
  try {
    return resolveRecipient(config, getFlag("to"));
  } catch (e) {
    die((e as Error).message);
  }
})();

const amountRaw = getFlag("amount");
if (!amountRaw) die("--amount is required, e.g. --amount 1234.50");
if (!/^\d+(\.\d{1,2})?$/.test(amountRaw)) {
  die(`--amount must be a positive number with ≤2 decimals (got "${amountRaw}")`);
}
const amount = Number(amountRaw);
if (amount <= 0) die("--amount must be greater than 0");
if (amount > config.maxTransfer) {
  die(
    `--amount ฿${amount.toFixed(2)} exceeds the safety ceiling of ฿${config.maxTransfer.toLocaleString()} ` +
      `(maxTransfer in transfer-other.config.json). Raise it there, deliberately, if this is intended.`,
  );
}

const memo = getFlag("memo") ?? "";
if (memo.length > 100) die(`--memo is ${memo.length} chars; KBIZ allows ≤100. Shorten it.`);
if (!memo) console.warn("⚠ No --memo given. A memo is recommended so the transfer is auditable.");

let attachmentPath: string | undefined;
const attachRaw = getFlag("attach");
if (attachRaw) {
  attachmentPath = resolve(attachRaw);
  if (!existsSync(attachmentPath)) die(`--attach file not found: ${attachmentPath}`);
  const ext = extname(attachmentPath).toLowerCase();
  if (!ATTACH_EXTS.has(ext)) die(`--attach must be jpeg/png/pdf (got "${ext}")`);
  const size = statSync(attachmentPath).size;
  if (size > MAX_ATTACH_BYTES) {
    die(`--attach is ${(size / 1024 / 1024).toFixed(2)}MB; KBIZ allows ≤3MB.`);
  }
}

const confirm = hasFlag("confirm");

// ── the plan (always printed, both modes) ─────────────────────────────────
console.log("\n════════ KBIZ transfer plan ════════");
console.log(`  recipient : ${key}${recipient.accountName ? `  (${recipient.accountName})` : ""}`);
console.log(`  path      : ${recipient.mode ?? "favorite"}${recipient.nickname ? `  (nickname "${recipient.nickname}")` : ""}`);
console.log(`  bank      : ${recipient.bank}`);
console.log(`  account   : ${maskAccount(recipient.accountNo)}`);
console.log(`  amount    : ฿${amount.toFixed(2)}  (ceiling ฿${config.maxTransfer.toLocaleString()})`);
console.log(`  memo      : ${memo || "—"}`);
console.log(`  attach    : ${attachmentPath ?? "—"}`);
console.log(`  mode      : ${confirm ? "⚠ CONFIRM — Next arms the phone push" : "PREVIEW — stops before Next"}`);
console.log("════════════════════════════════════\n");

// ── arm lock ──────────────────────────────────────────────────────────────
// One live approval push in the ESTATE, not one per process: the queue bot and
// this CLI share the same phone and the same bank-side push. A second push
// armed while the first is still tappable is the double-pay path (incidents
// 2026-08-12 + 2026-08-13) — and a manual run is exactly how an impatient
// human reaches for it. Preview is unaffected; it never clicks Next.
if (confirm) {
  const now = Date.now();
  const { text, mtimeMs } = readArmLockRaw();
  const lock = parseArmLock(text, mtimeMs, now);
  if (lock.live) {
    const armed = lock.armedAt !== undefined ? new Date(lock.armedAt).toISOString() : "an unknown time";
    const until = new Date(lock.until).toISOString();
    const left = Math.ceil((lock.until - now) / 1000);
    die(
      `An approval push armed at ${armed} may still be live until ${until} (~${left}s) — ` +
        `refusing to arm a second one. Tap or let the first one expire, then re-run. ` +
        `(lock: ${lock.source})`,
    );
  }
}

// ── run ───────────────────────────────────────────────────────────────────
await withSession(async (_ctx, page) => {
  const result = await runTransferOtherFlow(page, {
    payee: toPayee(recipient),
    amount,
    memo,
    attachmentPath,
    kbizCategoryId: config.kbizCategoryId,
    slug: key,
    maxTransfer: config.maxTransfer,
    confirm,
  });

  if (!result.success) {
    console.error(`\n❌ ${result.error}\n`);
    process.exit(1);
  }

  if (result.previewOnly) {
    console.log(`\n✅ Preview complete. Filled-form screenshot: ${result.formShot}`);
    console.log("   Nothing was submitted, no phone push. Re-run with --confirm to arm.\n");
    return;
  }

  console.log(`\n✅ Transfer completed.`);
  if (result.reference) console.log(`   reference: ${result.reference}`);
  if (result.slip?.screenshotPath) console.log(`   slip: ${result.slip.screenshotPath}`);
  console.log("");
});
