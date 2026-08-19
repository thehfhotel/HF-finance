// The reconciler's classification rule, pinned pure — no Postgres needed for
// the part that actually decides anything.
//
// `classifyOutcome` is the FIRST thing `reconcile()` calls on a terminal
// intent, and it is the one place a new `result.outcome` member could slip
// through unrecognised. Before 2026-08-19 (inv:contract D1) it compared
// `outcome` against three hand-written string literals with no link back to
// the contract at all — `push-expired`, added the same day, would have
// tripped ZERO tests and ZERO type errors here, and this reconciler would
// have kept treating it as `unconfirmed` forever. `HANDLED_OUTCOMES` is now a
// `Record` over the contract's own `KbizOutcome` type, so a member the
// contract adds without a matching entry here is a `bun run typecheck`
// failure — and the last test below is the TEXT twin of that compile gate
// (mirroring kbiz-bot's `CONTRACT_OUTCOMES` in shared-contract.ts), so the
// same drift is caught even if a future change slips past `tsc`.
//
// This is the first poller test in the repo. It stays pure on purpose: no
// `prisma`, no `TEST_DATABASE_URL` gate — `classifyOutcome` takes a plain
// object and returns a string, so nothing here needs a database to be
// meaningful.
//
// IMPORTED FROM `../src/kbiz-outcomes`, NOT `../src/kbiz-poller` (spec-review
// finding 1, 2026-08-19 fix round): `kbiz-poller.ts` imports `./db`, which
// imports `@prisma/adapter-pg` at RUNTIME — a dependency that does not exist
// until `apps/api/node_modules` is installed. Root `bun test` (the gate BOTH
// `deploy.yml`'s `test` job and `deploy-reimbursement.yml`'s `contract` job
// run) discovers this file with no workspace install first. The guard below
// pins that: it fails loudly if this module ever grows a runtime import that
// would reintroduce the same break.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'bun:test';
import type { KbizPaymentIntent } from '@reimbursement/shared';
import { classifyOutcome, HANDLED_OUTCOMES } from '../src/kbiz-outcomes';

describe('root-CI purity: kbiz-outcomes.ts stays dependency-free', () => {
  it('imports nothing but types — no ./db, no @prisma, no runtime import at all', () => {
    const src = readFileSync(fileURLToPath(new URL('../src/kbiz-outcomes.ts', import.meta.url)), 'utf8');
    const valueImports = [...src.matchAll(/^import\s+(?!type\s)[^;]*from\s+['"]([^'"]+)['"];?/gm)].map((m) => m[1]);
    expect(valueImports).toEqual([]);
  });
});

/**
 * `classifyOutcome` only ever reads `.status` and `.result?.outcome` — every
 * other field on `KbizPaymentIntent` is queue-write metadata this function
 * never touches. Cast rather than fill in `payee`/`memo`/`kbizCategoryId`/etc
 * with meaningless values: the point of this fixture is that classification
 * does NOT depend on them.
 */
function intent(fields: { status: KbizPaymentIntent['status']; result?: KbizPaymentIntent['result'] }): KbizPaymentIntent {
  return {
    id: 'pi_test',
    app: 'reimbursement',
    type: 'transfer-other',
    createdAt: new Date().toISOString(),
    bundleId: 'bundle_test',
    ...fields,
  } as unknown as KbizPaymentIntent;
}

describe('classifyOutcome — what actually happened, erring towards "a human should look at this"', () => {
  it('reads a declared push-expired result straight through', () => {
    expect(classifyOutcome(intent({ status: 'failed', result: { outcome: 'push-expired' } }))).toBe('push-expired');
  });

  it('falls back SAFELY to confirmed-failed on an outcome the contract does not (yet) declare', () => {
    // Simulates the exact gap this file exists to close: a producer bug, a
    // hand-edited queue file, or a future contract member this reconciler was
    // never taught. `in HANDLED_OUTCOMES` rejects the unknown string, and the
    // function falls through to the SAME rule an absent `result` gets —
    // `status: 'failed'` reads as "finished, nothing moved" — never
    // `unconfirmed`, which would needlessly page a human over a status the
    // queue itself already proves is safe.
    const rogue = { outcome: 'reversed' } as unknown as NonNullable<KbizPaymentIntent['result']>;
    expect(classifyOutcome(intent({ status: 'failed', result: rogue }))).toBe('confirmed-failed');
  });

  it('needs-review with no result is unconfirmed — a human already flagged it', () => {
    expect(classifyOutcome(intent({ status: 'needs-review' }))).toBe('unconfirmed');
  });

  it('failed with no result is confirmed-failed — the HELD/defer path', () => {
    // process-queue.ts's arm gate writes a HELD `result.error` with no
    // `outcome` when it defers a batch item pre-arm (never armed, so no
    // outcome to report). classifyOutcome must still read that as "nothing
    // moved, retryable" — the same fallback rule as the test above — or a
    // deferred item would wrongly page a human on every sweep.
    expect(classifyOutcome(intent({ status: 'failed' }))).toBe('confirmed-failed');
  });
});

// ── the contract's own declaration, read as TEXT ────────────────────────────
// The reimbursement-side twin of kbiz-bot/src/lib/shared-contract.ts's
// `CONTRACT_OUTCOMES` check: HANDLED_OUTCOMES is derived from the contract
// TYPE (so `tsc` enforces it), but a type evaporates at runtime and this repo
// has no shared unit test between the two packages — so read the shared
// SOURCE as text and check its literals directly. Between this file and
// kbiz-bot's, the two repos cannot drift from the contract in either
// direction without a test going red.
const SHARED_SRC = new URL('../../../packages/shared/src/index.ts', import.meta.url);

/** Drop comments so doc-comment prose (which also names every outcome, in
 *  words) can't be mistaken for the declaration itself. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * The string literals of `result.outcome`'s inline union.
 *
 * `outcome:` occurs exactly once in code in the shared source (index.ts:549)
 * — stripComments removes the two other mentions, which are doc-comment
 * prose above the field. Verified 2026-08-19.
 */
function outcomeLiterals(src: string): string[] {
  const stripped = stripComments(src);
  const at = stripped.indexOf('outcome:');
  if (at === -1) throw new Error('shared contract no longer declares `outcome:`');
  const from = at + 'outcome:'.length;
  const end = stripped.indexOf(';', from);
  const body = end === -1 ? stripped.slice(from) : stripped.slice(from, end);
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('HANDLED_OUTCOMES matches the shared contract', () => {
  it('names every literal in the shared source\'s outcome: union, and no other', () => {
    const src = readFileSync(SHARED_SRC, 'utf8');
    expect(Object.keys(HANDLED_OUTCOMES).sort()).toEqual(outcomeLiterals(src).sort());
  });

  // Proves the check above actually bites, the same way shared-contract.test
  // proves its own text checks bite — feed it a mutated contract rather than
  // editing the real shared package.
  it('would fail on a new contract outcome nobody taught this file about', () => {
    const extended = readFileSync(SHARED_SRC, 'utf8').replace(
      "'success' | 'confirmed-failed' | 'unconfirmed' | 'push-expired'",
      "'success' | 'confirmed-failed' | 'unconfirmed' | 'push-expired' | 'reversed'",
    );
    expect(outcomeLiterals(extended)).toContain('reversed');
    expect(Object.keys(HANDLED_OUTCOMES)).not.toContain('reversed');
  });
});
