// The estate band's `data-property` hint: which desk the caller is standing at,
// and the ONE script tag that carries it. Pure functions — no server, no
// network. Run with `bun test`.
//
// The rule under test is subtle and load-bearing: ONLY the HF Ville reception
// kiosk names a place. Everyone else — including HF's own reception mailbox,
// which also runs as a second Chrome profile on the HF Ville PC — must get no
// attribute and therefore the full switcher.

import { afterEach, describe, expect, it } from "bun:test";
import {
  ACCESS_EMAIL_HEADER,
  kioskPropertyEmails,
  propertyHintForEmail,
  propertyHintFromHeaders,
} from "../src/property-hint";
import { HF_BAR_PLACEHOLDER, hfBarScriptTag } from "../src/views/hf-bar";
import { MAIN_HTML } from "../src/views/main";
import { APPROVALS_HTML } from "../src/views/approvals";
import { STATUS_HTML } from "../src/views/status";
import { ACCOUNTS_HTML } from "../src/views/accounts";
import { WORKSHEET_HTML } from "../src/views/worksheet";

const VILLE_RECEPTION = "hfville.hotel@gmail.com";
const HF_RECEPTION = "theharbourfront.hotel@gmail.com";
const OFFICE_PC = "sdyoffice66@gmail.com";

/** The env var payroll actually reads. Cleared after every test. */
const OVERRIDE = "KIOSK_PROPERTY_EMAILS";

afterEach(() => {
  delete process.env[OVERRIDE];
});

/** A stand-in for the header bag Elysia hands a route (lowercased keys). */
function headersWith(email: string | undefined): Record<string, string | undefined> {
  return email === undefined ? {} : { [ACCESS_EMAIL_HEADER]: email };
}

describe("propertyHintForEmail — who names a place", () => {
  it("scopes the HF Ville reception kiosk, the one identity that sits at one desk", () => {
    expect(propertyHintForEmail(VILLE_RECEPTION)).toBe("hfville");
  });

  it("tolerates the casing and padding Cloudflare's header arrives in", () => {
    expect(propertyHintForEmail("  HFVille.Hotel@Gmail.com  ")).toBe("hfville");
  });

  it("never scopes HF's reception identity — it also runs on the HF Ville desk", () => {
    // Scoping it to "hf" would hide HF VILLE's own Room Daily Report at the HF
    // Ville desk, which is this feature's bug seen from the other side.
    expect(propertyHintForEmail(HF_RECEPTION)).toBeUndefined();
  });

  it("never scopes the office PC, which works both properties", () => {
    expect(propertyHintForEmail(OFFICE_PC)).toBeUndefined();
  });

  it("never scopes managers, employees or unknown identities", () => {
    expect(propertyHintForEmail("winut.hf@gmail.com")).toBeUndefined();
    expect(propertyHintForEmail("somsri@emp.thehfhotel.org")).toBeUndefined();
    expect(propertyHintForEmail("stranger@example.com")).toBeUndefined();
  });

  it("yields no hint for an unauthenticated or empty identity", () => {
    expect(propertyHintForEmail(null)).toBeUndefined();
    expect(propertyHintForEmail(undefined)).toBeUndefined();
    expect(propertyHintForEmail("")).toBeUndefined();
    expect(propertyHintForEmail("   ")).toBeUndefined();
  });
});

describe("propertyHintFromHeaders — reading the request", () => {
  it("reads the Cloudflare Access identity header", () => {
    expect(ACCESS_EMAIL_HEADER).toBe("cf-access-authenticated-user-email");
    expect(propertyHintFromHeaders(headersWith(VILLE_RECEPTION))).toBe("hfville");
    expect(propertyHintFromHeaders(headersWith(HF_RECEPTION))).toBeUndefined();
  });

  it("fails open when the header is absent — an unauthenticated caller", () => {
    expect(propertyHintFromHeaders(headersWith(undefined))).toBeUndefined();
  });

  it("fails open, never throws, when the header bag is missing or hostile", () => {
    expect(propertyHintFromHeaders(null)).toBeUndefined();
    expect(propertyHintFromHeaders(undefined)).toBeUndefined();
    const throwingBag = new Proxy({} as Record<string, string | undefined>, {
      get() {
        throw new Error("header bag exploded");
      },
    });
    expect(propertyHintFromHeaders(throwingBag)).toBeUndefined();
  });
});

describe("KIOSK_PROPERTY_EMAILS — the override, and the value it must never take", () => {
  it("defaults to the HF Ville desk alone when unset or empty", () => {
    expect([...kioskPropertyEmails()]).toEqual([[VILLE_RECEPTION, "hfville"]]);
    process.env[OVERRIDE] = "   "; // compose materializes an unset var as empty
    expect([...kioskPropertyEmails()]).toEqual([[VILLE_RECEPTION, "hfville"]]);
  });

  it("REFUSES the KIOSK_EMAILS value — the trap this separate name exists to prevent", () => {
    // deploy-reimbursement.yml's KIOSK_EMAILS answers a different question and
    // maps BOTH reception mailboxes as `email=kiosk-id`. Pasted in here it must
    // scope NOBODY, not scope HF's dual-desk identity to "hf".
    process.env[OVERRIDE] =
      "theharbourfront.hotel@gmail.com=reception-1,hfville.hotel@gmail.com=hfville-reception-1";
    expect([...kioskPropertyEmails()]).toEqual([]);
    expect(propertyHintForEmail(HF_RECEPTION)).toBeUndefined();
    expect(propertyHintForEmail(VILLE_RECEPTION)).toBeUndefined();
  });

  it("drops half-written and unknown-property entries rather than guessing", () => {
    process.env[OVERRIDE] = "hfville:,:someone@example.com,mars:someone@example.com,hfville:ok@example.com";
    expect([...kioskPropertyEmails()]).toEqual([["ok@example.com", "hfville"]]);
  });

  it("is read fresh on every call, so a restart with a changed env is honoured", () => {
    process.env[OVERRIDE] = "hf:desk@example.com";
    expect(propertyHintForEmail("desk@example.com")).toBe("hf");
    delete process.env[OVERRIDE];
    expect(propertyHintForEmail("desk@example.com")).toBeUndefined();
  });
});

describe("hfBarScriptTag — the one definition of the band", () => {
  it("carries data-property when the caller's desk is known", () => {
    expect(hfBarScriptTag("hfville")).toContain(' data-property="hfville"');
  });

  it("OMITS data-property entirely when there is no hint — never present-and-empty", () => {
    const tag = hfBarScriptTag(undefined);
    expect(tag).not.toContain("data-property");
    expect(tag).toBe(
      '<script defer src="https://erp.thehfhotel.org/shell/hf-bar.js" data-app="Payroll" data-module="finance"></script>',
    );
  });

  it("keeps the app and module identity the switcher highlights", () => {
    for (const tag of [hfBarScriptTag(undefined), hfBarScriptTag("hfville")]) {
      expect(tag).toContain('src="https://erp.thehfhotel.org/shell/hf-bar.js"');
      expect(tag).toContain('data-app="Payroll"');
      expect(tag).toContain('data-module="finance"');
    }
  });
});

describe("every payroll page defers to that one definition", () => {
  const PAGES: ReadonlyArray<readonly [string, string]> = [
    ["main", MAIN_HTML],
    ["approvals", APPROVALS_HTML],
    ["status", STATUS_HTML],
    ["accounts", ACCOUNTS_HTML],
    ["worksheet", WORKSHEET_HTML],
  ];

  it.each(PAGES)("%s carries exactly one placeholder", (_name, html) => {
    expect(html.split(HF_BAR_PLACEHOLDER).length - 1).toBe(1);
  });

  it.each(PAGES)("%s hard-codes no script tag of its own", (_name, html) => {
    // The regression this whole change exists to prevent: a page growing its
    // own copy of the tag, which would silently never carry the hint.
    expect(html).not.toContain("hf-bar.js");
  });

  it.each(PAGES)("%s puts the band last, immediately before </body>", (_name, html) => {
    expect(html).toContain(`${HF_BAR_PLACEHOLDER}\n</body>`);
  });
});
