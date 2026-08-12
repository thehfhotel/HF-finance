import type { BundleWithDetails, Property } from './types';

/**
 * Aggregations and derived bundle facts for the approver screens.
 *
 * Everything here is derived in the browser from the bundle list the approver
 * already holds — `GET /api/bundles` returns every bundle with its receipts,
 * and the inbox has always built its tabs client-side (see the comment in
 * apps/api/src/routes/bundles.ts). Adding a stats endpoint would mean a new
 * route, a new shared contract and a second source of truth for numbers the
 * client can already compute exactly, so the overview reuses the same payload.
 *
 * Pure functions only — no React, no formatting. Callers format.
 */

const DAY_MS = 86_400_000;

export const bundleTotal = (bundle: BundleWithDetails): number =>
  bundle.receipts.reduce((acc, r) => acc + r.amount, 0);

export const sumTotals = (bundles: BundleWithDetails[]): number =>
  bundles.reduce((acc, b) => acc + bundleTotal(b), 0);

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

/** Whole days between `submittedAt` and now, floored, never negative. */
export function daysWaiting(bundle: BundleWithDetails, now: number = Date.now()): number {
  const submitted = new Date(bundle.submittedAt).getTime();
  if (!Number.isFinite(submitted)) return 0;
  return Math.max(0, Math.floor((now - submitted) / DAY_MS));
}

/** Severity of a wait, used for both the chip colour and the queue chart. */
export type AgeBand = 'hot' | 'warm' | 'cool';

export const ageBand = (days: number): AgeBand => (days >= 10 ? 'hot' : days >= 5 ? 'warm' : 'cool');

export interface AgeBucket {
  band: AgeBand;
  label: string;
  count: number;
}

export function agingBuckets(pending: BundleWithDetails[], now: number = Date.now()): AgeBucket[] {
  const tally: Record<AgeBand, number> = { hot: 0, warm: 0, cool: 0 };
  pending.forEach((b) => {
    tally[ageBand(daysWaiting(b, now))] += 1;
  });
  return [
    { band: 'hot', label: 'เกิน 10 วัน', count: tally.hot },
    { band: 'warm', label: '5–9 วัน', count: tally.warm },
    { band: 'cool', label: 'ไม่เกิน 5 วัน', count: tally.cool },
  ];
}

/** Longest-waiting pending bundles first — the triage order. */
export function oldestPending(
  pending: BundleWithDetails[],
  limit: number,
  now: number = Date.now(),
): BundleWithDetails[] {
  return [...pending]
    .sort((a, b) => daysWaiting(b, now) - daysWaiting(a, now))
    .slice(0, limit);
}

export interface NamedTotal {
  key: string;
  label: string;
  amount: number;
}

const rankDesc = (rows: Map<string, number>, limit?: number): NamedTotal[] => {
  const out = [...rows.entries()]
    .map(([key, amount]) => ({ key, label: key, amount }))
    .sort((a, b) => b.amount - a.amount);
  return limit == null ? out : out.slice(0, limit);
};

export function byCategory(bundles: BundleWithDetails[], limit?: number): NamedTotal[] {
  const rows = new Map<string, number>();
  bundles.forEach((b) =>
    b.receipts.forEach((r) => rows.set(r.category, (rows.get(r.category) ?? 0) + r.amount)),
  );
  return rankDesc(rows, limit);
}

export function bySubmitter(bundles: BundleWithDetails[], limit?: number): NamedTotal[] {
  const rows = new Map<string, number>();
  bundles.forEach((b) => rows.set(b.submitter.name, (rows.get(b.submitter.name) ?? 0) + bundleTotal(b)));
  return rankDesc(rows, limit);
}

export function byProperty(bundles: BundleWithDetails[]): Record<Property, number> {
  const rows: Record<Property, number> = { 'hf-hotel': 0, 'hf-ville': 0 };
  bundles.forEach((b) => b.receipts.forEach((r) => { rows[r.property] += r.amount; }));
  return rows;
}

export interface MonthPoint {
  /** Sort key, `YYYY-MM`. */
  key: string;
  /** Abbreviated Thai month, e.g. "ส.ค.". */
  label: string;
  amount: number;
}

const THAI_MONTHS_SHORT = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/**
 * Paid baht per calendar month for the trailing `months` window, oldest first.
 * Buckets on `paidAt` (when money actually left) rather than `submittedAt`, and
 * always emits a point per month so a quiet month reads as a real zero rather
 * than a gap in the line.
 */
export function paidByMonth(
  bundles: BundleWithDetails[],
  months: number,
  now: Date = new Date(),
): MonthPoint[] {
  const totals = new Map<string, number>();
  bundles.forEach((b) => {
    if (b.status !== 'paid' || !b.paidAt) return;
    const d = new Date(b.paidAt);
    if (Number.isNaN(d.getTime())) return;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    totals.set(key, (totals.get(key) ?? 0) + bundleTotal(b));
  });

  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: THAI_MONTHS_SHORT[d.getMonth()], amount: totals.get(key) ?? 0 });
  }
  return out;
}

/** Total paid in the current calendar month. */
export function paidThisMonth(bundles: BundleWithDetails[], now: Date = new Date()): number {
  const y = now.getFullYear();
  const m = now.getMonth();
  return bundles.reduce((acc, b) => {
    if (b.status !== 'paid' || !b.paidAt) return acc;
    const d = new Date(b.paidAt);
    if (Number.isNaN(d.getTime()) || d.getFullYear() !== y || d.getMonth() !== m) return acc;
    return acc + bundleTotal(b);
  }, 0);
}
