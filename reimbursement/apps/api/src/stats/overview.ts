import {
  PROPERTY_LABELS,
  type BundleStatus,
  type OverviewActivityEvent,
  type OverviewActivityRow,
  type OverviewAgeBand,
  type OverviewAlert,
  type OverviewBreakdown,
  type OverviewBundleRef,
  type OverviewDecisions,
  type OverviewFlow,
  type OverviewGroup,
  type OverviewIdSet,
  type OverviewLadder,
  type OverviewLadderEntry,
  type OverviewOrphanGroup,
  type OverviewOrphanReceipt,
  type OverviewOwed,
  type OverviewPaid,
  type OverviewPropertyCategory,
  type OverviewPropertyKey,
  type OverviewQueue,
  type OverviewSeries,
  type OverviewSeriesPoint,
  type OverviewSlice,
  type OverviewSpeed,
  type OverviewSpeedBucket,
  type OverviewSpeedMetric,
  type OverviewStats,
  type OverviewWindowKey,
  type OverviewWindowRange,
  type Property,
} from '@reimbursement/shared';
import { prisma } from '../db';
import { Prisma } from '../generated/prisma';
import {
  activityLabel,
  buildDelta,
  dayCaption,
  prevWindowCaption,
  prevWindowLabel,
  weeklyBucketCaption,
  windowCaption,
  windowLabel,
  type BkkDate,
} from './thai-dates';
import { loadOverviewBounds, type Boundary, type WindowBounds } from './windows';

/** Max ids shipped per group. */
const ID_CAP = 25;
/** Ceiling on the deduped bundle dictionary. */
const DICT_CAP = 300;
/** Below this n, a median or a rate is suppressed. */
const LOW_SAMPLE_THRESHOLD = 5;
/** A KBIZ transfer older than this with no error is stuck at the bank. Defined
 *  server-side so the client never re-derives the rule. */
const PAYMENT_STUCK_MS = 10 * 60_000;
/** Rows in the ใบเสร็จลอย drill's flat receipt list. */
const ORPHAN_ROW_CAP = 120;
const ACTIVITY_CAP = 24;
const BREAKDOWN_ROW_CAP = 6;
const TOP_CATEGORY_CAP = 5;
const REASON_CAP = 5;
const DAY_MS = 86_400_000;

const ISO_FMT = Prisma.raw(`'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'`);
const BKK_MINUTE_FMT = Prisma.raw(`'YYYY-MM-DD HH24:MI'`);

const ACTIVITY_EVENTS: readonly OverviewActivityEvent[] = [
  'submit',
  'approve',
  'reject',
  'pay',
  'pay-via-kbiz',
  'withdraw',
  'payment-failed',
];

const STATUS_TO_SHARED: Record<string, BundleStatus> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  PAYING: 'paying',
  PAID: 'paid',
  REJECTED: 'rejected',
};

export interface OverviewParams {
  window: OverviewWindowKey;
  property: OverviewPropertyKey;
}

/**
 * Money crosses the wire as a JS number in baht.
 *
 * Every figure is rounded to satang on the way out. `Decimal(12,2)` values are
 * exact in Postgres `numeric` and only become floats at the `::float8` cast, so
 * the only imprecision possible is the last bit of a float sum — rounding here
 * is what lets `byCategory.coverage.windowTotal === paid.total` hold as strict
 * equality, which the whole page's one-denominator promise rests on.
 */
function money(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

function int(value: unknown): number {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? Math.trunc(n) : 0;
}

function wholeDaysSince(fromMs: number | null, nowMs: number): number {
  if (fromMs === null || !Number.isFinite(fromMs)) return 0;
  return Math.max(0, Math.floor((nowMs - fromMs) / DAY_MS));
}

function parseMs(iso: string | null): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

function parseBkkText(text: string): BkkDate {
  const [datePart, timePart = '00:00'] = text.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mi] = timePart.split(':').map(Number);
  return { y, m, d, hh, mi };
}

// ── calendar walking (Bangkok, DST-free, so UTC arithmetic is exact) ──────

function dayKey(date: BkkDate): string {
  return `${date.y}-${String(date.m).padStart(2, '0')}-${String(date.d).padStart(2, '0')}`;
}

function addDays(date: BkkDate, n: number): BkkDate {
  const shifted = new Date(Date.UTC(date.y, date.m - 1, date.d + n));
  return {
    y: shifted.getUTCFullYear(),
    m: shifted.getUTCMonth() + 1,
    d: shifted.getUTCDate(),
    hh: 0,
    mi: 0,
  };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

// ── id-set helpers ───────────────────────────────────────────────────────

function capIds(ids: string[]): OverviewIdSet {
  return { ids: ids.slice(0, ID_CAP), overflow: Math.max(0, ids.length - ID_CAP) };
}

/** `count`/`total` are always the TRUE aggregate; only `ids` is capped. */
function sliceOf(rows: Array<{ id: string; amount: number }>): OverviewSlice {
  const total = rows.reduce((sum, row) => sum + row.amount, 0);
  return { ...capIds(rows.map((row) => row.id)), count: rows.length, total: money(total) };
}

function sliceById(rows: Array<{ id: string; amount: number }>, ids: string[]): Record<string, number> {
  const byId = new Map<string, number>();
  for (const row of rows) byId.set(row.id, (byId.get(row.id) ?? 0) + row.amount);
  const out: Record<string, number> = {};
  for (const id of ids) out[id] = money(byId.get(id) ?? 0);
  return out;
}

// ── row shapes ───────────────────────────────────────────────────────────

interface PaidRow {
  id: string;
  name: string;
  user_id: string;
  submitter_name: string;
  submitter_initials: string;
  paid_at: string;
  paid_day: string;
  amount: number;
  receipt_count: number;
}

interface QueueRow {
  id: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  paying_since: string | null;
  payment_error: string | null;
  amount: number;
}

interface BreakdownRow {
  bundle_id: string;
  category: string;
  vendor_key: string;
  vendor_label: string | null;
  property: string;
  amount: number;
  receipt_count: number;
}

interface FlowRow {
  id: string;
  status: string;
  submitted_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  amount: number;
}

interface RejectionRow {
  id: string;
  at: string;
  reject_reason: string | null;
  amount: number;
}

interface SpeedRow {
  metric: string;
  id: string;
  secs: number;
}

interface SpeedStatRow {
  metric: string;
  median: number | null;
  p90: number | null;
  n: number;
}

interface OwedRow {
  id: string;
  user_id: string;
  name: string;
  initials: string;
  approved_at: string | null;
  amount: number;
}

interface OrphanGroupRow {
  user_id: string;
  name: string;
  initials: string;
  count: number;
  total: number;
  oldest: string | null;
}

interface OrphanReceiptRow {
  id: string;
  user_id: string;
  merchant: string;
  category: string;
  amount: number;
  date: string;
  created_at: string;
}

interface ActivityRow {
  event: string;
  bundle_id: string | null;
  at: string;
  at_bkk: string;
  actor_name: string;
  actor_initials: string;
  name: string;
  amount: number;
  meta_amount: string | null;
}

interface DictRow {
  id: string;
  name: string;
  status: string;
  submitter_name: string;
  submitter_initials: string;
  amount: number;
  receipt_count: number;
  property_count: number;
  property_min: string | null;
  submitted_at: string | null;
  approved_at: string | null;
  paid_at: string | null;
  paying_since: string | null;
  rejected_at: string | null;
  transfer_ref: string | null;
  reject_reason: string | null;
  payment_error: string | null;
}

// ── breakdown assembly ───────────────────────────────────────────────────

interface GroupEntry {
  key: string;
  label: string;
  bundleId: string;
  amount: number;
  receiptCount: number;
  initials?: string | null;
}

interface BreakdownOptions {
  /** Groups that must appear even at zero — byProperty's two rows. */
  seed?: Array<{ key: string; label: string }>;
  topCategoriesByKey?: Map<string, OverviewPropertyCategory[]>;
}

/**
 * Rank one dimension of the window's cash-out.
 *
 * `coverage.covered` is the sum of every group, `windowTotal` is the window's
 * paid total, and the two are equal by construction: each dimension partitions
 * the very same receipt rows. That identity is the one-window-one-denominator
 * proof the page depends on, so nothing here may filter a group away.
 */
function buildBreakdown(
  entries: GroupEntry[],
  windowTotal: number,
  tailNoun: string,
  options: BreakdownOptions = {},
): OverviewBreakdown {
  interface Accumulator {
    key: string;
    label: string;
    amount: number;
    receiptCount: number;
    initials: string | null;
    rows: Array<{ id: string; amount: number }>;
  }

  const groups = new Map<string, Accumulator>();
  const ensure = (key: string, label: string, initials: string | null): Accumulator => {
    let group = groups.get(key);
    if (!group) {
      group = { key, label, amount: 0, receiptCount: 0, initials, rows: [] };
      groups.set(key, group);
    }
    return group;
  };

  for (const seed of options.seed ?? []) ensure(seed.key, seed.label, null);

  for (const entry of entries) {
    const group = ensure(entry.key, entry.label, entry.initials ?? null);
    group.amount += entry.amount;
    group.receiptCount += entry.receiptCount;
    group.rows.push({ id: entry.bundleId, amount: entry.amount });
  }

  const ranked = [...groups.values()].sort(
    (a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'th'),
  );

  const toGroup = (group: Accumulator): OverviewGroup => {
    const perBundle = new Map<string, number>();
    for (const row of group.rows) {
      perBundle.set(row.id, (perBundle.get(row.id) ?? 0) + row.amount);
    }
    const ordered = [...perBundle.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);
    const idSet = capIds(ordered);
    return {
      ...idSet,
      key: group.key,
      label: group.label,
      amount: money(group.amount),
      share: windowTotal > 0 ? group.amount / windowTotal : 0,
      count: perBundle.size,
      receiptCount: group.receiptCount,
      sliceById: sliceById(group.rows, idSet.ids),
      initials: group.initials,
      topCategories: options.topCategoriesByKey?.get(group.key) ?? null,
    };
  };

  const rows = ranked.slice(0, BREAKDOWN_ROW_CAP).map(toGroup);
  const rest = ranked.slice(BREAKDOWN_ROW_CAP);

  let tail: OverviewBreakdown['tail'] = null;
  if (rest.length > 0) {
    const restRows = rest.flatMap((group) => group.rows);
    const perBundle = new Map<string, number>();
    for (const row of restRows) perBundle.set(row.id, (perBundle.get(row.id) ?? 0) + row.amount);
    const ordered = [...perBundle.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
    const idSet = capIds(ordered);
    tail = {
      ...idSet,
      label: `อื่น ๆ อีก ${rest.length} ${tailNoun}`,
      amount: money(rest.reduce((sum, group) => sum + group.amount, 0)),
      count: rest.length,
      sliceById: sliceById(restRows, idSet.ids),
    };
  }

  const covered = ranked.reduce((sum, group) => sum + group.amount, 0);
  return { rows, tail, coverage: { covered: money(covered), windowTotal: money(windowTotal) } };
}

// ── dictionary-cap trimming ──────────────────────────────────────────────

interface TrimTarget {
  holder: OverviewIdSet;
  slices: Array<Record<string, number>>;
}

function target(holder: OverviewIdSet, ...slices: Array<Record<string, number>>): TrimTarget {
  return { holder, slices };
}

/**
 * Hold the dictionary to its ceiling WITHOUT ever emitting an id that has no
 * dictionary entry — a drill row with no bundle behind it renders blank.
 *
 * Ids are dropped from the LOWEST-ranked groups first (`targets` arrives in
 * that order) and only shrink the union when the last group referencing them
 * lets go, which is why this counts references rather than trimming blindly.
 * Alert and activity ids are protected: they are the page's call to action.
 */
function enforceDictCap(targets: TrimTarget[], protectedIds: Set<string>): {
  ids: string[];
  truncated: boolean;
} {
  const refs = new Map<string, number>();
  for (const { holder } of targets) {
    for (const id of holder.ids) refs.set(id, (refs.get(id) ?? 0) + 1);
  }

  const union = new Set<string>([...refs.keys(), ...protectedIds]);
  if (union.size <= DICT_CAP) return { ids: [...union], truncated: false };

  for (const { holder, slices } of targets) {
    while (union.size > DICT_CAP && holder.ids.length > 0) {
      const dropped = holder.ids.pop() as string;
      holder.overflow += 1;
      for (const slice of slices) delete slice[dropped];
      const remaining = (refs.get(dropped) ?? 1) - 1;
      refs.set(dropped, remaining);
      if (remaining <= 0 && !protectedIds.has(dropped)) union.delete(dropped);
    }
    if (union.size <= DICT_CAP) break;
  }

  return { ids: [...union], truncated: true };
}

// ── the build ────────────────────────────────────────────────────────────

export async function buildOverviewStats(params: OverviewParams): Promise<OverviewStats> {
  const { property } = params;
  const bounds = await loadOverviewBounds();
  const win = bounds[params.window];
  const nowMs = bounds.now.ms;

  // A-4: property is a RECEIPT column, so the filter slices a bundle rather
  // than selecting one. A bundle straddling both properties appears under both
  // chips with different amounts — that is what `sliceById` discloses.
  const propFilter =
    property === 'all' ? Prisma.empty : Prisma.sql`AND r."property" = ${property}`;

  // ONE snapshot for the whole page. `coverage.covered` has to equal the
  // ladder's `paid.total`; two batches would read two MVCC snapshots, and a
  // settlement landing in the gap would break that identity for one response.
  const [
    paidRows,
    queueRows,
    orphanGroupRows,
    orphanReceiptRows,
    breakdownRows,
    flowRows,
    rejectionRows,
    speedRows,
    speedStatRows,
    owedRows,
    activityRows,
  ] = await prisma.$transaction(
    [
    prisma.$queryRaw<PaidRow[]>`
      SELECT b."id",
             b."name",
             b."userId" AS user_id,
             u."name" AS submitter_name,
             u."initials" AS submitter_initials,
             to_char(b."paidAt", ${ISO_FMT}) AS paid_at,
             to_char(b."paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', 'YYYY-MM-DD') AS paid_day,
             SUM(r."amount")::float8 AS amount,
             COUNT(r."id")::int AS receipt_count
      FROM bundles b
      JOIN receipts r ON r."bundleId" = b."id"
      JOIN users u ON u."id" = b."userId"
      WHERE b."status" = 'PAID'
        AND b."paidAt" >= ${bounds.ladderFloor.sql}::timestamp
        AND b."paidAt" <= ${bounds.now.sql}::timestamp
        ${propFilter}
      GROUP BY b."id", b."name", b."userId", u."name", u."initials", b."paidAt"
      ORDER BY b."paidAt" DESC
    `,

    // Queue + alerts are window- AND property-immune (arbitration A-1): the
    // ตอนนี้ badge means "live, org-wide". LEFT JOIN so a bundle with no
    // receipts still counts as one bundle, matching the sidebar's own counts.
    prisma.$queryRaw<QueueRow[]>`
      SELECT b."id",
             b."status"::text AS status,
             to_char(b."submittedAt", ${ISO_FMT}) AS submitted_at,
             to_char(b."approvedAt", ${ISO_FMT}) AS approved_at,
             to_char(b."payingSince", ${ISO_FMT}) AS paying_since,
             b."paymentError" AS payment_error,
             COALESCE(SUM(r."amount"), 0)::float8 AS amount
      FROM bundles b
      LEFT JOIN receipts r ON r."bundleId" = b."id"
      WHERE b."status" IN ('PENDING', 'APPROVED', 'PAYING')
      GROUP BY b."id", b."status", b."submittedAt", b."approvedAt", b."payingSince", b."paymentError"
    `,

    prisma.$queryRaw<OrphanGroupRow[]>`
      SELECT r."userId" AS user_id,
             u."name" AS name,
             u."initials" AS initials,
             COUNT(*)::int AS count,
             SUM(r."amount")::float8 AS total,
             to_char(MIN(r."createdAt"), ${ISO_FMT}) AS oldest
      FROM receipts r
      JOIN users u ON u."id" = r."userId"
      WHERE r."bundleId" IS NULL
      GROUP BY r."userId", u."name", u."initials"
    `,

    // Per-user top rows rather than a flat LIMIT, so a user buried behind a
    // noisier colleague still gets receiptIds for their own drill group.
    prisma.$queryRaw<OrphanReceiptRow[]>`
      SELECT id, user_id, merchant, category, amount, date, created_at
      FROM (
        SELECT r."id" AS id,
               r."userId" AS user_id,
               r."merchant" AS merchant,
               r."category" AS category,
               r."amount"::float8 AS amount,
               r."date" AS date,
               to_char(r."createdAt", ${ISO_FMT}) AS created_at,
               row_number() OVER (PARTITION BY r."userId" ORDER BY r."createdAt" ASC, r."id" ASC) AS rn
        FROM receipts r
        WHERE r."bundleId" IS NULL
      ) ranked
      WHERE rn <= ${ID_CAP}
      ORDER BY created_at ASC, id ASC
    `,

    prisma.$queryRaw<BreakdownRow[]>`
      SELECT r."bundleId" AS bundle_id,
             r."category" AS category,
             COALESCE('v:' || r."vendorId", 'm:' || vendor_normalize(r."merchant")) AS vendor_key,
             COALESCE(v."name", r."merchant") AS vendor_label,
             r."property" AS property,
             SUM(r."amount")::float8 AS amount,
             COUNT(*)::int AS receipt_count
      FROM receipts r
      JOIN bundles b ON b."id" = r."bundleId"
      LEFT JOIN vendors v ON v."id" = r."vendorId"
      WHERE b."status" = 'PAID'
        AND b."paidAt" >= ${win.start.sql}::timestamp
        AND b."paidAt" <= ${win.end.sql}::timestamp
        ${propFilter}
      GROUP BY r."bundleId", r."category", 3, 4, r."property"
    `,

    // LEFT JOIN, and the property filter rides the join rather than the WHERE:
    // rejecting and withdrawing both detach a bundle's receipts, and an inner
    // join would delete those bundles from `flow.submitted`/`.approved`
    // entirely instead of zeroing their money — shrinking `decisions.n` and
    // inflating the one rate ผลการตัดสิน exists to report. A bundle that still
    // owns receipts but none in the chosen branch is genuinely not this
    // branch's intake and is excluded; a bundle with no receipts left has no
    // branch to be excluded from, so it counts under either chip.
    prisma.$queryRaw<FlowRow[]>`
      SELECT b."id",
             b."status"::text AS status,
             to_char(b."submittedAt", ${ISO_FMT}) AS submitted_at,
             to_char(b."approvedAt", ${ISO_FMT}) AS approved_at,
             to_char(b."paidAt", ${ISO_FMT}) AS paid_at,
             COALESCE(SUM(r."amount"), 0)::float8 AS amount
      FROM bundles b
      LEFT JOIN receipts r ON r."bundleId" = b."id" ${propFilter}
      WHERE (
              (b."submittedAt" >= ${win.start.sql}::timestamp AND b."submittedAt" <= ${win.end.sql}::timestamp)
           OR (b."approvedAt"  >= ${win.start.sql}::timestamp AND b."approvedAt"  <= ${win.end.sql}::timestamp)
           OR (b."status" = 'PAID' AND b."paidAt" >= ${win.start.sql}::timestamp AND b."paidAt" <= ${win.end.sql}::timestamp)
            )
        ${
          property === 'all'
            ? Prisma.empty
            : Prisma.sql`AND (
                 EXISTS (SELECT 1 FROM receipts rp WHERE rp."bundleId" = b."id" AND rp."property" = ${property})
              OR NOT EXISTS (SELECT 1 FROM receipts rp WHERE rp."bundleId" = b."id")
               )`
        }
      GROUP BY b."id", b."status", b."submittedAt", b."approvedAt", b."paidAt"
    `,

    // Rejections come from audit_events, NEVER approvedAt — a bundle rejected
    // straight out of PENDING never gets one. Rejecting also returns the
    // receipts to the submitter's draft pool, so a rejected bundle normally
    // has none left and its amount is honestly 0.
    prisma.$queryRaw<RejectionRow[]>`
      SELECT ae."bundleId" AS id,
             to_char(ae."createdAt", ${ISO_FMT}) AS at,
             b."rejectReason" AS reject_reason,
             COALESCE((
               SELECT SUM(r."amount") FROM receipts r
               WHERE r."bundleId" = b."id" ${propFilter}
             ), 0)::float8 AS amount
      FROM audit_events ae
      JOIN bundles b ON b."id" = ae."bundleId"
      WHERE ae."type" = 'reject'
        AND ae."createdAt" >= ${win.start.sql}::timestamp
        AND ae."createdAt" <= ${win.end.sql}::timestamp
      ORDER BY ae."createdAt" DESC
    `,

    prisma.$queryRaw<SpeedRow[]>`
      ${speedCte(win, property)}
      SELECT metric, id, secs FROM d ORDER BY secs DESC
    `,

    prisma.$queryRaw<SpeedStatRow[]>`
      ${speedCte(win, property)}
      SELECT metric,
             percentile_cont(0.5) WITHIN GROUP (ORDER BY secs)::float8 AS median,
             percentile_cont(0.9) WITHIN GROUP (ORDER BY secs)::float8 AS p90,
             COUNT(*)::int AS n
      FROM d GROUP BY metric
    `,

    // APPROVED only — PAYING money lives in the กำลังโอน tile and must never
    // be counted twice.
    prisma.$queryRaw<OwedRow[]>`
      SELECT b."id",
             b."userId" AS user_id,
             u."name" AS name,
             u."initials" AS initials,
             to_char(b."approvedAt", ${ISO_FMT}) AS approved_at,
             SUM(r."amount")::float8 AS amount
      FROM bundles b
      JOIN receipts r ON r."bundleId" = b."id"
      JOIN users u ON u."id" = b."userId"
      WHERE b."status" = 'APPROVED'
        ${propFilter}
      GROUP BY b."id", b."userId", u."name", u."initials", b."approvedAt"
    `,

    // audit_events is the only source that carries the ACTOR, which every
    // activity row has to name — bundle timestamps cannot say who acted.
    // Withdraw rows survive their bundle's deletion and are kept whatever the
    // property chip says: there are no receipts left to attribute them with.
    prisma.$queryRaw<ActivityRow[]>`
      SELECT ae."type" AS event,
             ae."bundleId" AS bundle_id,
             to_char(ae."createdAt", ${ISO_FMT}) AS at,
             to_char(ae."createdAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok', ${BKK_MINUTE_FMT}) AS at_bkk,
             u."name" AS actor_name,
             u."initials" AS actor_initials,
             COALESCE(b."name", ae."metadata"->>'name', '') AS name,
             COALESCE((
               SELECT SUM(r."amount") FROM receipts r
               WHERE r."bundleId" = ae."bundleId" ${propFilter}
             ), 0)::float8 AS amount,
             ae."metadata"->>'amount' AS meta_amount
      FROM audit_events ae
      JOIN users u ON u."id" = ae."actorId"
      LEFT JOIN bundles b ON b."id" = ae."bundleId"
      WHERE ae."type" IN (${Prisma.join([...ACTIVITY_EVENTS])})
        ${
          property === 'all'
            ? Prisma.empty
            : Prisma.sql`AND (ae."bundleId" IS NULL OR EXISTS (
                 SELECT 1 FROM receipts r
                 WHERE r."bundleId" = ae."bundleId" AND r."property" = ${property}
               ))`
        }
      ORDER BY ae."createdAt" DESC
      LIMIT ${ACTIVITY_CAP}
    `,
    ],
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );

  // ── ladder ─────────────────────────────────────────────────────────────
  const paid = paidRows.map((row) => ({
    id: row.id,
    name: row.name,
    userId: row.user_id,
    submitterName: row.submitter_name,
    submitterInitials: row.submitter_initials,
    at: Date.parse(row.paid_at),
    day: row.paid_day,
    amount: Number(row.amount),
    receiptCount: int(row.receipt_count),
  }));

  const inRange = (from: Boundary, to: Boundary) =>
    paid.filter((row) => row.at >= from.ms && row.at <= to.ms);

  const rangeOf = (bounded: WindowBounds): OverviewWindowRange => ({
    key: bounded.key,
    start: bounded.start.iso,
    end: bounded.end.iso,
    label: windowLabel(bounded.key),
    caption: windowCaption(bounded.key, bounded.start.bkk, bounded.end.bkk),
  });

  const ladderEntry = (bounded: WindowBounds): OverviewLadderEntry => {
    const current = inRange(bounded.start, bounded.end);
    const previous = inRange(bounded.prev.start, bounded.prev.end);
    const prevLabel = prevWindowLabel(bounded.key);
    const prevCaption = prevWindowCaption(
      bounded.key,
      bounded.prev.start.bkk,
      bounded.prev.end.bkk,
    );
    const currentSlice = sliceOf(current);
    return {
      ...currentSlice,
      key: bounded.key,
      label: windowLabel(bounded.key),
      caption: windowCaption(bounded.key, bounded.start.bkk, bounded.end.bkk),
      prev: { ...sliceOf(previous), label: prevLabel, caption: prevCaption },
      delta: buildDelta(
        currentSlice.total,
        money(previous.reduce((sum, row) => sum + row.amount, 0)),
        prevLabel,
        prevCaption,
      ),
    };
  };

  const ladder: OverviewLadder = {
    day: ladderEntry(bounds.day),
    week: ladderEntry(bounds.week),
    month: ladderEntry(bounds.month),
  };

  // ── the window's cash-out headline ─────────────────────────────────────
  const windowPaid = inRange(win.start, win.end);
  const paidSlice = sliceOf(windowPaid);
  const paidHeadline: OverviewPaid = {
    ...paidSlice,
    receiptCount: windowPaid.reduce((sum, row) => sum + row.receiptCount, 0),
    avgPerBundle: paidSlice.count > 0 ? money(paidSlice.total / paidSlice.count) : 0,
  };

  // ── series ─────────────────────────────────────────────────────────────
  const todayKey = dayKey(bounds.day.start.bkk);
  const byAmountDesc = [...windowPaid].sort((a, b) => b.amount - a.amount);

  const dayBucketPoint = (date: BkkDate, label: string): OverviewSeriesPoint => {
    const key = dayKey(date);
    const rows = byAmountDesc.filter((row) => row.day === key);
    return {
      ...capIds(rows.map((row) => row.id)),
      key,
      label,
      fullLabel: dayCaption(date),
      total: money(rows.reduce((sum, row) => sum + row.amount, 0)),
      count: rows.length,
      isToday: key === todayKey,
      isFuture: key > todayKey,
    };
  };

  let series: OverviewSeries;
  if (params.window === 'day') {
    series = {
      granularity: 'payment',
      points: byAmountDesc.map((row) => ({
        ids: [row.id],
        overflow: 0,
        key: row.id,
        label: row.name,
        fullLabel: row.submitterName,
        total: money(row.amount),
        count: 1,
        isToday: false,
        isFuture: false,
      })),
    };
  } else if (params.window === 'week') {
    const start = win.start.bkk;
    series = {
      granularity: 'day',
      points: Array.from({ length: 7 }, (_, offset) => {
        const date = addDays(start, offset);
        return dayBucketPoint(date, ['จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส', 'อา'][offset]);
      }),
    };
  } else {
    const start = win.start.bkk;
    const total = daysInMonth(start.y, start.m);
    series = {
      granularity: 'day',
      points: Array.from({ length: total }, (_, offset) => {
        const date = addDays(start, offset);
        return dayBucketPoint(date, String(date.d));
      }),
    };
  }

  let seriesWeekly: OverviewSeries | undefined;
  if (params.window === 'month') {
    const start = win.start.bkk;
    const last = daysInMonth(start.y, start.m);
    const spans: Array<[number, number]> = [
      [1, 7],
      [8, 14],
      [15, 21],
      [22, 28],
      [29, last],
    ].filter(([from]) => from <= last) as Array<[number, number]>;
    const todayDom = bounds.day.start.bkk.d;
    seriesWeekly = {
      granularity: 'week',
      points: spans.map(([from, to], index) => {
        const rows = byAmountDesc.filter((row) => {
          const dom = Number(row.day.slice(8));
          return dom >= from && dom <= to;
        });
        return {
          ...capIds(rows.map((row) => row.id)),
          key: `w${index + 1}`,
          label: `${from}–${to}`,
          fullLabel: weeklyBucketCaption(from, to, start.m),
          total: money(rows.reduce((sum, row) => sum + row.amount, 0)),
          count: rows.length,
          isToday: todayDom >= from && todayDom <= to,
          isFuture: from > todayDom,
        };
      }),
    };
  }

  // ── breakdowns ─────────────────────────────────────────────────────────
  const windowTotal = paidSlice.total;

  const categoryEntries: GroupEntry[] = breakdownRows.map((row) => ({
    key: row.category,
    label: row.category,
    bundleId: row.bundle_id,
    amount: Number(row.amount),
    receiptCount: int(row.receipt_count),
  }));

  const vendorEntries: GroupEntry[] = breakdownRows.map((row) => ({
    key: row.vendor_key,
    label: (row.vendor_label ?? '').trim() || 'ไม่ระบุร้านค้า',
    bundleId: row.bundle_id,
    amount: Number(row.amount),
    receiptCount: int(row.receipt_count),
  }));

  const propertyEntries: GroupEntry[] = breakdownRows.map((row) => ({
    key: row.property,
    label: PROPERTY_LABELS[row.property as Property] ?? row.property,
    bundleId: row.bundle_id,
    amount: Number(row.amount),
    receiptCount: int(row.receipt_count),
  }));

  // Property-SLICED like the other three dimensions, so all four keep adding
  // back to the same `windowTotal`. Under `?property=all` a submitter's slice
  // is the whole bundle and the drill shows no `จาก ฿X ทั้งคำขอ`; under a chip
  // it is a real slice and the drill has to say so, same as ตามหมวดหมู่.
  const submitterEntries: GroupEntry[] = windowPaid.map((row) => ({
    key: row.userId,
    label: row.submitterName,
    bundleId: row.id,
    amount: row.amount,
    receiptCount: row.receiptCount,
    initials: row.submitterInitials,
  }));

  // Each pair carries its own ids and slices: intersecting byCategory with
  // byProperty on the client would hand a mixed bundle's WHOLE category spend
  // to one branch, which is exactly the overstatement `sliceById` exists to
  // stop.
  const topCategoriesByProperty = new Map<string, OverviewPropertyCategory[]>();
  for (const propertyKey of Object.keys(PROPERTY_LABELS)) {
    const perCategory = new Map<string, Array<{ id: string; amount: number }>>();
    for (const row of breakdownRows) {
      if (row.property !== propertyKey) continue;
      const bucket = perCategory.get(row.category) ?? [];
      bucket.push({ id: row.bundle_id, amount: Number(row.amount) });
      perCategory.set(row.category, bucket);
    }
    topCategoriesByProperty.set(
      propertyKey,
      [...perCategory.entries()]
        .map(([key, rows]) => {
          const perBundle = new Map<string, number>();
          for (const row of rows) perBundle.set(row.id, (perBundle.get(row.id) ?? 0) + row.amount);
          const ordered = [...perBundle.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
          const idSet = capIds(ordered);
          return {
            ...idSet,
            key,
            label: key,
            amount: money(rows.reduce((sum, row) => sum + row.amount, 0)),
            count: perBundle.size,
            sliceById: sliceById(rows, idSet.ids),
          };
        })
        .sort((a, b) => b.amount - a.amount || a.label.localeCompare(b.label, 'th'))
        .slice(0, TOP_CATEGORY_CAP),
    );
  }

  const byCategory = buildBreakdown(categoryEntries, windowTotal, 'หมวด');
  const byVendor = buildBreakdown(vendorEntries, windowTotal, 'ร้าน');
  const bySubmitter = buildBreakdown(submitterEntries, windowTotal, 'คน');
  const byProperty = buildBreakdown(propertyEntries, windowTotal, 'สาขา', {
    seed: (Object.keys(PROPERTY_LABELS) as Property[]).map((key) => ({
      key,
      label: PROPERTY_LABELS[key],
    })),
    topCategoriesByKey: topCategoriesByProperty,
  });

  // ── queue + alerts ─────────────────────────────────────────────────────
  const queueParsed = queueRows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedMs: parseMs(row.submitted_at),
    approvedMs: parseMs(row.approved_at),
    payingSinceMs: parseMs(row.paying_since),
    paymentError: row.payment_error,
    amount: Number(row.amount),
  }));

  const pendingRows = queueParsed.filter((row) => row.status === 'PENDING');
  const approvedRows = queueParsed.filter((row) => row.status === 'APPROVED');
  const payingRows = queueParsed.filter((row) => row.status === 'PAYING');

  const ageOf = (row: (typeof queueParsed)[number]) => wholeDaysSince(row.submittedMs, nowMs);
  const BAND_SPECS: Array<{ key: OverviewAgeBand['key']; label: string; test: (d: number) => boolean }> =
    [
      { key: 'b1', label: '≤1 วัน', test: (d) => d <= 1 },
      { key: 'b2', label: '2–3 วัน', test: (d) => d >= 2 && d <= 3 },
      { key: 'b3', label: '4–6 วัน', test: (d) => d >= 4 && d <= 6 },
      { key: 'b4', label: '7 วันขึ้นไป', test: (d) => d >= 7 },
    ];

  const pendingByAge = [...pendingRows].sort(
    (a, b) => (a.submittedMs ?? 0) - (b.submittedMs ?? 0),
  );
  const ageBands: OverviewAgeBand[] = BAND_SPECS.map((spec) => {
    const rows = pendingByAge.filter((row) => spec.test(ageOf(row)));
    return { ...sliceOf(rows), key: spec.key, label: spec.label };
  });

  const stuckRows = payingRows.filter(
    (row) =>
      row.paymentError === null &&
      row.payingSinceMs !== null &&
      nowMs - row.payingSinceMs >= PAYMENT_STUCK_MS,
  );
  const stuckSet = new Set(stuckRows.map((row) => row.id));
  const fastRows = payingRows.filter((row) => !stuckSet.has(row.id));
  const oldestStuckMs = stuckRows.reduce(
    (oldest, row) => Math.min(oldest, row.payingSinceMs ?? nowMs),
    nowMs,
  );

  const queue: OverviewQueue = {
    pending: {
      ...sliceOf(pendingByAge),
      oldestDays: pendingByAge.length > 0 ? ageOf(pendingByAge[0]) : 0,
      ageBands,
    },
    approved: sliceOf([...approvedRows].sort((a, b) => (a.approvedMs ?? 0) - (b.approvedMs ?? 0))),
    paying: {
      ...sliceOf(payingRows),
      stuck: {
        ...sliceOf(stuckRows),
        oldestMinutes:
          stuckRows.length > 0 ? Math.floor((nowMs - oldestStuckMs) / 60_000) : 0,
      },
      fast: sliceOf(fastRows),
    },
    orphanReceipts: buildOrphanReceipts(orphanGroupRows, orphanReceiptRows, nowMs),
  };

  const alerts: OverviewAlert[] = [];
  for (const row of payingRows.filter((r) => r.paymentError !== null)) {
    alerts.push({
      kind: 'payment-manual-check',
      severity: 'danger',
      label: 'ต้องตรวจสอบด้วยตัวเอง',
      bundleIds: [row.id],
      count: 1,
      total: money(row.amount),
      minutes: null,
      note: row.paymentError,
    });
  }
  for (const row of stuckRows) {
    alerts.push({
      kind: 'payment-stuck',
      severity: 'danger',
      label: 'โอนค้างที่ธนาคาร',
      bundleIds: [row.id],
      count: 1,
      total: money(row.amount),
      minutes: Math.floor((nowMs - (row.payingSinceMs ?? nowMs)) / 60_000),
      note: null,
    });
  }
  for (const row of approvedRows.filter((r) => r.paymentError !== null)) {
    alerts.push({
      kind: 'payment-failed',
      severity: 'warn',
      label: 'โอนไม่สำเร็จ ต้องลองใหม่',
      bundleIds: [row.id],
      count: 1,
      total: money(row.amount),
      minutes: null,
      note: row.paymentError,
    });
  }
  const overdue = ageBands[3];
  if (overdue.count > 0) {
    alerts.push({
      kind: 'pending-overdue',
      severity: 'warn',
      label: 'รอนาน 7 วันขึ้นไป',
      bundleIds: [...overdue.ids],
      count: overdue.count,
      total: overdue.total,
      minutes: null,
      note: null,
    });
  }

  // ── flow + decisions ───────────────────────────────────────────────────
  const flowParsed = flowRows.map((row) => ({
    id: row.id,
    status: row.status,
    submittedMs: parseMs(row.submitted_at),
    approvedMs: parseMs(row.approved_at),
    paidMs: parseMs(row.paid_at),
    amount: Number(row.amount),
  }));

  const within = (ms: number | null) => ms !== null && ms >= win.start.ms && ms <= win.end.ms;
  const flowBucket = (
    predicate: (row: (typeof flowParsed)[number]) => boolean,
    stamp: (row: (typeof flowParsed)[number]) => number | null,
  ): OverviewSlice =>
    sliceOf(
      flowParsed
        .filter(predicate)
        .sort((a, b) => (stamp(b) ?? 0) - (stamp(a) ?? 0))
        .map((row) => ({ id: row.id, amount: row.amount })),
    );

  // Two rejections of one bundle inside a window are one rejected bundle.
  const rejectionsById = new Map<string, RejectionRow>();
  for (const row of rejectionRows) {
    if (!rejectionsById.has(row.id)) rejectionsById.set(row.id, row);
  }
  const rejections = [...rejectionsById.values()];
  const rejectedSlice = sliceOf(
    rejections.map((row) => ({ id: row.id, amount: Number(row.amount) })),
  );

  const flow: OverviewFlow = {
    submitted: flowBucket((row) => within(row.submittedMs), (row) => row.submittedMs),
    approved: flowBucket((row) => within(row.approvedMs), (row) => row.approvedMs),
    paid: flowBucket(
      (row) => row.status === 'PAID' && within(row.paidMs),
      (row) => row.paidMs,
    ),
    rejected: rejectedSlice,
  };

  const reasonGroups = new Map<string, Array<{ id: string; amount: number }>>();
  for (const row of rejections) {
    const text = (row.reject_reason ?? '').trim();
    if (text.length === 0) continue;
    const bucket = reasonGroups.get(text) ?? [];
    bucket.push({ id: row.id, amount: Number(row.amount) });
    reasonGroups.set(text, bucket);
  }

  const decisionsN = flow.approved.count + rejectedSlice.count;
  const coverageMs = parseMs(bounds.auditCoverageFrom);
  const decisions: OverviewDecisions = {
    approved: flow.approved,
    rejected: rejectedSlice,
    n: decisionsN,
    lowSample: decisionsN < LOW_SAMPLE_THRESHOLD,
    // A branch chip scopes approvals but cannot scope rejections — rejecting
    // detaches the receipts that carry the property — so a ratio here would
    // divide an org-wide numerator by a branch-scoped denominator. The card
    // prints `—` rather than a number built from two populations.
    rate: property !== 'all' ? null : decisionsN > 0 ? rejectedSlice.count / decisionsN : 0,
    auditCovered: coverageMs !== null && win.start.ms >= coverageMs,
    reasons: [...reasonGroups.entries()]
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], 'th'))
      .slice(0, REASON_CAP)
      .map(([text, rows]) => ({ ...capIds(rows.map((row) => row.id)), text, count: rows.length })),
  };

  // ── speed ──────────────────────────────────────────────────────────────
  const speed: OverviewSpeed = {
    approval: buildSpeedMetric('approval', speedRows, speedStatRows),
    payout: buildSpeedMetric('payout', speedRows, speedStatRows),
    bank: buildSpeedMetric('bank', speedRows, speedStatRows),
  };

  // ── owed ───────────────────────────────────────────────────────────────
  const owedByUser = new Map<string, OwedRow[]>();
  for (const row of owedRows) {
    const bucket = owedByUser.get(row.user_id) ?? [];
    bucket.push(row);
    owedByUser.set(row.user_id, bucket);
  }
  const owed: OverviewOwed[] = [...owedByUser.values()]
    .map((rows) => {
      const sorted = [...rows].sort(
        (a, b) => (parseMs(a.approved_at) ?? 0) - (parseMs(b.approved_at) ?? 0),
      );
      const oldestMs = sorted
        .map((row) => parseMs(row.approved_at))
        .filter((ms): ms is number => ms !== null)
        .reduce<number | null>((oldest, ms) => (oldest === null ? ms : Math.min(oldest, ms)), null);
      return {
        ...capIds(sorted.map((row) => row.id)),
        userId: sorted[0].user_id,
        name: sorted[0].name,
        initials: sorted[0].initials,
        total: money(sorted.reduce((sum, row) => sum + Number(row.amount), 0)),
        oldestDays: wholeDaysSince(oldestMs, nowMs),
      };
    })
    .sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total);

  // ── activity ───────────────────────────────────────────────────────────
  const activity: OverviewActivityRow[] = activityRows.map((row) => {
    const event = row.event as OverviewActivityEvent;
    const metaAmount = Number(row.meta_amount);
    const amount =
      row.bundle_id === null && Number.isFinite(metaAmount)
        ? money(metaAmount)
        : money(row.amount);
    return {
      bundleId: row.bundle_id,
      event,
      at: row.at,
      label: activityLabel(event, parseBkkText(row.at_bkk)),
      actorName: row.actor_name,
      actorInitials: row.actor_initials,
      amount,
      name: row.name,
    };
  });

  // ── dictionary invariant ───────────────────────────────────────────────
  const protectedIds = new Set<string>();
  for (const alert of alerts) for (const id of alert.bundleIds) protectedIds.add(id);
  for (const row of activity) if (row.bundleId) protectedIds.add(row.bundleId);

  const breakdowns = [byProperty, bySubmitter, byVendor, byCategory];
  const trimTargets: TrimTarget[] = [];
  // The branch mini lists rank below everything else — a secondary read inside
  // one drill — so their ids are the first to be given up.
  for (const row of byProperty.rows) {
    for (const category of [...(row.topCategories ?? [])].reverse()) {
      trimTargets.push(target(category, category.sliceById));
    }
  }
  for (const breakdown of breakdowns) {
    if (breakdown.tail) trimTargets.push(target(breakdown.tail, breakdown.tail.sliceById));
  }
  for (const breakdown of breakdowns) {
    for (const row of [...breakdown.rows].reverse()) trimTargets.push(target(row, row.sliceById));
  }
  for (const point of [...(seriesWeekly?.points ?? [])].reverse()) trimTargets.push(target(point));
  for (const point of [...series.points].reverse()) trimTargets.push(target(point));
  for (const metric of [speed.bank, speed.payout, speed.approval]) {
    for (const bucket of [...metric.buckets].reverse()) trimTargets.push(target(bucket));
    trimTargets.push(target(metric, metric.durationById));
  }
  for (const reason of decisions.reasons) trimTargets.push(target(reason));
  for (const slice of [flow.rejected, flow.submitted, flow.approved, flow.paid]) {
    trimTargets.push(target(slice));
  }
  for (const key of ['day', 'week', 'month'] as const) trimTargets.push(target(ladder[key].prev));
  for (const key of ['day', 'week', 'month'] as const) trimTargets.push(target(ladder[key]));
  for (const person of owed) trimTargets.push(target(person));
  for (const band of queue.pending.ageBands) trimTargets.push(target(band));
  trimTargets.push(target(queue.pending));
  trimTargets.push(target(queue.approved));
  trimTargets.push(target(queue.paying.fast));
  trimTargets.push(target(queue.paying.stuck));
  trimTargets.push(target(queue.paying));
  trimTargets.push(target(paidHeadline));

  const { ids: dictIds, truncated } = enforceDictCap(trimTargets, protectedIds);
  const bundles = await loadBundleDictionary(dictIds, nowMs);

  return {
    meta: {
      now: bounds.now.iso,
      tz: 'Asia/Bangkok',
      weekStartsOn: 'monday',
      window: rangeOf(win),
      prev: {
        key: win.key,
        start: win.prev.start.iso,
        end: win.prev.end.iso,
        label: prevWindowLabel(win.key),
        caption: prevWindowCaption(win.key, win.prev.start.bkk, win.prev.end.bkk),
        elapsedSec: win.prev.elapsedSec,
      },
      auditCoverageFrom: bounds.auditCoverageFrom,
      lowSampleThreshold: LOW_SAMPLE_THRESHOLD,
      idCap: ID_CAP,
      truncated,
      generatedAt: new Date().toISOString(),
    },
    ladder,
    queue,
    alerts,
    paid: paidHeadline,
    series,
    ...(seriesWeekly ? { seriesWeekly } : {}),
    byCategory,
    byVendor,
    bySubmitter,
    byProperty,
    flow,
    speed,
    decisions,
    owed,
    activity,
    bundles,
  };
}

/**
 * The three duration metrics as one CTE, reused verbatim by the percentile pass
 * and the per-bundle pass so the two can never disagree about the population.
 *
 * NULL timestamps are EXCLUDED from the denominator, never zeroed: a null read
 * as zero makes a growing backlog look like improving speed.
 */
function speedCte(win: WindowBounds, property: OverviewPropertyKey): Prisma.Sql {
  const scope =
    property === 'all'
      ? Prisma.empty
      : Prisma.sql`AND EXISTS (
           SELECT 1 FROM receipts r WHERE r."bundleId" = b."id" AND r."property" = ${property}
         )`;
  const start = win.start.sql;
  const end = win.end.sql;
  return Prisma.sql`
    WITH d AS (
      SELECT 'approval'::text AS metric, b."id" AS id,
             EXTRACT(EPOCH FROM (b."approvedAt" - b."submittedAt"))::float8 AS secs
      FROM bundles b
      WHERE b."approvedAt" IS NOT NULL AND b."submittedAt" IS NOT NULL
        AND b."approvedAt" >= ${start}::timestamp AND b."approvedAt" <= ${end}::timestamp
        ${scope}
      UNION ALL
      SELECT 'payout'::text, b."id",
             EXTRACT(EPOCH FROM (b."paidAt" - b."approvedAt"))::float8
      FROM bundles b
      WHERE b."status" = 'PAID' AND b."paidAt" IS NOT NULL AND b."approvedAt" IS NOT NULL
        AND b."paidAt" >= ${start}::timestamp AND b."paidAt" <= ${end}::timestamp
        ${scope}
      UNION ALL
      SELECT 'bank'::text, b."id",
             EXTRACT(EPOCH FROM (b."paidAt" - b."payingSince"))::float8
      FROM bundles b
      WHERE b."status" = 'PAID' AND b."paidAt" IS NOT NULL AND b."payingSince" IS NOT NULL
        AND b."paidAt" >= ${start}::timestamp AND b."paidAt" <= ${end}::timestamp
        ${scope}
    )
  `;
}

const SPEED_BUCKETS: Array<{
  key: OverviewSpeedBucket['key'];
  label: string;
  test: (secs: number) => boolean;
}> = [
  { key: 'q1', label: 'ใน 4 ชม.', test: (s) => s < 4 * 3600 },
  { key: 'q2', label: 'ใน 1 วัน', test: (s) => s >= 4 * 3600 && s < 86_400 },
  { key: 'q3', label: '1–3 วัน', test: (s) => s >= 86_400 && s < 3 * 86_400 },
  { key: 'q4', label: 'เกิน 3 วัน', test: (s) => s >= 3 * 86_400 },
];

function buildSpeedMetric(
  metric: string,
  rows: SpeedRow[],
  stats: SpeedStatRow[],
): OverviewSpeedMetric {
  const mine = rows
    .filter((row) => row.metric === metric)
    .map((row) => ({ id: row.id, secs: Math.round(Number(row.secs)) }))
    .sort((a, b) => b.secs - a.secs);
  const stat = stats.find((row) => row.metric === metric);
  const n = stat ? int(stat.n) : 0;
  const lowSample = n < LOW_SAMPLE_THRESHOLD;
  const idSet = capIds(mine.map((row) => row.id));

  const durationById: Record<string, number> = {};
  for (const row of mine) {
    if (idSet.ids.includes(row.id)) durationById[row.id] = row.secs;
  }

  return {
    ...idSet,
    medianSec: lowSample || stat?.median === null || stat?.median === undefined
      ? null
      : Math.round(Number(stat.median)),
    p90Sec: lowSample || stat?.p90 === null || stat?.p90 === undefined
      ? null
      : Math.round(Number(stat.p90)),
    n,
    lowSample,
    buckets: SPEED_BUCKETS.map((spec) => {
      const bucketRows = mine.filter((row) => spec.test(row.secs));
      return {
        ...capIds(bucketRows.map((row) => row.id)),
        key: spec.key,
        label: spec.label,
        count: bucketRows.length,
      };
    }),
    durationById,
  };
}

function buildOrphanReceipts(
  groupRows: OrphanGroupRow[],
  receiptRows: OrphanReceiptRow[],
  nowMs: number,
): OverviewQueue['orphanReceipts'] {
  // Round-robin across employees rather than a global oldest-first cut. A flat
  // slice hands the whole row budget to whoever has the biggest pile, and every
  // group sorting after it then promises `12 ใบเสร็จ` that expand to nothing —
  // the receipt-level twin of a dangling bundle id. Here `receiptIds` is built
  // from what actually shipped, so a promised id and a drawn row cannot differ.
  const queues = new Map<string, OrphanReceiptRow[]>();
  for (const row of receiptRows) {
    const bucket = queues.get(row.user_id) ?? [];
    bucket.push(row);
    queues.set(row.user_id, bucket);
  }

  const picked: OrphanReceiptRow[] = [];
  const owners = [...queues.keys()];
  for (let round = 0; picked.length < ORPHAN_ROW_CAP; round += 1) {
    let placed = false;
    for (const userId of owners) {
      const bucket = queues.get(userId) as OrphanReceiptRow[];
      if (round >= bucket.length) continue;
      picked.push(bucket[round]);
      placed = true;
      if (picked.length >= ORPHAN_ROW_CAP) break;
    }
    if (!placed) break;
  }
  picked.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id));

  const idsByUser = new Map<string, string[]>();
  for (const row of picked) {
    const bucket = idsByUser.get(row.user_id) ?? [];
    bucket.push(row.id);
    idsByUser.set(row.user_id, bucket);
  }

  const byUser: OverviewOrphanGroup[] = groupRows
    .map((row) => {
      const count = int(row.count);
      const receiptIds = idsByUser.get(row.user_id) ?? [];
      return {
        userId: row.user_id,
        name: row.name,
        initials: row.initials,
        count,
        total: money(row.total),
        oldestDays: wholeDaysSince(parseMs(row.oldest), nowMs),
        receiptIds,
        overflow: Math.max(0, count - receiptIds.length),
      };
    })
    .sort((a, b) => b.oldestDays - a.oldestDays || b.total - a.total);

  const receipts: OverviewOrphanReceipt[] = picked.map((row) => ({
    id: row.id,
    userId: row.user_id,
    merchant: row.merchant,
    category: row.category,
    amount: money(row.amount),
    date: row.date,
  }));

  return {
    count: byUser.reduce((sum, group) => sum + group.count, 0),
    total: money(byUser.reduce((sum, group) => sum + group.total, 0)),
    oldestDays: byUser.reduce((oldest, group) => Math.max(oldest, group.oldestDays), 0),
    byUser,
    receipts,
  };
}

/**
 * The deduped dictionary — the LAST query, run over the id union that survived
 * trimming, so no id can ever ship without an entry here.
 */
async function loadBundleDictionary(
  ids: string[],
  nowMs: number,
): Promise<Record<string, OverviewBundleRef>> {
  if (ids.length === 0) return {};

  const rows = await prisma.$queryRaw<DictRow[]>`
    SELECT b."id",
           b."name",
           b."status"::text AS status,
           u."name" AS submitter_name,
           u."initials" AS submitter_initials,
           COALESCE(SUM(r."amount"), 0)::float8 AS amount,
           COUNT(r."id")::int AS receipt_count,
           COUNT(DISTINCT r."property")::int AS property_count,
           MIN(r."property") AS property_min,
           to_char(b."submittedAt", ${ISO_FMT}) AS submitted_at,
           to_char(b."approvedAt", ${ISO_FMT}) AS approved_at,
           to_char(b."paidAt", ${ISO_FMT}) AS paid_at,
           to_char(b."payingSince", ${ISO_FMT}) AS paying_since,
           to_char((
             SELECT MAX(ae."createdAt") FROM audit_events ae
             WHERE ae."bundleId" = b."id" AND ae."type" = 'reject'
           ), ${ISO_FMT}) AS rejected_at,
           b."transferRef" AS transfer_ref,
           b."rejectReason" AS reject_reason,
           b."paymentError" AS payment_error
    FROM bundles b
    JOIN users u ON u."id" = b."userId"
    LEFT JOIN receipts r ON r."bundleId" = b."id"
    WHERE b."id" IN (${Prisma.join(ids)})
    GROUP BY b."id", b."name", b."status", u."name", u."initials",
             b."submittedAt", b."approvedAt", b."paidAt", b."payingSince",
             b."transferRef", b."rejectReason", b."paymentError"
  `;

  const dictionary: Record<string, OverviewBundleRef> = {};
  for (const row of rows) {
    const propertyCount = int(row.property_count);
    dictionary[row.id] = {
      id: row.id,
      name: row.name,
      submitterName: row.submitter_name,
      submitterInitials: row.submitter_initials,
      amount: money(row.amount),
      status: STATUS_TO_SHARED[row.status] ?? 'pending',
      property:
        propertyCount > 1 ? 'mixed' : ((row.property_min as Property | null) ?? 'hf-hotel'),
      receiptCount: int(row.receipt_count),
      submittedAt: row.submitted_at ?? new Date(nowMs).toISOString(),
      approvedAt: row.approved_at,
      paidAt: row.paid_at,
      payingSince: row.paying_since,
      rejectedAt: row.rejected_at,
      transferRef: row.transfer_ref,
      rejectReason: row.reject_reason,
      paymentError: row.payment_error,
      ageDays: wholeDaysSince(parseMs(row.submitted_at), nowMs),
    };
  }
  return dictionary;
}
