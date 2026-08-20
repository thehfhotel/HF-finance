import { readFileSync } from "node:fs";

/**
 * Employee data that must never be committed.
 *
 * The payroll roster (legal name → nickname / position / monthly salary) and
 * the provident-fund balances are real personal data about real staff. They
 * used to be inline literals in `sheets.ts` and `views/worksheet.ts`, which
 * put 21 people's salaries and their lifetime fund balances into a PUBLIC
 * git history (see docs/change-requests/CR-2026-08-20-employee-data-out-of-git.md).
 *
 * They now live in `data/`, which is gitignored — the same rule kbiz-bot
 * applies to `transfer-other.config.json`: the real values live on the host,
 * never in the repo.
 *
 * ABSENT IS NOT FATAL, DELIBERATELY. Both consumers already treat a missing
 * entry as "no default" and fall through, so a deployment without these files
 * degrades to blank nickname/position/salary suggestions and blank fund
 * balances rather than failing to boot. That is the safe direction for a
 * payroll tool, but it IS silent, so each loader logs once at startup when it
 * finds nothing — a blank worksheet column should never be a mystery.
 *
 * Shapes are documented by the committed placeholder files in `data-examples/`.
 */

const EMPLOYEE_DEFAULTS_PATH =
  process.env.EMPLOYEE_DEFAULTS_PATH ?? "data/employee-defaults.json";
const SAVINGS_BALANCE_PATH =
  process.env.SAVINGS_BALANCE_PATH ?? "data/savings-balance.json";

export type EmployeeDefault = { nickname: string; position: string; salary: number };

function loadJson(path: string, what: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code === "ENOENT") {
      console.warn(
        `[roster-data] ${what} not found at ${path} — continuing without it. ` +
          `Nickname/position/salary defaults and provident-fund balances will be blank. ` +
          `Install the file on the host (it is gitignored on purpose); see data-examples/.`,
      );
    } else {
      console.warn(`[roster-data] ${what} at ${path} could not be read: ${String(err)}`);
    }
    return null;
  }
}

/** Legal name (as it appears on the bank account) → nickname / position / salary. */
export function loadEmployeeDefaults(): Record<string, EmployeeDefault> {
  const raw = loadJson(EMPLOYEE_DEFAULTS_PATH, "employee defaults");
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, EmployeeDefault> = {};
  for (const [name, v] of Object.entries(raw as Record<string, unknown>)) {
    const d = v as Partial<EmployeeDefault> | null;
    if (!d || typeof d !== "object") continue;
    out[name] = {
      nickname: typeof d.nickname === "string" ? d.nickname : "",
      position: typeof d.position === "string" ? d.position : "",
      salary: typeof d.salary === "number" ? d.salary : 0,
    };
  }
  return out;
}

/**
 * Nickname → provident-fund balance carried into the current cycle. Several
 * spellings of one nickname legitimately map to the same person (the sheets
 * are hand-typed), so this is a flat map, not one entry per employee.
 */
export function loadSavingsBalance(): Record<string, number> {
  const raw = loadJson(SAVINGS_BALANCE_PATH, "provident-fund balances");
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, number> = {};
  for (const [nickname, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof v === "number" && Number.isFinite(v)) out[nickname] = v;
  }
  return out;
}
