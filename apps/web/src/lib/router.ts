import type { Expense } from '@reimbursement/shared';

export type Route =
  | { name: 'home' }
  | { name: 'upload'; editId?: string }
  | { name: 'record'; id: string }
  | { name: 'bundle-new'; id?: string }
  | { name: 'bundle-submitted'; id: string }
  | { name: 'bundle'; id: string }
  | { name: 'approver-home' }
  | { name: 'approver-review'; id: string }
  | { name: 'approver-pay'; id: string }
  | { name: 'login' }
  | { name: 'auth-callback' }
  | { name: 'link-account' }
  | { name: 'admin-employees' }
  | { name: 'my-requests' }
  // Company expense ledger (admin/approver)
  | { name: 'ledger'; month?: string }
  | { name: 'ledger-entry'; edit?: Expense }
  | { name: 'ledger-report'; month?: string };

export type RouteName = Route['name'];

export type Nav = (route: Route) => void;
