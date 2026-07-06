// The company P&L expense chart (งบกำไรขาดทุน) and its mapping from
// reimbursement receipt categories. Line codes are shared with the hf-mcp
// financial server's pl_statement tool — keep them in sync.

/** How the company paid an admin-entered expense. */
export type PaymentMethod = 'cash' | 'transfer';

export interface PlLineDef {
  /** Stable code, e.g. "elec_saichon". Stored on Expense.plLine. */
  code: string;
  /** Full Thai line label as printed on the monthly P&L sheet. */
  label: string;
  /** Wizard group label (e.g. "ค่าไฟฟ้า"); lines in one group differ by variant. */
  group: string;
  /** Sub-choice inside the group (building or channel), when the group has several lines. */
  variant?: string;
  /** True = a bill expected every month → shows on the completeness checklist. */
  recurring: boolean;
  /** False = defunct line (kept so old months still render). */
  active: boolean;
}

/** Canonical P&L expense lines, in the accountant's sheet order. */
export const PL_LINES: PlLineDef[] = [
  { code: 'salary', label: 'เงินเดือนพนักงาน', group: 'เงินเดือนพนักงาน', recurring: true, active: true },
  { code: 'commission_staff', label: 'ค่าคอมมิชชั่นพนักงาน', group: 'ค่าคอมมิชชั่น', variant: 'พนักงาน', recurring: true, active: true },
  { code: 'commission_booking', label: 'ค่าคอมมิชชั่น BOOKING', group: 'ค่าคอมมิชชั่น', variant: 'Booking.com', recurring: true, active: true },
  { code: 'commission_expedia', label: 'ค่าคอมมิชชั่น expedia group', group: 'ค่าคอมมิชชั่น', variant: 'Expedia', recurring: false, active: true },
  { code: 'breakfast', label: 'ค่าอาหารเช้า', group: 'ค่าอาหารเช้า', recurring: true, active: true },
  { code: 'housekeeping', label: 'ค่าใช้จ่าย-แม่บ้าน', group: 'แม่บ้าน', recurring: true, active: true },
  { code: 'water_bar', label: 'ค่าใช้จ่าย-บาร์น้ำ', group: 'บาร์น้ำ', recurring: true, active: true },
  { code: 'repair_appliance', label: 'ค่าซ่อมแซม-เครื่องใช้ไฟฟ้า', group: 'ค่าซ่อมแซม', variant: 'เครื่องใช้ไฟฟ้า', recurring: false, active: true },
  { code: 'water_saichon', label: 'ค่าน้ำประปา-สายชล', group: 'ค่าน้ำประปา', variant: 'สายชล', recurring: true, active: true },
  { code: 'water_hopinn47', label: 'ค่าน้ำประปา-Hop inn 47', group: 'ค่าน้ำประปา', variant: 'Hop inn 47', recurring: true, active: true },
  { code: 'water_ville', label: 'ค่าน้ำประปา-HF Ville', group: 'ค่าน้ำประปา', variant: 'HF Ville', recurring: true, active: true },
  { code: 'elec_saichon', label: 'ค่าไฟฟ้า-สายชล', group: 'ค่าไฟฟ้า', variant: 'สายชล', recurring: true, active: true },
  { code: 'elec_hopinn45', label: 'ค่าไฟฟ้า-Hop inn 45', group: 'ค่าไฟฟ้า', variant: 'Hop inn 45', recurring: false, active: false },
  { code: 'elec_hopinn47', label: 'ค่าไฟฟ้า-Hop inn 47', group: 'ค่าไฟฟ้า', variant: 'Hop inn 47', recurring: true, active: true },
  { code: 'elec_ville', label: 'ค่าไฟฟ้า-HF Ville', group: 'ค่าไฟฟ้า', variant: 'HF Ville', recurring: true, active: true },
  { code: 'phone', label: 'ค่าโทรศัพท์ สายชล/ออฟฟิศ', group: 'ค่าโทรศัพท์', variant: 'สายชล/ออฟฟิศ', recurring: true, active: true },
  { code: 'phone_ville', label: 'ค่าโทรศัพท์ HF Ville', group: 'ค่าโทรศัพท์', variant: 'HF Ville', recurring: true, active: true },
  { code: 'laundry', label: 'ค่าซักผ้า', group: 'ค่าซักผ้า', recurring: true, active: true },
  { code: 'repair_building', label: 'ค่าซ่อมแซม-อาคาร', group: 'ค่าซ่อมแซม', variant: 'อาคาร', recurring: false, active: true },
  { code: 'supplies', label: 'ค่าวัสดุสิ้นเปลือง/อุปกรณ์สำนักงาน', group: 'วัสดุสิ้นเปลือง/สำนักงาน', recurring: false, active: true },
  { code: 'social_security', label: 'ค่าเงินสมทบประกันสังคม', group: 'ประกันสังคม', recurring: true, active: true },
  { code: 'other', label: 'ค่าใช้จ่ายอื่นๆ', group: 'อื่นๆ', recurring: false, active: true },
];

export const PL_LINE_BY_CODE: Record<string, PlLineDef> = Object.fromEntries(
  PL_LINES.map((line) => [line.code, line]),
);

/**
 * Receipt category → P&L line code. Covers the legacy reimbursement
 * categories AND every P&L line label (staff-paid invoices entered by the
 * admin store the line label as the receipt category). Unknown → "other".
 */
export const RECEIPT_CATEGORY_TO_PL_LINE: Record<string, string> = {
  'ต้นทุนอาหารเช้า HF': 'breakfast',
  'อุปกรณ์โรงแรม': 'supplies',
  'อุปกรณ์แม่บ้าน': 'housekeeping',
  'อุปกรณ์ช่าง': 'repair_building',
  'บาร์น้ำ': 'water_bar',
  'โรงซักผ้า': 'laundry',
  'อุปกรณ์สำนักงาน reception': 'supplies',
  'อุปกรณ์สำนักงาน office': 'supplies',
  'ร้านอาทิตย์': 'other',
  'อื่น ๆ': 'other',
  ...Object.fromEntries(PL_LINES.map((line) => [line.label, line.code])),
};

export function plLineForReceiptCategory(category: string): string {
  return RECEIPT_CATEGORY_TO_PL_LINE[category] ?? 'other';
}

// ─── Ledger API contract ─────────────────────────────────────────

/** Serialized `Expense` row — an admin-entered company expense. */
export interface Expense {
  id: string;
  enteredById: string;
  plLine: string;
  /** Accrual month on the P&L, "YYYY-MM". */
  expenseMonth: string;
  invoiceDate: string | null;
  billingPeriod: string | null;
  vendor: string;
  amount: number;
  paymentMethod: PaymentMethod;
  paid: boolean;
  dueDate: string | null;
  note: string | null;
  photoPath: string | null;
  createdAt: string;
}

/** Multipart form fields for creating/updating an Expense (photo travels alongside). */
export interface ExpenseFormFields {
  plLine: string;
  expenseMonth: string;
  amount: number;
  vendor?: string;
  invoiceDate?: string;
  billingPeriod?: string;
  paymentMethod?: PaymentMethod;
  paid?: boolean;
  dueDate?: string;
  note?: string;
}

export interface RevenueFigures {
  rooms: number;
  waterBar: number;
  other: number;
}

export interface RevenueEntry extends RevenueFigures {
  month: string;
  updatedAt: string;
}

/** One P&L line's total for a month, split by where it came from. */
export interface MonthLineAmount {
  code: string;
  label: string;
  amount: number;
  fromExpenses: number;
  /** Portion contributed by reimbursement receipts (mapped by category). */
  fromReceipts: number;
}

export interface ChecklistItem {
  code: string;
  label: string;
  done: boolean;
  amount: number;
}

/** Dashboard payload for one month of the ledger. */
export interface MonthLedgerSummary {
  month: string;
  lines: MonthLineAmount[];
  expenseTotal: number;
  /** Total contributed by reimbursement receipts within expenseTotal. */
  receiptsTotal: number;
  /** Recurring bills expected this month, with entry status. */
  checklist: ChecklistItem[];
  revenue: RevenueEntry | null;
  /** Raw admin entries for the month (newest first) for the entry list. */
  expenses: Expense[];
}

export interface PlReportLine {
  code: string;
  label: string;
  amount: number;
}

/** A full monthly งบกำไรขาดทุน. */
export interface PlReport {
  month: string;
  /** "accountant-sheet" = static history (read-only); "ledger" = live data. */
  source: 'accountant-sheet' | 'ledger';
  revenue: RevenueFigures;
  revenueTotal: number;
  lines: PlReportLine[];
  expenseTotal: number;
  netProfit: number;
}
