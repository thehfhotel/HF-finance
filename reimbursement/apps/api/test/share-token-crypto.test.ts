import { describe, expect, test } from 'bun:test';
import {
  HINT_LENGTH,
  TOKEN_BYTES,
  TOKEN_PREFIX,
  generateShareToken,
  hashShareToken,
  looksLikeShareToken,
} from '../src/share_token_crypto';

/**
 * Share-token crypto — the rules that decide whether a phone's credential is
 * accepted.
 *
 * These are the highest-value tests in the feature: `POST /api/inbox/quick` is
 * reachable from the open internet with nothing but this token, so a widened
 * `looksLikeShareToken` or a hash that stops being a hash is a direct
 * authentication bypass rather than a cosmetic bug.
 */

describe('hashShareToken', () => {
  test('is deterministic', () => {
    expect(hashShareToken('hfr_abc')).toBe(hashShareToken('hfr_abc'));
  });

  test('produces a 64-char hex SHA-256 digest', () => {
    expect(hashShareToken('hfr_abc')).toMatch(/^[0-9a-f]{64}$/);
  });

  test('differs for inputs one character apart', () => {
    expect(hashShareToken('hfr_abc')).not.toBe(hashShareToken('hfr_abd'));
  });

  test('never returns the input — the plaintext must not survive hashing', () => {
    const token = generateShareToken().token;
    const hash = hashShareToken(token);
    expect(hash).not.toBe(token);
    expect(hash).not.toContain(token.slice(TOKEN_PREFIX.length));
  });
});

describe('generateShareToken', () => {
  test('carries the greppable prefix', () => {
    expect(generateShareToken().token.startsWith(TOKEN_PREFIX)).toBe(true);
  });

  test('has the full entropy budget — 32 bytes as 64 hex chars', () => {
    const { token } = generateShareToken();
    expect(token.slice(TOKEN_PREFIX.length)).toHaveLength(TOKEN_BYTES * 2);
  });

  test('hint is a prefix of the random part, and short enough to not be the secret', () => {
    const { token, hint } = generateShareToken();
    expect(hint).toHaveLength(HINT_LENGTH);
    expect(token.slice(TOKEN_PREFIX.length).startsWith(hint)).toBe(true);
  });

  test('tokenHash matches hashing the plaintext', () => {
    const { token, tokenHash } = generateShareToken();
    expect(tokenHash).toBe(hashShareToken(token));
  });

  test('never repeats across many draws', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i += 1) seen.add(generateShareToken().token);
    expect(seen.size).toBe(500);
  });

  test('its own output always passes the shape check', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(looksLikeShareToken(generateShareToken().token)).toBe(true);
    }
  });
});

describe('looksLikeShareToken', () => {
  const valid = `${TOKEN_PREFIX}${'a'.repeat(TOKEN_BYTES * 2)}`;

  test('accepts a well-formed token', () => {
    expect(looksLikeShareToken(valid)).toBe(true);
  });

  test.each([
    ['empty string', ''],
    ['prefix only', TOKEN_PREFIX],
    ['no prefix', 'a'.repeat(TOKEN_BYTES * 2)],
    ['wrong prefix', `ghp_${'a'.repeat(TOKEN_BYTES * 2)}`],
    ['too short by one', `${TOKEN_PREFIX}${'a'.repeat(TOKEN_BYTES * 2 - 1)}`],
    ['too long by one', `${TOKEN_PREFIX}${'a'.repeat(TOKEN_BYTES * 2 + 1)}`],
    ['uppercase hex', `${TOKEN_PREFIX}${'A'.repeat(TOKEN_BYTES * 2)}`],
    ['non-hex characters', `${TOKEN_PREFIX}${'z'.repeat(TOKEN_BYTES * 2)}`],
    ['an app session JWT', 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ4In0.sig'],
  ])('rejects %s', (_label, candidate) => {
    expect(looksLikeShareToken(candidate)).toBe(false);
  });

  test('rejects a token with leading whitespace — callers must trim, not this', () => {
    expect(looksLikeShareToken(` ${valid}`)).toBe(false);
  });

  test('rejects SQL-ish and path-ish payloads outright', () => {
    expect(looksLikeShareToken("hfr_' OR 1=1--")).toBe(false);
    expect(looksLikeShareToken('hfr_../../etc/passwd')).toBe(false);
  });
});
