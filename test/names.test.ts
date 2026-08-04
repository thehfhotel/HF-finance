// Name agreement between an operator's entry and the bank's record.
// KBIZ always wins on the stored spelling — this only decides whether the
// two describe the same person, so a real disagreement gets surfaced.
// Cases below are drawn from the live roster. Run with `bun test`.

import { describe, expect, it } from "bun:test";
import { namesAgree, normalizePersonName } from "../src/names";

describe("normalizePersonName", () => {
  it("strips honorific, dots and spaces", () => {
    expect(normalizePersonName("น.ส. ทดสอบ ตัวอย่าง")).toBe("ทดสอบตัวอย่าง");
    expect(normalizePersonName("นางสาวทดสอบ ตัวอย่าง")).toBe("ทดสอบตัวอย่าง");
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
    expect(namesAgree("น.ส. ทดสองสอง ตัวอย่าง", "นางสาวทดสองสอง ตัวอย่าง")).toBe(true);
  });

  it("accepts a changed honorific — marriage is not a different person", () => {
    expect(namesAgree("น.ส. ทดสามสาม ตัวอย่างสอง", "นางทดสามสาม ตัวอย่างสอง")).toBe(true);
  });

  it("accepts differing internal spacing", () => {
    expect(namesAgree("นาย ทดหกหก ตัวอย่างมานะกุล", "นายทดหกหก ตัวอย่าง มานะกุล")).toBe(true);
  });

  it("rejects a dropped tone mark", () => {
    expect(namesAgree("นาย ทดสี่สี่ มั่นคง", "นายทดสี่สี่ มันคง")).toBe(false);
  });

  it("rejects a doubled character and changed tone", () => {
    expect(namesAgree("น.ส. ทดห้าห้า วรรณดี", "นางสาวทดห้าห้า วรรรณดี")).toBe(false);
  });

  it("rejects a genuinely different given name", () => {
    // The live roster's sharpest case: มานีวรรณ vs มานะวรรณ, same surname.
    expect(namesAgree("น.ส. มานีวรรณ สังข์ทอง", "นางสาวมานะวรรณ สังข์ทอง")).toBe(false);
  });

  it("never agrees when either side is blank", () => {
    expect(namesAgree("", "นางสาวทดสองสอง ตัวอย่าง")).toBe(false);
    expect(namesAgree("น.ส. ทดสองสอง ตัวอย่าง", "")).toBe(false);
    // An honorific on its own carries no identity.
    expect(namesAgree("น.ส.", "นางสาว")).toBe(false);
  });
});
