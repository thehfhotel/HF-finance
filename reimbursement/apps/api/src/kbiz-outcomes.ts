import type { KbizPaymentIntent } from '@reimbursement/shared';

/**
 * The reconciler's classification rule, extracted into its OWN
 * dependency-free module (spec-review finding 1, 2026-08-19 fix round).
 *
 * WHY THIS FILE EXISTS AND NOT `kbiz-poller.ts`: `bun test` from the repo
 * root — the actual gate both `deploy.yml`'s `test` job and
 * `deploy-reimbursement.yml`'s `contract` job run — discovers EVERY test file
 * under the tree, including `reimbursement/apps/api/test/**`, with NO
 * `bun install --workspaces` step first (`deploy.yml:110-121` installs only
 * the root workspace). `kbiz-poller.ts` imports `./db`, which imports
 * `@prisma/adapter-pg` — a real runtime dependency that does not exist until
 * `apps/api/node_modules` is installed. A test that imported
 * `classifyOutcome`/`HANDLED_OUTCOMES` straight from `kbiz-poller.ts` (as the
 * first draft of `kbiz-poller.test.ts` did) passed locally, where that
 * node_modules dir happens to already exist, and would have failed the root
 * `bun test` job in CI with `Cannot find module '@prisma/adapter-pg'` —
 * reproduced by copying `apps/api/{src,test}` + `packages/shared` into a bare
 * dir with no node_modules. Exactly the class of bug
 * `kbiz-bot/test/approval-wait.test.ts:129-138`'s playwright-grep guard
 * exists to catch on the bot side; this module (plus the guard in
 * `kbiz-poller.test.ts`) is the reimbursement-side twin.
 *
 * `classifyOutcome` only ever reads `.status` and `.result?.outcome` — it
 * needs nothing else from `kbiz-poller.ts`, so nothing else moved.
 * `kbiz-poller.ts` re-exports both names unchanged; every existing import of
 * them from `'./kbiz-poller'` keeps working.
 */

/** Queue states that mean the bot has stopped working on an intent. */
export type KbizOutcome = NonNullable<KbizPaymentIntent['result']>['outcome'];

/**
 * Every outcome this reconciler knows how to apply, as a `Record` over the
 * CONTRACT's own union (not a hand-written copy of it) — so adding a member
 * to `KbizPaymentIntent['result']['outcome']` without teaching this file is a
 * COMPILE error, not a silent fall-through.
 *
 * 2026-08-19 audit (inv:contract D1): before this existed, `classifyOutcome`
 * compared `outcome` against three literal strings by hand. The local
 * `KbizOutcome` type alias above was ALSO hand-written, so it happily agreed
 * with the hand-written comparison while both quietly disagreed with the
 * shared contract — `push-expired` (added the same day) would have tripped
 * zero tests and zero type errors, and this reconciler would have kept
 * greenly treating it as `unconfirmed`. Deriving `KbizOutcome` from the
 * contract type closes that: the `Record` below now has to be exhaustive
 * over whatever the contract says `outcome` can be, so a new member fails
 * `bun run typecheck` here until someone adds it to this object. The
 * reimbursement-side test twin lives in apps/api/test/kbiz-poller.test.ts;
 * the kbiz-bot-side twin (comparing the SAME contract text against the
 * bot's own outcome vocabulary) lives in
 * kbiz-bot/src/lib/shared-contract.ts's `CONTRACT_OUTCOMES`.
 */
export const HANDLED_OUTCOMES: Record<KbizOutcome, true> = {
  success: true,
  'confirmed-failed': true,
  unconfirmed: true,
  'push-expired': true,
};

/**
 * What actually happened, erring towards "a human should look at this".
 *
 * The bot classifies its own attempts; when it did not (a crash before it could
 * write `result`), only the contract's `failed` — defined as "finished, nothing
 * moved" — is treated as safely retryable. Every other unclassified terminal
 * state is ambiguous by definition, and ambiguous means human. `outcome in
 * HANDLED_OUTCOMES` (rather than an `===` chain) means an outcome the contract
 * added but this file forgot to branch on still falls back SAFELY to this same
 * rule, instead of being handled by an accidental `undefined` comparison.
 */
export function classifyOutcome(intent: KbizPaymentIntent): KbizOutcome {
  const outcome = intent.result?.outcome;
  if (outcome !== undefined && outcome in HANDLED_OUTCOMES) return outcome;
  return intent.status === 'failed' ? 'confirmed-failed' : 'unconfirmed';
}
