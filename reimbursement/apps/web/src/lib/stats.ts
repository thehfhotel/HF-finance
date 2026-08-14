import type { BundleWithDetails } from './types';

/**
 * Derived bundle facts the approver screens need in the browser.
 *
 * Aggregation itself belongs to `GET /api/bundles/stats`: the client holds one
 * page of bundles, not the archive, so anything that has to be summed over
 * every row is computed in Postgres and arrives already totalled. What is left
 * here is the one rule that is purely about presentation — when to offer the
 * manual override on a payment nothing has come back for.
 */

/**
 * How long a `paying` bundle may sit before the console offers the manual
 * override actions.
 *
 * The transfer itself takes seconds; the rest is the approver walking to their
 * phone to release it in the K BIZ app. Past this, the likely explanation is
 * that nothing is coming back at all — kbiz-bot is down, or died mid-flight —
 * and the human needs a way out rather than a spinner.
 */
export const PAYMENT_STUCK_MS = 10 * 60_000;

/**
 * True when a bundle has been in flight at the bank far longer than plausible.
 *
 * Only the server can act on this: the API re-checks the queue before it lets
 * anything move. This is purely about when to SHOW the two override actions.
 */
export function isPaymentStuck(bundle: BundleWithDetails, now: number = Date.now()): boolean {
  if (bundle.status !== 'paying' || bundle.paymentError !== null) return false;
  // A row with no timestamp predates the watchdog; offering the way out beats
  // leaving it unreachable.
  if (!bundle.payingSince) return true;
  const since = new Date(bundle.payingSince).getTime();
  return !Number.isFinite(since) || now - since >= PAYMENT_STUCK_MS;
}
