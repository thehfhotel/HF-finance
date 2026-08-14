import type {
  OverviewBreakdown,
  OverviewBundleRef,
  OverviewGroup,
  OverviewSeries,
  OverviewStats,
} from '../../../lib/api';
import { PROPERTY_LABELS } from '../../../lib/types';
import type {
  BreakdownDim,
  DrillOwner,
  DrillRow,
  DrillSelection,
  OverviewViewState,
  ResolvedDrill,
} from './types';
import { baht, daysSince, ms, thaiDate, thaiDuration, thaiTime } from './format';

/**
 * The one place a selection becomes a panel.
 *
 * Pure: payload in, panel description out. Every path string, empty-state
 * sentence, default sort and nested chip set lives here rather than smeared
 * across ten card components, so two routes into the same number can never
 * word it differently.
 *
 * Nothing here aggregates. Totals and counts are the server's; the rows are
 * hydrated from `stats.bundles`, which by contract holds an entry for every id
 * that appears anywhere in the payload.
 */

const DIM_NAMES: Record<BreakdownDim, string> = {
  cat: 'ตามหมวดหมู่',
  mer: 'ตามร้านค้า',
  sub: 'ตามผู้เบิก',
  prop: 'ตามสาขา',
};

const TAIL_NOUNS: Record<BreakdownDim, string> = {
  cat: 'หมวด',
  mer: 'ร้าน',
  sub: 'คน',
  prop: 'สาขา',
};

/** On the phone หมวดหมู่ and ร้านค้า share one card, so they share one slot. */
const BREAK_OWNERS: Record<BreakdownDim, DrillOwner> = {
  cat: 'break-cat',
  mer: 'break-mer',
  sub: 'break-sub',
  prop: 'break-prop',
};

const FLOW_LABELS = {
  submitted: 'ส่งเข้ามาใหม่',
  approved: 'อนุมัติแล้ว',
  paid: 'จ่ายออก',
  rejected: 'ปฏิเสธ',
} as const;

const SPEED_LABELS = {
  approval: 'รอเราอนุมัติ',
  payout: 'อนุมัติแล้วรอจ่าย',
  bank: 'โอนผ่านธนาคาร',
} as const;

/** How many rows each breakdown card shows before the tail. */
export const BREAKDOWN_LIMITS = {
  cat: { phone: 5, desktop: 6 },
  mer: { phone: 5, desktop: 6 },
  sub: { phone: 5, desktop: 5 },
  prop: { phone: 2, desktop: 2 },
} as const;

export function breakdownLimit(dim: BreakdownDim, phone: boolean): number {
  return phone ? BREAKDOWN_LIMITS[dim].phone : BREAKDOWN_LIMITS[dim].desktop;
}

export function breakdownFor(stats: OverviewStats, dim: BreakdownDim): OverviewBreakdown {
  if (dim === 'cat') return stats.byCategory;
  if (dim === 'mer') return stats.byVendor;
  if (dim === 'sub') return stats.bySubmitter;
  return stats.byProperty;
}

export interface FoldedTail {
  label: string;
  amount: number;
  count: number;
  ids: string[];
  overflow: number;
  sliceById: Record<string, number>;
}

export interface FoldedBreakdown {
  rows: OverviewGroup[];
  tail: FoldedTail | null;
  /** `covered` is the sum of every row the card draws, tail included, so the
   *  coverage line matches the bars above it exactly. `windowTotal` stays the
   *  server's, and the two agreeing IS the one-denominator proof. */
  coverage: { covered: number; windowTotal: number };
}

/**
 * The server ranks six rows; the phone draws five. The sixth is folded into
 * the tail rather than dropped, because the coverage line has to keep adding
 * up to the same denominator on both platforms.
 */
export function foldBreakdown(
  breakdown: OverviewBreakdown,
  dim: BreakdownDim,
  limit: number,
): FoldedBreakdown {
  const rows = breakdown.rows.slice(0, limit);
  const folded = breakdown.rows.slice(limit);
  const serverTail = breakdown.tail;

  let tail: FoldedTail | null = null;
  if (folded.length > 0 || serverTail) {
    const ids: string[] = [];
    const sliceById: Record<string, number> = {};
    const push = (source: { ids: string[]; sliceById: Record<string, number> }) => {
      source.ids.forEach((id) => {
        if (!ids.includes(id)) ids.push(id);
      });
      Object.entries(source.sliceById).forEach(([id, amount]) => {
        sliceById[id] = (sliceById[id] ?? 0) + amount;
      });
    };
    folded.forEach(push);
    if (serverTail) push(serverTail);

    const count = folded.length + (serverTail?.count ?? 0);
    const amount =
      folded.reduce((acc, r) => acc + r.amount, 0) + (serverTail?.amount ?? 0);
    tail = {
      // The server already inflected its own label; a folded row changes the
      // count, so that case composes the noun here instead.
      label: folded.length === 0 && serverTail
        ? serverTail.label
        : `อื่น ๆ อีก ${count} ${TAIL_NOUNS[dim]}`,
      amount,
      count,
      ids,
      overflow: serverTail?.overflow ?? 0,
      sliceById,
    };
  }

  return {
    rows,
    tail,
    coverage: {
      // The tail IS a drawn row, so it counts: leaving it out made the
      // ครอบคลุม line understate the bars directly above it. With it in, the
      // line states the card's whole claim — these rows are the window.
      covered: rows.reduce((acc, r) => acc + r.amount, 0) + (tail?.amount ?? 0),
      windowTotal: breakdown.coverage.windowTotal,
    },
  };
}

/** The chart on screen: the phone buckets เดือนนี้ by week, everyone else by day. */
export function activeSeries(stats: OverviewStats, view: OverviewViewState): OverviewSeries {
  if (view.phone && view.window === 'month' && stats.seriesWeekly) return stats.seriesWeekly;
  return stats.series;
}

export function seriesTitle(series: OverviewSeries): string {
  return series.granularity === 'week' ? 'จ่ายออกรายสัปดาห์' : 'จ่ายออกรายวัน';
}

interface RowOptions {
  slice?: Record<string, number> | null;
  meta?: (b: OverviewBundleRef) => string;
  chip?: (b: OverviewBundleRef) => { text: string; tone: 'neutral' | 'warn' | 'danger' } | null;
  sortDate?: (b: OverviewBundleRef) => number;
  wait?: (b: OverviewBundleRef) => number;
  duration?: (b: OverviewBundleRef) => number | null;
}

const ageTone = (days: number): 'neutral' | 'warn' | 'danger' =>
  days >= 7 ? 'danger' : days >= 3 ? 'warn' : 'neutral';

export function resolveDrill(
  stats: OverviewStats,
  view: OverviewViewState,
  sel: DrillSelection,
): ResolvedDrill {
  const now = stats.meta.now;
  const propTail = view.property === 'all' ? '' : ` · ${PROPERTY_LABELS[view.property]}`;
  const scopeTail = `${stats.meta.window.label}${propTail}`;
  /** The live zones are org-wide by contract, so their paths never name a branch. */
  const liveTail = 'ตอนนี้';

  const rowsFrom = (ids: string[], options: RowOptions = {}): DrillRow[] => {
    const seen = new Set<string>();
    const out: DrillRow[] = [];
    ids.forEach((id) => {
      if (seen.has(id)) return;
      seen.add(id);
      const b = stats.bundles[id];
      if (!b) return;
      const sliced = options.slice ? options.slice[id] : undefined;
      const amount = sliced ?? b.amount;
      let meta = options.meta ? options.meta(b) : `${b.submitterName} · ${thaiDate(b.submittedAt)}`;
      if (sliced != null && sliced < b.amount) meta += ` · จาก ${baht(b.amount)} ทั้งคำขอ`;
      out.push({
        key: b.id,
        bundleId: b.id,
        name: b.name,
        meta,
        initials: b.submitterInitials,
        status: b.status,
        amount,
        durationSec: options.duration ? options.duration(b) : undefined,
        chip: options.chip ? options.chip(b) : null,
        sortDate: options.sortDate
          ? options.sortDate(b)
          : ms(b.paidAt ?? b.approvedAt ?? b.rejectedAt ?? b.submittedAt),
        wait: options.wait ? options.wait(b) : ms(b.submittedAt),
      });
    });
    return out;
  };

  /** Offered only when a wider window actually has something to show. */
  const canJumpToWeek = view.window !== 'week' && stats.ladder.week.count > 0;
  const emptyIn = (message: string) => ({ message, jump: canJumpToWeek });

  const base: ResolvedDrill = {
    owner: 'ladder',
    path: '',
    total: 0,
    count: 0,
    rows: [],
    sortable: true,
    defaultSort: 'recent',
    overflow: 0,
    inboxFilter: 'paid',
  };

  const paidMeta = (b: OverviewBundleRef): string =>
    `${b.submitterName} · ${thaiDate(b.paidAt)} ${thaiTime(b.paidAt)}${b.transferRef ? ` · ${b.transferRef}` : ''}`;

  // ── §3 the ladder, and its like-for-like comparison ──────────────────────
  if (sel.t === 'ladder') {
    const entry = stats.ladder[sel.win];
    return {
      ...base,
      owner: 'ladder',
      path: `เงินจ่ายออกจริง · ${entry.label}${propTail}`,
      total: entry.total,
      count: entry.count,
      overflow: entry.overflow,
      rows: rowsFrom(entry.ids, { meta: paidMeta }),
      empty:
        entry.count === 0
          ? emptyIn(sel.win === 'day' ? 'วันนี้ยังไม่มีการจ่ายออก' : 'ไม่มีคำขอในช่วงนี้')
          : undefined,
    };
  }

  if (sel.t === 'prev') {
    const prev = stats.ladder[view.window].prev;
    return {
      ...base,
      owner: 'ladder',
      path: `เทียบช่วงก่อนหน้า · ${prev.caption}`,
      total: prev.total,
      count: prev.count,
      overflow: prev.overflow,
      rows: rowsFrom(prev.ids, {
        meta: (b) => `${b.submitterName} · ${thaiDate(b.paidAt)} ${thaiTime(b.paidAt)}`,
      }),
      empty: prev.count === 0 ? { message: 'ไม่มีการจ่ายออกในช่วงเทียบ', jump: false } : undefined,
    };
  }

  // ── §2 the live queue — window- and property-immune ──────────────────────
  if (sel.t === 'queue') {
    const queue = stats.queue;

    if (sel.k === 'pending') {
      const band = sel.band ? queue.pending.ageBands.find((x) => x.key === sel.band) : null;
      const source = band ?? queue.pending;
      return {
        ...base,
        owner: 'queue',
        inboxFilter: 'pending',
        path: `รออนุมัติ · ${liveTail}${band ? ` · ${band.label}` : ''}`,
        total: source.total,
        count: source.count,
        overflow: source.overflow,
        defaultSort: 'wait',
        chips: queue.pending.ageBands.map((x) => ({
          key: x.key,
          label: `${x.label} · ${x.count}`,
          on: sel.band === x.key,
          sel: { t: 'queue', k: 'pending', band: sel.band === x.key ? null : x.key },
        })),
        rows: rowsFrom(source.ids, {
          chip: (b) => ({ text: `${b.ageDays} วัน`, tone: ageTone(b.ageDays) }),
          sortDate: (b) => ms(b.submittedAt),
        }),
        empty: source.count === 0 ? { message: 'ไม่มีคำขอรออนุมัติในคิวตอนนี้', jump: false } : undefined,
      };
    }

    if (sel.k === 'approved') {
      return {
        ...base,
        owner: 'queue',
        inboxFilter: 'approved',
        path: `พร้อมจ่าย · ${liveTail}`,
        total: queue.approved.total,
        count: queue.approved.count,
        overflow: queue.approved.overflow,
        defaultSort: 'wait',
        rows: rowsFrom(queue.approved.ids, {
          meta: (b) => `${b.submitterName} · อนุมัติ ${thaiDate(b.approvedAt)}`,
          chip: (b) => (b.paymentError ? { text: 'โอนไม่สำเร็จ', tone: 'danger' } : null),
          wait: (b) => ms(b.approvedAt),
        }),
        empty: queue.approved.count === 0 ? { message: 'ไม่มีคำขอที่รอโอนตอนนี้', jump: false } : undefined,
      };
    }

    if (sel.k === 'paying') {
      const source =
        sel.band === 'stuck' ? queue.paying.stuck : sel.band === 'fast' ? queue.paying.fast : queue.paying;
      const bandLabel = sel.band === 'stuck' ? 'เกิน 10 นาที' : sel.band === 'fast' ? 'ใน 10 นาที' : null;
      return {
        ...base,
        owner: 'queue',
        inboxFilter: 'approved',
        path: `กำลังโอน · ${liveTail}${bandLabel ? ` · ${bandLabel}` : ''}`,
        total: source.total,
        count: source.count,
        overflow: source.overflow,
        defaultSort: 'wait',
        chips: [
          {
            key: 'fast',
            label: `ใน 10 นาที · ${queue.paying.fast.count}`,
            on: sel.band === 'fast',
            sel: { t: 'queue', k: 'paying', band: sel.band === 'fast' ? null : 'fast' },
          },
          {
            key: 'stuck',
            label: `เกิน 10 นาที · ${queue.paying.stuck.count}`,
            on: sel.band === 'stuck',
            sel: { t: 'queue', k: 'paying', band: sel.band === 'stuck' ? null : 'stuck' },
          },
        ],
        rows: rowsFrom(source.ids, {
          meta: (b) => `${b.submitterName} · เริ่มโอน ${thaiTime(b.payingSince)}`,
          chip: (b) => {
            const minutes = Math.round((ms(now) - ms(b.payingSince)) / 60_000);
            return {
              text: thaiDuration((ms(now) - ms(b.payingSince)) / 1000),
              tone: minutes >= 10 ? 'danger' : 'neutral',
            };
          },
          wait: (b) => ms(b.payingSince),
        }),
        empty: source.count === 0 ? { message: 'ไม่มีรายการโอนที่ค้างอยู่ตอนนี้', jump: false } : undefined,
      };
    }

    // ใบเสร็จลอย — receipts, not bundles: nothing here opens a request.
    const orphans = stats.queue.orphanReceipts;
    const byReceiptId = new Map(orphans.receipts.map((r) => [r.id, r]));
    return {
      ...base,
      owner: 'queue',
      inboxFilter: 'pending',
      path: 'ใบเสร็จลอย · ตอนนี้ · ทั้งองค์กร',
      total: orphans.total,
      count: orphans.count,
      countLabel: `${orphans.count} ใบเสร็จ`,
      sortable: false,
      receiptGroups: orphans.byUser.map((group) => ({
        userId: group.userId,
        name: group.name,
        initials: group.initials,
        count: group.count,
        total: group.total,
        oldestDays: group.oldestDays,
        overflow: group.overflow,
        open: sel.who === group.userId,
        // Hydrate from the ids the GROUP promised, not from a scan of the flat
        // list: the two are built from the same shipped set server-side, so a
        // promised receipt and a drawn row can never disagree.
        receipts: group.receiptIds
          .map((id) => byReceiptId.get(id))
          .filter((r): r is (typeof orphans.receipts)[number] => r !== undefined)
          .map((r) => ({
            key: r.id,
            bundleId: null,
            name: r.merchant,
            meta: `${r.category} · ${thaiDate(`${r.date}T00:00:00+07:00`)}`,
            initials: '',
            status: null,
            amount: r.amount,
            note: 'ยังไม่ได้รวมเป็นคำขอ',
            indent: true,
            sortDate: 0,
            wait: 0,
          })),
      })),
      empty: orphans.count === 0 ? { message: 'ไม่มีใบเสร็จลอยตอนนี้', jump: false } : undefined,
    };
  }

  // ── §1 the one alert that opens a group rather than a request ────────────
  if (sel.t === 'alertOverdue') {
    const band = stats.queue.pending.ageBands[3];
    return {
      ...base,
      owner: 'alerts',
      inboxFilter: 'pending',
      path: `รอนาน 7 วันขึ้นไป · ${liveTail}`,
      total: band.total,
      count: band.count,
      overflow: band.overflow,
      defaultSort: 'wait',
      rows: rowsFrom(band.ids, {
        chip: (b) => ({ text: `${b.ageDays} วัน`, tone: 'danger' }),
        sortDate: (b) => ms(b.submittedAt),
      }),
      empty: band.count === 0 ? { message: 'ไม่มีคำขอที่รอนานถึงเกณฑ์', jump: false } : undefined,
    };
  }

  // ── §4 one point of the cash-out chart ───────────────────────────────────
  if (sel.t === 'series') {
    const series = activeSeries(stats, view);
    const point = series.points.find((p) => p.key === sel.key);
    if (!point) return { ...base, owner: 'series', path: seriesTitle(series) };
    const name = series.granularity === 'day' ? point.fullLabel : point.label;
    return {
      ...base,
      owner: 'series',
      path: `${seriesTitle(series)} · ${name}${propTail}`,
      total: point.total,
      count: point.count,
      overflow: point.overflow,
      rows: rowsFrom(point.ids, { meta: paidMeta }),
      // The point names itself: tapping 3 ส.ค. must never answer "วันนี้".
      empty: point.count === 0 ? emptyIn(`ไม่มีการจ่ายออก ${name}`) : undefined,
    };
  }

  // ── §5 where the money went ──────────────────────────────────────────────
  if (sel.t === 'break') {
    const owner: DrillOwner =
      view.phone && (sel.dim === 'cat' || sel.dim === 'mer') ? 'break-catmer' : BREAK_OWNERS[sel.dim];
    const folded = foldBreakdown(
      breakdownFor(stats, sel.dim),
      sel.dim,
      breakdownLimit(sel.dim, view.phone),
    );

    if (sel.tail) {
      const tail = folded.tail;
      return {
        ...base,
        owner,
        path: `อื่น ๆ · ${DIM_NAMES[sel.dim]} · ${scopeTail}`,
        total: tail?.amount ?? 0,
        count: tail?.ids.length ?? 0,
        overflow: tail?.overflow ?? 0,
        rows: rowsFrom(tail?.ids ?? [], { slice: tail?.sliceById ?? null }),
        empty: (tail?.ids.length ?? 0) === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
      };
    }

    const row = folded.rows.find((r) => r.key === sel.key);
    if (!row) return { ...base, owner, path: `${DIM_NAMES[sel.dim]} · ${scopeTail}` };

    // One branch AND one category — the mini list inside a ตามสาขา drill is a
    // control. The pair carries its own ids and slices, so the panel never has
    // to intersect two dimensions and guess at the overlap.
    const pair = sel.cat != null ? (row.topCategories ?? []).find((c) => c.key === sel.cat) : undefined;
    if (pair) {
      return {
        ...base,
        owner,
        path: `${row.label} · ${pair.label} · ${scopeTail}`,
        total: pair.amount,
        count: pair.count,
        overflow: pair.overflow,
        rows: rowsFrom(pair.ids, { slice: pair.sliceById }),
        mini: {
          title: 'หมวดหมู่สูงสุดของสาขานี้',
          rows: (row.topCategories ?? []).map((category) => ({
            key: category.key,
            label: category.label,
            amount: category.amount,
            on: category.key === sel.cat,
            sel: {
              t: 'break',
              dim: 'prop',
              key: row.key,
              cat: category.key === sel.cat ? null : category.key,
            },
          })),
        },
        empty: pair.count === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
      };
    }

    return {
      ...base,
      owner,
      path: `${row.label} · ${scopeTail}`,
      total: row.amount,
      count: row.count,
      overflow: row.overflow,
      // Every dimension is property-sliced, submitter included: under a branch
      // chip a bundle straddling both branches contributes only its matching
      // receipts, and `จาก … ทั้งคำขอ` is what says so. Under ทุกสาขา the slice
      // equals the bundle and the annotation never appears.
      rows: rowsFrom(row.ids, { slice: row.sliceById }),
      countLabel:
        sel.dim === 'cat' || sel.dim === 'mer'
          ? `${row.count} คำขอ · ${row.receiptCount} ใบเสร็จ`
          : undefined,
      mini:
        sel.dim === 'prop' && row.topCategories && row.topCategories.length > 0
          ? {
              title: 'หมวดหมู่สูงสุดของสาขานี้',
              rows: row.topCategories.map((category) => ({
                key: category.key,
                label: category.label,
                amount: category.amount,
                on: false,
                sel: { t: 'break', dim: 'prop', key: row.key, cat: category.key },
              })),
            }
          : undefined,
      empty: row.count === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
    };
  }

  // ── §6 four independent event counts ─────────────────────────────────────
  if (sel.t === 'flow') {
    const group = stats.flow[sel.k];
    return {
      ...base,
      owner: 'flow',
      inboxFilter:
        sel.k === 'submitted' ? 'pending' : sel.k === 'rejected' ? 'rejected' : sel.k === 'approved' ? 'approved' : 'paid',
      path: `${FLOW_LABELS[sel.k]} · ${scopeTail}`,
      total: group.total,
      count: group.count,
      overflow: group.overflow,
      rows: rowsFrom(group.ids, {
        meta: (b) => {
          if (sel.k === 'rejected') {
            return `${b.submitterName} · ส่ง ${thaiDate(b.submittedAt)} · ปฏิเสธ ${thaiDate(b.rejectedAt)}`;
          }
          if (sel.k === 'approved') return `${b.submitterName} · อนุมัติ ${thaiDate(b.approvedAt)}`;
          if (sel.k === 'paid') return `${b.submitterName} · จ่าย ${thaiDate(b.paidAt)} ${thaiTime(b.paidAt)}`;
          return `${b.submitterName} · ส่ง ${thaiDate(b.submittedAt)}`;
        },
      }),
      empty: group.count === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
    };
  }

  // ── §7 how long each leg took ────────────────────────────────────────────
  if (sel.t === 'speed') {
    const metric = stats.speed[sel.k];
    const bucket = sel.bucket ? metric.buckets.find((x) => x.key === sel.bucket) : null;
    const ids = bucket ? bucket.ids : metric.ids;
    const headlineTail = metric.lowSample ? '' : ` · ช้าสุด 10% ${thaiDuration(metric.p90Sec)}`;
    const headlineHead =
      sel.k === 'approval'
        ? 'นับเฉพาะคำขอที่อนุมัติในช่วงนี้'
        : sel.k === 'bank'
          ? 'เฉพาะที่จ่ายผ่าน KBIZ'
          : 'นับเฉพาะคำขอที่จ่ายในช่วงนี้';
    const rows = rowsFrom(ids, {
      meta: (b) => `${b.submitterName} · ${baht(b.amount)}`,
      duration: (b) => metric.durationById[b.id] ?? null,
    });
    return {
      ...base,
      owner: 'speed',
      inboxFilter: sel.k === 'approval' ? 'approved' : 'paid',
      path: `${SPEED_LABELS[sel.k]} · ${scopeTail}${bucket ? ` · ${bucket.label}` : ''}`,
      // Measured in time: a baht total in this header would be answering a
      // question nobody asked of this card.
      total: null,
      count: bucket ? bucket.count : metric.n,
      overflow: bucket ? bucket.overflow : metric.overflow,
      sortable: false,
      headline: `${headlineHead} · ${metric.n} คำขอ${headlineTail}`,
      chips: metric.buckets.map((x) => ({
        key: x.key,
        label: `${x.label} · ${x.count}`,
        on: sel.bucket === x.key,
        sel: { t: 'speed', k: sel.k, bucket: sel.bucket === x.key ? null : x.key },
      })),
      // Slowest first: the point of the panel is the tail, not the median.
      rows: rows.sort((a, b) => (b.durationSec ?? 0) - (a.durationSec ?? 0)),
      empty: ids.length === 0 ? emptyIn('ไม่มีคำขอที่เข้าเงื่อนไขในช่วงนี้') : undefined,
    };
  }

  // ── §8 approvals, rejections and the reasons as typed ────────────────────
  if (sel.t === 'dec') {
    const decisions = stats.decisions;
    if (sel.reason != null) {
      const reason = decisions.reasons[sel.reason];
      if (!reason) {
        return {
          ...base,
          owner: 'dec',
          inboxFilter: 'rejected',
          path: `เหตุผลการปฏิเสธ · ${scopeTail}`,
          empty: emptyIn('ไม่มีการปฏิเสธในช่วงนี้'),
        };
      }
      const rows = rowsFrom(reason.ids, {
        meta: () => reason.text,
        chip: (b) => ({ text: `ปฏิเสธ ${thaiDate(b.rejectedAt)}`, tone: 'neutral' }),
      });
      return {
        ...base,
        owner: 'dec',
        inboxFilter: 'rejected',
        path: `เหตุผลการปฏิเสธ · ${scopeTail}`,
        // A reason group carries no server total, and re-summing the rows would
        // quietly understate it whenever ids were capped. The count is the
        // honest headline here.
        total: null,
        count: reason.count,
        overflow: reason.overflow,
        rows,
        empty: rows.length === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
      };
    }
    const rejected = sel.k === 'rejected';
    const group = rejected ? decisions.rejected : decisions.approved;
    return {
      ...base,
      owner: 'dec',
      inboxFilter: rejected ? 'rejected' : 'approved',
      path: `${rejected ? 'ปฏิเสธ' : 'อนุมัติ'} · ตัดสินใน${scopeTail}`,
      total: group.total,
      count: group.count,
      overflow: group.overflow,
      rows: rowsFrom(group.ids, {
        meta: (b) =>
          `${b.submitterName} · ${rejected ? `ปฏิเสธ ${thaiDate(b.rejectedAt)}` : `อนุมัติ ${thaiDate(b.approvedAt)}`}`,
      }),
      empty: group.count === 0 ? emptyIn('ไม่มีคำขอในช่วงนี้') : undefined,
    };
  }

  // ── §9 what one person is still owed ─────────────────────────────────────
  const person = stats.owed.find((o) => o.userId === sel.key);
  if (!person) return { ...base, owner: 'owed', inboxFilter: 'approved', path: 'ยังไม่ได้รับเงิน · ตอนนี้' };
  return {
    ...base,
    owner: 'owed',
    inboxFilter: 'approved',
    path: `${person.name} · ยังไม่ได้รับเงิน · ตอนนี้${propTail}`,
    total: person.total,
    count: person.ids.length,
    overflow: person.overflow,
    sortable: false,
    rows: rowsFrom(person.ids, {
      meta: (b) => `${b.submitterName} · อนุมัติ ${thaiDate(b.approvedAt)}`,
      chip: (b) => {
        const days = daysSince(b.approvedAt, now);
        return {
          text:
            b.status === 'paying'
              ? `กำลังโอน · ${thaiDuration((ms(now) - ms(b.payingSince)) / 1000)}`
              : `อนุมัติแล้ว ${days} วัน`,
          tone: days >= 3 ? 'danger' : 'neutral',
        };
      },
      wait: (b) => ms(b.approvedAt),
    }).sort((a, b) => a.wait - b.wait),
  };
}
