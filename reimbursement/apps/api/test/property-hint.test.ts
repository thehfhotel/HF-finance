// The estate band's `data-property` hint: which desk the caller is standing at.
//
// The rule is subtle and load-bearing, so it is pinned here rather than left to
// a reading of the map: ONLY the HF Ville reception kiosk names a place.
// Everyone else — including HF's own reception mailbox, which also runs as a
// second Chrome profile on the HF Ville PC — must yield no hint, and therefore
// no attribute and the full switcher.
//
// Pure: no database, no network, no Cloudflare. Runs in every CI job.

import { afterEach, describe, expect, test } from 'bun:test';
import { kioskPropertyEmails, propertyHintForEmail } from '../src/property_hint';

const VILLE_RECEPTION = 'hfville.hotel@gmail.com';
const HF_RECEPTION = 'theharbourfront.hotel@gmail.com';
const OFFICE_PC = 'sdyoffice66@gmail.com';

/** The env var this module reads. Cleared after every test. */
const OVERRIDE = 'KIOSK_PROPERTY_EMAILS';

afterEach(() => {
  delete process.env[OVERRIDE];
});

describe('propertyHintForEmail — who names a place', () => {
  test('scopes the HF Ville reception kiosk, the one identity that sits at one desk', () => {
    expect(propertyHintForEmail(VILLE_RECEPTION)).toBe('hfville');
  });

  test("tolerates Cloudflare's casing and padding", () => {
    expect(propertyHintForEmail('  HFVille.Hotel@Gmail.com  ')).toBe('hfville');
  });

  test("never scopes HF's reception identity — it also runs on the HF Ville desk", () => {
    // Scoping it to 'hf' would hide HF VILLE's own Room Daily Report at the HF
    // Ville desk, which is this feature's bug seen from the other side.
    expect(propertyHintForEmail(HF_RECEPTION)).toBeUndefined();
  });

  test('never scopes the office PC, which works both properties', () => {
    expect(propertyHintForEmail(OFFICE_PC)).toBeUndefined();
  });

  test('never scopes managers, employees or unknown identities', () => {
    expect(propertyHintForEmail('winut.hf@gmail.com')).toBeUndefined();
    // LINE employees arrive as the synthetic HF-ID address.
    expect(propertyHintForEmail('Q0007@emp.thehfhotel.org')).toBeUndefined();
    expect(propertyHintForEmail('stranger@example.com')).toBeUndefined();
  });

  test('yields no hint for an unauthenticated or empty identity', () => {
    expect(propertyHintForEmail(null)).toBeUndefined();
    expect(propertyHintForEmail(undefined)).toBeUndefined();
    expect(propertyHintForEmail('')).toBeUndefined();
    expect(propertyHintForEmail('   ')).toBeUndefined();
  });
});

describe('KIOSK_PROPERTY_EMAILS — the override, and the value it must never take', () => {
  test('defaults to the HF Ville desk alone when unset or empty', () => {
    expect([...kioskPropertyEmails()]).toEqual([[VILLE_RECEPTION, 'hfville']]);
    process.env[OVERRIDE] = '   '; // compose materializes an unset var as empty
    expect([...kioskPropertyEmails()]).toEqual([[VILLE_RECEPTION, 'hfville']]);
  });

  test('REFUSES the KIOSK_EMAILS value — the trap this separate name exists to prevent', () => {
    // deploy-reimbursement.yml's KIOSK_EMAILS answers a different question
    // ("is this a shared terminal?") and maps BOTH reception mailboxes as
    // `email=kiosk-id`. Pasted in here it must scope NOBODY — above all it must
    // not scope HF's dual-desk identity to 'hf'.
    process.env[OVERRIDE] =
      'theharbourfront.hotel@gmail.com=reception-1,hfville.hotel@gmail.com=hfville-reception-1';
    expect([...kioskPropertyEmails()]).toEqual([]);
    expect(propertyHintForEmail(HF_RECEPTION)).toBeUndefined();
    expect(propertyHintForEmail(VILLE_RECEPTION)).toBeUndefined();
  });

  test('drops half-written and unknown-property entries rather than guessing', () => {
    process.env[OVERRIDE] = 'hfville:,:someone@example.com,mars:someone@example.com,hfville:ok@example.com';
    expect([...kioskPropertyEmails()]).toEqual([['ok@example.com', 'hfville']]);
  });

  test('is read fresh on every call, so a restart with a changed env is honoured', () => {
    process.env[OVERRIDE] = 'hf:desk@example.com';
    expect(propertyHintForEmail('desk@example.com')).toBe('hf');
    delete process.env[OVERRIDE];
    expect(propertyHintForEmail('desk@example.com')).toBeUndefined();
  });
});
