// Re-export the shared API contract types so screens import them from one place.
// Frontend-specific UI types (Theme, AppState, Tweaks) stay local below.
export * from '@reimbursement/shared';

import type { BundleWithDetails, Receipt } from '@reimbursement/shared';

export interface Theme {
  accent: string;
  paper: string;
  surface: string;
  surface2: string;
  ink: string;
  inkSoft: string;
  inkSofter: string;
  hairline: string;
  hairlineStrong: string;
  success: string;
  warn: string;
  danger: string;
  statusPending: string;
  statusApproved: string;
  statusPaid: string;
  statusRejected: string;
  /** The KBIZ-automation-in-flight window (`paying`) — amber, distinct from
   *  `statusPending`'s warmer amber so the two never read as the same wait. */
  statusPaying: string;
  /** Fill for every data mark (bars, columns, segments). `accent` measures
   *  1.71:1 on the dark surface, so a chart never uses it directly. */
  chartInk: string;
  /** Second step of the same hue — the one place a mark needs to sit beside
   *  `chartInk` and still be told apart (the ปฏิเสธ segment). */
  chartInk2: string;
  /** Label colour ON `chartInk` / ON `chartInk2`. Paired with the fill so a
   *  theme change can never leave a label unreadable on its own segment. */
  onChartInk: string;
  onChartInk2: string;
  /** Four-step sequential ramp for ordered bands (age bands, cycle buckets),
   *  index 0 = shortest wait. Dark mode INVERTS the ramp rather than fading it:
   *  a low-opacity burgundy on the dark surface reads as empty tile edge. */
  chartSeq: readonly [string, string, string, string];
  /** The unfilled remainder of a bar — the track it sits in. */
  chartTrack: string;
}

// Bundles in app state include their joined receipts and submitter, since the
// API returns the joined view (BundleWithDetails). Screens use submitter for display.
export interface AppState {
  receipts: Receipt[];
  bundles: BundleWithDetails[];
}

export type Platform = 'mobile' | 'desktop';

export interface Tweaks {
  role: 'employee' | 'approver';
  platform: Platform;
  accent: string;
  dark: boolean;
}
