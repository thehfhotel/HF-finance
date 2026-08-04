// Comparing a Thai person-name typed by an operator against the bank's record.
//
// KBIZ is the source of truth for ชื่อบัญชี, so these helpers never decide
// which spelling to keep — they only decide whether the two agree, so a
// disagreement can be surfaced for someone to check.

// Honorifics carry no identity: the bank writes them out in full
// ("นางสาว") where operators abbreviate ("น.ส."), and switches นางสาว → นาง
// when someone marries. Matched against a string that already had its dots
// and spaces removed, longest-first so นางสาว wins over นาง.
const HONORIFIC = /^(นางสาว|นาง|นาย|นส|ดช|ดญ)/;

/**
 * Reduce a name to the part that actually identifies someone: no spaces, no
 * dots, no leading honorific. "น.ส. สลิลทิพย์ เพชรรักษ์" and
 * "นางสาวสลิลทิพย์ เพชรรักษ์" both reduce to "สลิลทิพย์เพชรรักษ์".
 */
export function normalizePersonName(name: string): string {
  // Stripped once, not repeatedly — a given name that merely starts with
  // นาย/นาง must survive.
  return String(name ?? "")
    .replace(/[\s.]/g, "")
    .replace(HONORIFIC, "");
}

/** True when both names are present and identify the same person. */
export function namesAgree(a: string, b: string): boolean {
  const x = normalizePersonName(a);
  const y = normalizePersonName(b);
  return x.length > 0 && y.length > 0 && x === y;
}
