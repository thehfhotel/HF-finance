// Shared formatting for KBIZ payee/favorite labels and sync timestamps —
// used by the admin settings screen (screens/approver/AdminKbiz.tsx) and the
// pay-time destination picker (components/KbizDestinationPicker.tsx), so the
// same account never reads differently depending on which screen shows it.
import { formatKbizAccountLabel } from './kbizDestination';
import type { PublishedPayee } from './api';

// Relative sync times use the app's one implementation, `formatThaiRelative`
// in ./format — it keeps the "N วันที่แล้ว" band, which is what makes a stale
// favorites book legible as stale. Don't add a second copy here.

/**
 * "นางสาว สลิลทิพย์ เพชรรักษ์ · Siam Commercial …7394" — the account name
 * leads, since that's what actually identifies who a handle pays; falls back
 * to the nickname, then the bare handle when the bot hasn't published
 * details for it. Used for every payee dropdown option so the same handle
 * reads identically wherever it's picked from.
 */
export function payeeOptionLabel(handle: string, payees: PublishedPayee[] | null): string {
  const p = payees?.find((x) => x.handle === handle);
  if (!p) return handle;
  return formatKbizAccountLabel(p, handle);
}

/**
 * The "→ …" caption shown under a mapped employee's name — same
 * account-name-first text as `payeeOptionLabel`, but `null` (rather than the
 * bare handle) when the handle doesn't resolve, so the caller can choose its
 * own "not found" copy instead of silently falling back to a technical id.
 */
export function payeeDetailLine(handle: string, payees: PublishedPayee[] | null): string | null {
  if (handle.trim() === '') return null;
  const p = payees?.find((x) => x.handle === handle);
  if (!p) return null;
  return formatKbizAccountLabel(p, handle);
}
