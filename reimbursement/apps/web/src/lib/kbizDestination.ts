// Formatting + validation shared by every screen that shows or picks a KBIZ
// payment destination: the admin payee mapping (AdminKbiz.tsx) and the
// pay-time destination picker (components/KbizDestinationPicker.tsx). One
// place for "what does a destination look like as text" so the two never
// drift into different label formats for the same account.
import type { KbizFavorite } from './types';

/** Digits-only bounds KBIZ's own transfer form enforces on a typed account
 *  number (mirrored server-side in bundles.ts `/pay-via-kbiz`). Dashes are
 *  cosmetic — only digits count toward the 8–15 range. */
export const KBIZ_ACCOUNT_NO_MIN_DIGITS = 8;
export const KBIZ_ACCOUNT_NO_MAX_DIGITS = 15;

/** Keeps only what a bank account number can contain — digits and the dashes
 *  some banks format them with — so a paste of anything else never lands in
 *  the field. */
export function sanitizeKbizAccountNoInput(raw: string): string {
  return raw.replace(/[^0-9-]/g, '');
}

export function countKbizAccountDigits(s: string): number {
  return s.replace(/[^0-9]/g, '').length;
}

export function isValidKbizAccountNo(s: string): boolean {
  const n = countKbizAccountDigits(s);
  return n >= KBIZ_ACCOUNT_NO_MIN_DIGITS && n <= KBIZ_ACCOUNT_NO_MAX_DIGITS;
}

export interface KbizAccountLabelSource {
  accountName?: string | null;
  nickname?: string | null;
  bank?: string | null;
  accountMasked?: string | null;
}

/**
 * "<account name> (<nickname>) · <bank> <masked>" — account name leads
 * everywhere a saved KBIZ destination is shown to an approver: the name on
 * the bank account is what actually identifies who gets paid, not our own
 * handle or nickname for it. The nickname appears in parens only when it says
 * something the account name doesn't (they're rarely identical); bank + masked
 * trail as the verifying detail. `fallback` (usually the handle) covers the
 * degraded case where the bot hasn't published account details at all.
 */
export function formatKbizAccountLabel(src: KbizAccountLabelSource, fallback = ''): string {
  const accountName = src.accountName?.trim() || '';
  const nickname = src.nickname?.trim() || '';
  const bank = src.bank?.trim() || '';
  const masked = src.accountMasked?.trim() || '';

  const nicknameAddsInfo = nickname !== '' && nickname !== accountName;
  let namePart = accountName || nickname || fallback;
  if (accountName && nicknameAddsInfo) namePart = `${accountName} (${nickname})`;

  const bankPart = [bank, masked].filter((x) => x !== '').join(' ');
  return bankPart ? `${namePart} · ${bankPart}` : namePart;
}

/** Same label, built directly off a synced favorite (bank + masked always present). */
export function formatKbizFavoriteLabel(fav: KbizFavorite): string {
  return formatKbizAccountLabel(fav, fav.nickname);
}
