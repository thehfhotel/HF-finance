import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { listAccounts } from "./store";

const SHEETS_DIR = process.env.SHEETS_DIR ?? "data/sheets";

export type SheetRow = {
  accountId: string;
  accountNumber: string;
  accountName: string;
  bank: string;
  nickname: string;
  position: string;
  // Inputs (deductions)
  salary: number;
  socialSecurity: number;
  savings: number;
  advance: number;
  loan: number;
  interest: number;
  roomCost: number;
  leave: number;
  otherDeduction: number;
  // Inputs (additions)
  commission: number;
  breakfast: number;
  ot: number;
  otherAddition: number;
  // Per-row note
  note: string;
};

export type Sheet = {
  period: string;          // YYYY-MM
  effectiveDate: string;   // dd/mm/yyyy Gregorian, blank until set
  rows: SheetRow[];
  generalNotes: string;
  // accountIds the user explicitly removed from this sheet — prevents
  // loadSheet's reconciliation loop from re-adding them on next load.
  dismissed: string[];
  updatedAt: string;
};

const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

export function isValidPeriod(p: string): boolean {
  return PERIOD_RE.test(p);
}

// Defaults pulled from the most recent payroll snapshot
// (payroll-table เดือน เมษายน-69.xlsx, last refreshed 30 เม.ย. 2569).
// Applied to rows that have no nickname / position / salary set — keeps
// existing user edits. Refresh by re-importing the latest monthly sheet
// and updating values. Includes former employees so historic
// months still resolve a nickname/position/salary if their bank account
// rows are ever reloaded.
const EMPLOYEE_DEFAULTS: Record<string, { nickname: string; position: string; salary: number }> = {
  "นางสาวทดสอบ ตัวอย่าง": { nickname: "ทดสอบ", position: "Reception", salary: 11111 },
  // Real values live outside the repo (gitignored data/); see src/roster-data.ts.
};

function normalizeName(name: string): string {
  return String(name || "").trim().replace(/\s+/g, " ");
}

function defaultsFor(accountName: string): { nickname: string; position: string; salary: number } | null {
  const k = normalizeName(accountName);
  return EMPLOYEE_DEFAULTS[k] ?? null;
}

function emptyRow(a: { id: string; accountNumber: string; accountName: string }): SheetRow {
  const d = defaultsFor(a.accountName);
  return {
    accountId: a.id,
    accountNumber: a.accountNumber,
    accountName: a.accountName,
    bank: "KBANK",
    nickname: d?.nickname ?? "",
    position: d?.position ?? "",
    salary: d?.salary ?? 0,
    socialSecurity: 0, savings: 0, advance: 0, loan: 0,
    interest: 0, roomCost: 0, leave: 0, otherDeduction: 0,
    commission: 0, breakfast: 0, ot: 0, otherAddition: 0,
    note: "",
  };
}

// Backfill new fields on rows persisted before they existed. For old rows
// where the bank prefix was embedded in accountNumber (e.g. "KTB-957-..."),
// split it out into the bank field. Also seed nickname/position/salary
// from EMPLOYEE_DEFAULTS the first time we see a row with all three blank
// — avoids clobbering rows the operator has already edited.
function normalize(row: any): SheetRow {
  if (typeof row.nickname !== "string") row.nickname = "";
  if (typeof row.position !== "string") row.position = "";
  if (typeof row.bank !== "string") {
    const m = String(row.accountNumber || "").match(/^([A-Za-z]+)\s*-\s*(.+)$/);
    if (m) {
      row.bank = m[1].toUpperCase();
      row.accountNumber = m[2].replace(/\s+/g, "");
    } else {
      row.bank = "KBANK";
    }
  }
  if (!row.nickname && !row.position && !(Number(row.salary) > 0)) {
    const d = defaultsFor(row.accountName);
    if (d) {
      row.nickname = d.nickname;
      row.position = d.position;
      row.salary = d.salary;
    }
  }
  return row as SheetRow;
}

function path(period: string): string {
  return join(SHEETS_DIR, `${period}.json`);
}

async function readSheet(period: string): Promise<Sheet | null> {
  try {
    const buf = await readFile(path(period), "utf8");
    return JSON.parse(buf) as Sheet;
  } catch {
    return null;
  }
}

// Most recent sheet for a period strictly before `period` (e.g. for 2026-06 →
// 2026-05). Used to carry salaries forward into a brand-new cycle.
async function latestPriorSheet(period: string): Promise<Sheet | null> {
  let files: string[];
  try { files = await readdir(SHEETS_DIR); } catch { return null; }
  const priors = files
    .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
    .map((f) => f.slice(0, -5))
    .filter((p) => isValidPeriod(p) && p < period)
    .sort();
  for (let i = priors.length - 1; i >= 0; i--) {
    const s = await readSheet(priors[i]);
    if (s) return s;
  }
  return null;
}

// A fresh row for a NEW cycle, seeded from the same account's prior-cycle row:
// carry the salary forward and recompute ประกันสังคม 3% / เงินสะสม 5%; all
// one-time fields (advance, loan, OT, …) and the note start at 0/blank.
function seededRow(a: { id: string; accountNumber: string; accountName: string }, prior: SheetRow): SheetRow {
  const base = emptyRow(a); // identity + EMPLOYEE_DEFAULTS fallback for new accounts
  const salary = Number(prior.salary) || 0;
  return {
    ...base,
    bank: prior.bank || base.bank,
    nickname: prior.nickname || base.nickname,
    position: prior.position || base.position,
    salary,
    socialSecurity: Math.round(salary * 0.03 * 100) / 100,
    savings: Math.round(salary * 0.05 * 100) / 100,
  };
}

export async function loadSheet(period: string): Promise<Sheet> {
  const accounts = await listAccounts();
  const existing = await readSheet(period);
  // Reconcile: keep existing rows in their original order, then append any
  // roster accounts that don't yet have a row (e.g. account added mid-month).
  // Removed accounts retain their historical row.
  const sheet: Sheet = existing ?? {
    period,
    effectiveDate: "",
    rows: [],
    generalNotes: "",
    dismissed: [],
    updatedAt: new Date().toISOString(),
  };
  if (!Array.isArray(sheet.dismissed)) sheet.dismissed = [];
  sheet.rows = sheet.rows.map(normalize);
  const have = new Set(sheet.rows.map((r) => r.accountId));
  const dismissed = new Set(sheet.dismissed);
  // For a brand-new sheet, seed each fresh row from the most recent prior cycle
  // (carry salary + recompute 3%/5%). Existing sheets are never reseeded, so a
  // value the user cleared stays cleared.
  const seed = existing ? null : new Map((await latestPriorSheet(period))?.rows.map((r) => [r.accountId, r]) ?? []);
  for (const a of accounts) {
    if (!have.has(a.id) && !dismissed.has(a.id)) {
      const prior = seed?.get(a.id);
      sheet.rows.push(prior ? seededRow(a, prior) : emptyRow(a));
    }
  }
  return sheet;
}

export async function saveSheet(period: string, input: Omit<Sheet, "period" | "updatedAt">): Promise<Sheet> {
  await mkdir(SHEETS_DIR, { recursive: true });
  const sheet: Sheet = {
    period,
    effectiveDate: input.effectiveDate,
    rows: input.rows,
    generalNotes: input.generalNotes,
    dismissed: Array.isArray(input.dismissed) ? input.dismissed : [],
    updatedAt: new Date().toISOString(),
  };
  await writeFile(path(period), JSON.stringify(sheet, null, 2), "utf8");
  return sheet;
}

export function takeHome(r: SheetRow): number {
  const deductions =
    r.socialSecurity + r.savings + r.advance + r.loan +
    r.interest + r.roomCost + r.leave + r.otherDeduction;
  const additions = r.commission + r.breakfast + r.ot + r.otherAddition;
  return Math.round((r.salary - deductions + additions) * 100) / 100;
}
