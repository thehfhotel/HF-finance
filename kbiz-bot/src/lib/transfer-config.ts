import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Payee } from "../flows/transfer-other-flow";

/**
 * Config for ad-hoc "other person's account" transfers (fundtranfer-other).
 *
 * NOT a secret store — credentials stay in .env. This is the payee book, so a
 * transfer is `run it with an amount`. It's PII, so the real file
 * (transfer-other.config.json) is gitignored; only the .example is committed.
 *
 * Prefer "favorite" mode: the payee is selected from KBIZ's vetted saved list by
 * nickname and triple-verified — no account number is ever typed. Use "custom"
 * only for a payee that isn't a saved favorite.
 */

export interface RecipientConfig {
  /** "favorite" (default — select a saved payee) or "custom" (type bank+account). */
  mode?: "favorite" | "custom";
  /** Favorite only: the KBIZ saved-account Display Name (nickname), e.g. "พี่วิว". */
  nickname?: string;
  /** Destination account number (favorite: a verifier; custom: typed in). */
  accountNo: string;
  /**
   * Destination bank, matched against KBIZ's option/label text case-insensitively
   * as a substring — "กสิกร", "Kasikorn", "Siam Commercial" all resolve.
   */
  bank: string;
  /** Name on the account (logging + a soft check). */
  accountName?: string;
}

export interface TransferConfig {
  /**
   * Hard baht ceiling. A transfer above this is refused before anything is typed
   * — a backstop against a wrong amount. Raise it here, deliberately.
   */
  maxTransfer: number;
  /**
   * KBIZ's own category picker anchor id to tag the transfer with (e.g. "30"
   * = Refund). Selected by id, not label text — see KBIZ_CATEGORIES in
   * reimbursement's packages/shared for the full id/label table. Optional.
   */
  kbizCategoryId?: string;
  /** Payee book, keyed by a short handle passed with --to (e.g. "revew"). */
  recipients: Record<string, RecipientConfig>;
}

const CONFIG_PATH = resolve("transfer-other.config.json");

function fail(msg: string): never {
  throw new Error(`transfer-other.config.json: ${msg}`);
}

export function loadTransferConfig(): TransferConfig {
  if (!existsSync(CONFIG_PATH)) {
    fail(
      `not found at ${CONFIG_PATH}. Copy transfer-other.config.example.json to ` +
        `transfer-other.config.json and fill it in.`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch (e) {
    fail(`is not valid JSON — ${(e as Error).message}`);
  }

  const c = raw as Partial<TransferConfig>;
  if (!c || typeof c !== "object") fail("must be a JSON object");
  if (!c.recipients || typeof c.recipients !== "object") {
    fail('"recipients" is required and must be an object');
  }

  const recipients = c.recipients as Record<string, RecipientConfig>;
  const keys = Object.keys(recipients);
  if (keys.length === 0) fail('"recipients" is empty — add at least one payee');
  for (const key of keys) {
    const r = recipients[key];
    if (!r || typeof r !== "object") fail(`recipient "${key}" must be an object`);
    if (!r.accountNo || typeof r.accountNo !== "string") fail(`recipient "${key}" is missing "accountNo"`);
    if (!r.bank || typeof r.bank !== "string") fail(`recipient "${key}" is missing "bank"`);
    const mode = r.mode ?? "favorite";
    if (mode !== "favorite" && mode !== "custom") fail(`recipient "${key}" has invalid mode "${mode}"`);
    if (mode === "favorite" && !r.nickname) {
      fail(`recipient "${key}" is favorite mode but missing "nickname" (the KBIZ Display Name)`);
    }
  }

  return {
    maxTransfer: typeof c.maxTransfer === "number" && c.maxTransfer > 0 ? c.maxTransfer : 50_000,
    kbizCategoryId: typeof c.kbizCategoryId === "string" ? c.kbizCategoryId : undefined,
    recipients,
  };
}

/** Resolve which recipient to pay. With one payee, --to is optional. */
export function resolveRecipient(
  config: TransferConfig,
  to: string | undefined,
): { key: string; recipient: RecipientConfig } {
  const keys = Object.keys(config.recipients);
  if (to) {
    const recipient = config.recipients[to];
    if (!recipient) throw new Error(`No recipient "${to}" in config. Known: ${keys.join(", ")}`);
    return { key: to, recipient };
  }
  if (keys.length === 1) return { key: keys[0], recipient: config.recipients[keys[0]] };
  throw new Error(`Config has ${keys.length} recipients (${keys.join(", ")}); pass --to <handle>`);
}

/** Build the flow's Payee from a config entry. */
export function toPayee(r: RecipientConfig): Payee {
  return {
    mode: r.mode ?? "favorite",
    nickname: r.nickname,
    accountNo: r.accountNo,
    bank: r.bank,
    accountName: r.accountName,
  };
}
