// Name agreement between an operator's entry and the bank's record.
// KBIZ always wins on the stored spelling — this only decides whether the
// two describe the same person, so a real disagreement gets surfaced.
// Cases below are drawn from the live roster. Run with `bun test`.

import { describe, expect, it } from "bun:test";
import { namesAgree, normalizePersonName } from "../src/names";

describe("normalizePersonName", () => {
  it("strips honorific, dots and spaces", () => {
    expect(normalizePersonName("น.ส. สลิลทิพย์ เพชรรักษ์")).toBe("สลิลทิพย์เพชรรักษ์");
    expect(normalizePersonName("นางสาวสลิลทิพย์ เพชรรักษ์")).toBe("สลิลทิพย์เพชรรักษ์");
  });

  it("leaves a name with no honorific alone", () => {
    expect(normalizePersonName("วิณัฐ จิรฤกษ์มงคล")).toBe("วิณัฐจิรฤกษ์มงคล");
  });

  it("strips only one honorific, so a name starting like one survives", () => {
    // "นารี" begins with นา but is not an honorific; นาย must not eat into it.
    expect(normalizePersonName("นางนารี ทองดี")).toBe("นารีทองดี");
  });

  it("is empty for a blank name", () => {
    expect(normalizePersonName("")).toBe("");
    expect(normalizePersonName("   ")).toBe("");
  });
});

describe("namesAgree", () => {
  it("accepts abbreviated vs written-out honorifics", () => {
    expect(namesAgree("น.ส. กฤษณา บุญนาค", "นางสาวกฤษณา บุญนาค")).toBe(true);
  });

  it("accepts a changed honorific — marriage is not a different person", () => {
    expect(namesAgree("น.ส. วราภรณ์ วังนรา", "นางวราภรณ์ วังนรา")).toBe(true);
  });

  it("accepts differing internal spacing", () => {
    expect(namesAgree("นาย นรพนธ์ ศิริศิลป์มานะกุล", "นายนรพนธ์ ศิริศิลป์ มานะกุล")).toBe(true);
  });

  it("rejects a dropped tone mark", () => {
    expect(namesAgree("นาย เชิดพงษ์ หมั่นถนอม", "นายเชิดพงษ์ หมันถนอม")).toBe(false);
  });

  it("rejects a doubled character and changed tone", () => {
    expect(namesAgree("น.ส. อุไรวรรณ รอดสั้น", "นางสาวอุไรวรรรณ รอดสัน")).toBe(false);
  });

  it("rejects a genuinely different given name", () => {
    // The live roster's sharpest case: กมลวรรณ vs กนกวรรณ, same surname.
    expect(namesAgree("น.ส. กมลวรรณ สังข์แก้ว", "นางสาวกนกวรรณ สังข์แก้ว")).toBe(false);
  });

  it("never agrees when either side is blank", () => {
    expect(namesAgree("", "นางสาวกฤษณา บุญนาค")).toBe(false);
    expect(namesAgree("น.ส. กฤษณา บุญนาค", "")).toBe(false);
    // An honorific on its own carries no identity.
    expect(namesAgree("น.ส.", "นางสาว")).toBe(false);
  });
});
