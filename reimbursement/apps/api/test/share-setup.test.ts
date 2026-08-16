import { describe, expect, test } from 'bun:test';
import { buildShareSetup } from '../src/share_setup';

/**
 * The setup payload served to an authenticated employee.
 *
 * The rule that matters is **both or neither**: a half-configured pair cannot
 * authenticate anything, and reporting `configured: true` with a missing secret
 * would send somebody off to build a Shortcut that answers 403 with no clue
 * why. The other half is that an unconfigured deploy degrades to the old
 * ask-your-admin path rather than leaking an empty credential.
 */

const FULL = {
  WEB_BASE_URL: 'https://reimbursement.thehfhotel.org',
  CF_SHARE_CLIENT_ID: 'abc123.access',
  CF_SHARE_CLIENT_SECRET: 'sekrit',
};

describe('buildShareSetup', () => {
  test('reports configured when both values are present', () => {
    const setup = buildShareSetup(FULL);
    expect(setup.configured).toBe(true);
    expect(setup.clientId).toBe('abc123.access');
    expect(setup.clientSecret).toBe('sekrit');
  });

  test('builds the upload URL that routes/inbox.ts actually serves', () => {
    expect(buildShareSetup(FULL).uploadUrl).toBe(
      'https://reimbursement.thehfhotel.org/api/inbox/quick',
    );
  });

  test('does not double the slash when the base URL has a trailing one', () => {
    expect(buildShareSetup({ ...FULL, WEB_BASE_URL: 'https://x.example.org/' }).uploadUrl).toBe(
      'https://x.example.org/api/inbox/quick',
    );
  });

  test('strips several trailing slashes', () => {
    expect(buildShareSetup({ ...FULL, WEB_BASE_URL: 'https://x.example.org///' }).uploadUrl).toBe(
      'https://x.example.org/api/inbox/quick',
    );
  });

  test('falls back to the production base URL when none is set', () => {
    const { WEB_BASE_URL: _omitted, ...rest } = FULL;
    expect(buildShareSetup(rest).uploadUrl).toBe(
      'https://reimbursement.thehfhotel.org/api/inbox/quick',
    );
  });

  // Both-or-neither. Each half alone is useless and must not be advertised.
  test.each([
    ['only the id', { WEB_BASE_URL: FULL.WEB_BASE_URL, CF_SHARE_CLIENT_ID: 'abc123.access' }],
    ['only the secret', { WEB_BASE_URL: FULL.WEB_BASE_URL, CF_SHARE_CLIENT_SECRET: 'sekrit' }],
    ['neither', { WEB_BASE_URL: FULL.WEB_BASE_URL }],
    ['an empty id', { ...FULL, CF_SHARE_CLIENT_ID: '' }],
    ['an empty secret', { ...FULL, CF_SHARE_CLIENT_SECRET: '' }],
    ['a whitespace-only secret', { ...FULL, CF_SHARE_CLIENT_SECRET: '   ' }],
  ])('reports unconfigured with %s', (_label, env) => {
    const setup = buildShareSetup(env);
    expect(setup.configured).toBe(false);
    // Never hand out half a credential — the UI keys off these being null.
    expect(setup.clientId).toBeNull();
    expect(setup.clientSecret).toBeNull();
  });

  test('still returns a usable upload URL when unconfigured', () => {
    // The URL is not secret and the setup page shows it either way.
    expect(buildShareSetup({}).uploadUrl).toBe(
      'https://reimbursement.thehfhotel.org/api/inbox/quick',
    );
  });

  test('trims incidental whitespace around the values', () => {
    const setup = buildShareSetup({
      ...FULL,
      CF_SHARE_CLIENT_ID: '  abc123.access  ',
      CF_SHARE_CLIENT_SECRET: '\tsekrit\n',
    });
    expect(setup.clientId).toBe('abc123.access');
    expect(setup.clientSecret).toBe('sekrit');
  });

  test('accepts a real process.env-shaped object', () => {
    // Guards the index signature: the production call site passes process.env,
    // which carries hundreds of unrelated keys.
    expect(buildShareSetup({ ...process.env, ...FULL }).configured).toBe(true);
  });
});
