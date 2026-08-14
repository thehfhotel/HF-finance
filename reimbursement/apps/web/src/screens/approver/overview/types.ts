import type { OverviewPropertyKey, OverviewWindowKey } from '../../../lib/api';
import type { BundleStatus } from '../../../lib/types';

/**
 * What the page is currently showing, and what is drilled inside it.
 *
 * Exactly one drill is open at a time — the selection descriptor below IS the
 * open panel. Two selections that stringify the same are the same selection,
 * which is what makes a second tap on a mark close it.
 */

export type AgeBandKey = 'b1' | 'b2' | 'b3' | 'b4';
export type PayingBandKey = 'fast' | 'stuck';
export type SpeedMetricKey = 'approval' | 'payout' | 'bank';
export type SpeedBucketKey = 'q1' | 'q2' | 'q3' | 'q4';
export type FlowKey = 'submitted' | 'approved' | 'paid' | 'rejected';
export type BreakdownDim = 'cat' | 'mer' | 'sub' | 'prop';

export type DrillSelection =
  | { t: 'ladder'; win: OverviewWindowKey }
  | { t: 'prev' }
  | { t: 'queue'; k: 'pending'; band?: AgeBandKey | null }
  | { t: 'queue'; k: 'approved' }
  | { t: 'queue'; k: 'paying'; band?: PayingBandKey | null }
  | { t: 'queue'; k: 'orphan'; who?: string | null }
  | { t: 'alertOverdue' }
  | { t: 'series'; key: string }
  /** `cat` re-scopes a ตามสาขา row to one property+category pair — the mini
   *  ranked list inside that drill is a control, not a printout. */
  | { t: 'break'; dim: BreakdownDim; key?: string | null; tail?: boolean; cat?: string | null }
  | { t: 'flow'; k: FlowKey }
  | { t: 'speed'; k: SpeedMetricKey; bucket?: SpeedBucketKey | null }
  | { t: 'dec'; k?: 'approved' | 'rejected'; reason?: number }
  | { t: 'owed'; key: string };

/**
 * Which card the open panel belongs under. On the phone the panel renders in
 * flow beneath its owner; on desktop every owner renders into the one rail.
 */
export type DrillOwner =
  | 'alerts'
  | 'queue'
  | 'ladder'
  | 'series'
  | 'break-cat'
  | 'break-mer'
  | 'break-catmer'
  | 'break-sub'
  | 'break-prop'
  | 'flow'
  | 'speed'
  | 'dec'
  | 'owed';

export type SortKey = 'recent' | 'amount' | 'wait';

/** The phone folds หมวดหมู่ and ร้านค้า into one card with a title toggle. */
export type CatMerKey = 'cat' | 'mer';

export interface OverviewViewState {
  window: OverviewWindowKey;
  property: OverviewPropertyKey;
  drill: DrillSelection | null;
  sort: SortKey | null;
  expand: boolean;
  catmer: CatMerKey;
  /** Phone layout: fewer rows, weekly series for เดือนนี้, one folded card. */
  phone: boolean;
}

/** Two selections that stringify the same ARE the same selection — which is
 *  what makes a second tap on a mark close its panel. Each toggle compares a
 *  freshly built descriptor against the open one at the same call site, so key
 *  order is never in question. */
export function sameSelection(a: DrillSelection | null, b: DrillSelection | null): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export type ChipTone = 'neutral' | 'warn' | 'danger';

/** One row of the drill panel. `bundleId` null means there is no request to
 *  open — a loose receipt, or a withdrawn bundle that only survives as an
 *  audit event — and the row renders un-navigable. */
export interface DrillRow {
  key: string;
  bundleId: string | null;
  name: string;
  meta: string;
  /** Empty on a receipt row, which is indented under its owner instead. */
  initials: string;
  status: BundleStatus | null;
  amount: number;
  /** Right-hand slot when the row is measured in time, not money. */
  durationSec?: number | null;
  chip?: { text: string; tone: ChipTone } | null;
  /** Replaces the status pill on an un-navigable row. */
  note?: string | null;
  indent?: boolean;
  sortDate: number;
  wait: number;
}

/** ใบเสร็จลอย is grouped by employee and expands in place. */
export interface DrillReceiptGroup {
  userId: string;
  name: string;
  initials: string;
  count: number;
  total: number;
  oldestDays: number;
  open: boolean;
  receipts: DrillRow[];
  /** Receipts this employee holds that the payload did not ship. Drives
   *  `แสดง n จาก m` so a group can never expand shorter than it promised. */
  overflow: number;
}

export interface DrillChip {
  key: string;
  label: string;
  on: boolean;
  sel: DrillSelection;
}

export interface ResolvedDrill {
  owner: DrillOwner;
  /** The breadcrumb in the panel header — where this number came from. */
  path: string;
  /** Server aggregate. Null on the speed panel, which is measured in time. */
  total: number | null;
  count: number;
  /** Overrides `n คำขอ` when the group counts something else. */
  countLabel?: string;
  headline?: string;
  rows: DrillRow[];
  receiptGroups?: DrillReceiptGroup[];
  chips?: DrillChip[];
  /** A ranked list inside the panel whose rows are themselves drill targets —
   *  every row here re-scopes the panel, none is decoration. */
  mini?: {
    title: string;
    rows: Array<{ key: string; label: string; amount: number; on: boolean; sel: DrillSelection }>;
  };
  sortable: boolean;
  defaultSort: SortKey;
  /** Ids the server dropped past `meta.idCap` — drives the escape footer. */
  overflow: number;
  /** Which inbox tab the escape footer opens. */
  inboxFilter: Exclude<BundleStatus, 'draft' | 'paying'>;
  empty?: { message: string; jump: boolean };
}
