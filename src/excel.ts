import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { readFile } from "node:fs/promises";

const PAYROLL_TEMPLATE_PATH = new URL("../KBIZTemplateUploadPayroll.xlsx", import.meta.url);
const BENEFICIARY_TEMPLATE_PATH = new URL("../KBIZTemplateAddPayrollAccount.xlsx", import.meta.url);
const SHEET_PATH = "xl/worksheets/sheet1.xml";
const STRINGS_PATH = "xl/sharedStrings.xml";
const FIRST_DATA_ROW = 4;
const LAST_DATA_ROW = 103;
const MAX_ROWS = LAST_DATA_ROW - FIRST_DATA_ROW + 1;

export type PayrollRow = { accountNumber: string; accountName: string; amount: number };
export type PayrollInput = { effectiveDate: string; rows: PayrollRow[] };
export type BeneficiaryAccount = { accountNumber: string; accountName: string };

type Template = {
  files: Record<string, Uint8Array>;
  sheetXml: string;
  stringsCount: number;
  stringsInner: string;
};

let payrollTemplate: Template | null = null;
let beneficiaryTemplate: Template | null = null;

async function loadTemplate(path: URL): Promise<Template> {
  const buf = await readFile(path);
  const files = unzipSync(new Uint8Array(buf));
  const sheetXml = strFromU8(files[SHEET_PATH]);

  const ssXml = strFromU8(files[STRINGS_PATH]);
  const sstOpen = ssXml.match(/<sst[^>]*>/);
  if (!sstOpen) throw new Error(`template ${path} missing <sst>`);
  const openEnd = (sstOpen.index ?? 0) + sstOpen[0].length;
  const closeStart = ssXml.lastIndexOf("</sst>");
  const stringsInner = ssXml.slice(openEnd, closeStart);
  const countMatch = sstOpen[0].match(/count="(\d+)"/);
  const stringsCount = countMatch ? parseInt(countMatch[1], 10) : 0;

  return { files, sheetXml, stringsCount, stringsInner };
}

function escapeXml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" }[c]!)
  );
}

function patchCell(xml: string, col: string, row: number, replacement: string): string {
  const re = new RegExp(`<c r="${col}${row}"[^>]*?(?:/>|>[\\s\\S]*?</c>)`);
  if (!re.test(xml)) throw new Error(`cell ${col}${row} not found in template`);
  return xml.replace(re, replacement);
}

function updateCachedValue(xml: string, col: string, row: number, newValue: string): string {
  const cellRe = new RegExp(`<c r="${col}${row}"[^>]*?>[\\s\\S]*?</c>`);
  if (!cellRe.test(xml)) throw new Error(`cell ${col}${row} not found in template`);
  return xml.replace(cellRe, (cell) => {
    const vRe = /<v[^/>]*?(?:\/>|>[^<]*<\/v>)/;
    if (vRe.test(cell)) return cell.replace(vRe, `<v>${newValue}</v>`);
    return cell.replace(/<\/c>$/, `<v>${newValue}</v></c>`);
  });
}

function makeStringsXml(inner: string, totalCount: number): string {
  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${totalCount}" uniqueCount="${totalCount}">` +
    inner +
    `</sst>`
  );
}

function pack(template: Template, sheet: string, strings: string): Buffer {
  const newFiles: Record<string, Uint8Array> = { ...template.files };
  newFiles[SHEET_PATH] = strToU8(sheet);
  newFiles[STRINGS_PATH] = strToU8(strings);
  return Buffer.from(zipSync(newFiles, { level: 6 }));
}

// === Payroll workbook ===

function buildPayrollOutput(t: Template, input: PayrollInput): { sheet: string; strings: string } {
  let sheet = t.sheetXml;
  const appended: string[] = [];
  let nextIdx = t.stringsCount;

  const dateIdx = nextIdx++;
  appended.push(`<si><t>${escapeXml(input.effectiveDate)}</t></si>`);

  let total = 0;
  for (let i = 0; i < input.rows.length; i++) {
    const r = FIRST_DATA_ROW + i;
    const row = input.rows[i];
    total += row.amount;

    const acctIdx = nextIdx++;
    appended.push(`<si><t>${escapeXml(row.accountNumber)}</t></si>`);
    const nameIdx = nextIdx++;
    appended.push(`<si><t xml:space="preserve">${escapeXml(row.accountName)}</t></si>`);

    sheet = patchCell(sheet, "B", r, `<c r="B${r}" s="17" t="s"><v>${acctIdx}</v></c>`);
    sheet = patchCell(sheet, "C", r, `<c r="C${r}" s="9" t="s"><v>${nameIdx}</v></c>`);
    sheet = patchCell(sheet, "D", r, `<c r="D${r}" s="11"><v>${row.amount}</v></c>`);
    sheet = updateCachedValue(sheet, "A", r, "004");
    if (r > 4) sheet = updateCachedValue(sheet, "E", r, escapeXml(input.effectiveDate));
  }

  sheet = patchCell(sheet, "E", 4, `<c r="E4" s="19" t="s"><v>${dateIdx}</v></c>`);
  total = Math.round(total * 100) / 100;
  sheet = updateCachedValue(sheet, "B", 1, String(input.rows.length));
  sheet = updateCachedValue(sheet, "D", 1, String(total));

  return { sheet, strings: makeStringsXml(t.stringsInner + appended.join(""), t.stringsCount + appended.length) };
}

export async function buildWorkbook(input: PayrollInput): Promise<Buffer> {
  if (input.rows.length === 0) throw new Error("at least one row required");
  if (input.rows.length > MAX_ROWS) throw new Error(`too many rows (max ${MAX_ROWS})`);
  if (!payrollTemplate) payrollTemplate = await loadTemplate(PAYROLL_TEMPLATE_PATH);

  const t0 = performance.now();
  const { sheet, strings } = buildPayrollOutput(payrollTemplate, input);
  const out = pack(payrollTemplate, sheet, strings);
  console.log(`[excel] payroll total=${(performance.now() - t0).toFixed(1)}ms`);
  return out;
}

// === Beneficiary workbook (Add Payroll Account) ===
// Style indices in this template:
//   A column: s="13" t="str"  (formula cell)
//   B column: s="15" t="s"    (shared string)
//   C column: s="10" t="s"    (shared string)
//   B1:       s="14"          (count formula)

// Beneficiary template ships with 3 pre-filled sample rows (4-6). Clear them
// before patching user data so they don't leak through when user supplies <3 rows.
const BENEFICIARY_PREFILL_ROWS = [4, 5, 6];

function buildBeneficiaryOutput(t: Template, accounts: BeneficiaryAccount[]): { sheet: string; strings: string } {
  let sheet = t.sheetXml;
  const appended: string[] = [];
  let nextIdx = t.stringsCount;

  for (const r of BENEFICIARY_PREFILL_ROWS) {
    sheet = patchCell(sheet, "B", r, `<c r="B${r}" s="15"/>`);
    sheet = patchCell(sheet, "C", r, `<c r="C${r}" s="10"/>`);
    sheet = updateCachedValue(sheet, "A", r, "");
  }

  for (let i = 0; i < accounts.length; i++) {
    const r = FIRST_DATA_ROW + i;
    const a = accounts[i];

    const acctIdx = nextIdx++;
    appended.push(`<si><t>${escapeXml(a.accountNumber)}</t></si>`);
    const nameIdx = nextIdx++;
    appended.push(`<si><t xml:space="preserve">${escapeXml(a.accountName)}</t></si>`);

    sheet = patchCell(sheet, "B", r, `<c r="B${r}" s="15" t="s"><v>${acctIdx}</v></c>`);
    sheet = patchCell(sheet, "C", r, `<c r="C${r}" s="10" t="s"><v>${nameIdx}</v></c>`);
    sheet = updateCachedValue(sheet, "A", r, "004");
  }

  sheet = updateCachedValue(sheet, "B", 1, String(accounts.length));

  return { sheet, strings: makeStringsXml(t.stringsInner + appended.join(""), t.stringsCount + appended.length) };
}

export async function buildBeneficiaryWorkbook(accounts: BeneficiaryAccount[]): Promise<Buffer> {
  if (accounts.length === 0) throw new Error("at least one account required");
  if (accounts.length > MAX_ROWS) throw new Error(`too many accounts (max ${MAX_ROWS})`);
  if (!beneficiaryTemplate) beneficiaryTemplate = await loadTemplate(BENEFICIARY_TEMPLATE_PATH);

  const t0 = performance.now();
  const { sheet, strings } = buildBeneficiaryOutput(beneficiaryTemplate, accounts);
  const out = pack(beneficiaryTemplate, sheet, strings);
  console.log(`[excel] beneficiary total=${(performance.now() - t0).toFixed(1)}ms`);
  return out;
}
