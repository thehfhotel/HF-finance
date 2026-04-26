import { readFileSync } from "node:fs";
import { unzipSync, strFromU8 } from "fflate";

const SHEET_PATH = "xl/worksheets/sheet1.xml";
const STRINGS_PATH = "xl/sharedStrings.xml";

function unescapeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Reads column B (account number) from a KBIZ beneficiary xlsx (rows 4+).
 * Handles both shared-string (t="s") and inline-string (t="inlineStr") cells,
 * matching the formats payroll-form's buildBeneficiaryWorkbook produces.
 */
export function readBeneficiaryAccountNumbers(xlsxPath: string): string[] {
  const buf = readFileSync(xlsxPath);
  const files = unzipSync(new Uint8Array(buf));

  const sheet = strFromU8(files[SHEET_PATH]);
  const stringsXml = files[STRINGS_PATH] ? strFromU8(files[STRINGS_PATH]) : "";

  // Parse <si>...<t>VALUE</t>...</si> entries in order
  const sst: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(stringsXml))) {
    const tMatch = m[1].match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
    sst.push(tMatch ? unescapeXml(tMatch[1]) : "");
  }

  // Find B-column cells in data rows
  const out: string[] = [];
  const cellRe = /<c r="B(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
  while ((m = cellRe.exec(sheet))) {
    const row = parseInt(m[1], 10);
    if (row < 4) continue;
    const attrs = m[2] ?? "";
    const inner = m[3] ?? "";
    if (!inner) continue;
    if (/t="s"/.test(attrs)) {
      const vMatch = inner.match(/<v>(\d+)<\/v>/);
      if (vMatch) out.push(sst[parseInt(vMatch[1], 10)] ?? "");
    } else if (/t="inlineStr"/.test(attrs)) {
      const tMatch = inner.match(/<t\b[^>]*>([\s\S]*?)<\/t>/);
      if (tMatch) out.push(unescapeXml(tMatch[1]));
    } else {
      const vMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
      if (vMatch) out.push(unescapeXml(vMatch[1]));
    }
  }
  return out.filter(Boolean);
}
