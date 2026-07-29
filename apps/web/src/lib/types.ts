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
