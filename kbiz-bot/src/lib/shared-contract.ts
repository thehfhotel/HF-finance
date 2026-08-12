/**
 * PARITY IS DEAD — the bot no longer keeps a hand-written copy of the KBIZ
 * queue contract to sync by eye ("mirrors …, keep the names in lockstep"). It
 * imports the real thing from `reimbursement/packages/shared/src/index.ts`
 * (see tsconfig `paths`), and this file documents what that buys.
 *
 * READ THIS BEFORE TRUSTING ANYTHING BELOW. Two limits, both real:
 *
 * 1. CI DOES NOT RUN tsc. `.github/workflows/deploy.yml`'s `test` job runs
 *    `bun test` and nothing else, so every assertion in this file is checked
 *    only by `bunx tsc --noEmit -p tsconfig.json` (kbiz-bot's `typecheck`
 *    script) — locally, or in review. Until a typecheck step exists in the
 *    workflow, "it's a compile error" means "somebody has to compile it".
 *
 * 2. MOST OF THESE ASSERTIONS CANNOT FAIL. Where the bot's type is *defined as*
 *    the contract's (`QueueDestination = KbizDestination`,
 *    `TransferOtherQueueRequest extends Omit<KbizPaymentIntent, …>`), comparing
 *    the two compares a thing to itself. That is worth stating — it is the
 *    property we want, and it breaks loudly the day someone re-introduces a
 *    local copy — but it detects no drift, because a contract rename moves both
 *    sides at once. Each assertion is tagged below with what it actually
 *    catches. The two that bite a genuine contract change are
 *    `_FavoriteKeysAreExactlyTheContract` and `_KindsAreExactlyTheContract`.
 *
 * The drift that CI *does* catch lives in test/shared-contract.test.ts, which
 * reads the shared source as TEXT and compares the declared field names and
 * `kind` literals against the two exported lists at the bottom of this file.
 * That is the guard a renamed contract field trips today.
 *
 * Type-only by construction — imports nothing at runtime, emits nothing.
 */

import type { KbizDestination, KbizFavorite, KbizPaymentIntent } from "@reimbursement/shared";
import type { FavoritesManifest, KbizFavorite as BotFavorite, toFavorite } from "./favorites-core";
import type { parseDestination, QueueDestination, TransferOtherQueueRequest } from "./transfer-other-queue";

/** True only when A and B are the same type in BOTH directions. */
type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

/** Fails to compile unless its argument is exactly `true`. */
type Assert<T extends true> = T;

// ── the favorites manifest (bot writes, reimbursement reads) ───────────────
// All three hold BY CONSTRUCTION today: favorites-core re-exports the
// contract's type, and toFavorite is annotated `: KbizFavorite`. They fail only
// if someone re-declares a bot-local KbizFavorite or drops the return-type
// annotation — not if the contract renames a field.
type _FavoriteIsTheContract = Assert<Exact<BotFavorite, KbizFavorite>>;
type _ScrapedRowBecomesAContractFavorite = Assert<Exact<ReturnType<typeof toFavorite>, KbizFavorite>>;
type _ManifestPublishesContractFavorites = Assert<Exact<FavoritesManifest["favorites"], KbizFavorite[]>>;

// ── the destination (reimbursement writes, bot validates then obeys) ───────
// Also by construction: `QueueDestination` IS `KbizDestination`, and
// parseDestination is annotated with it. Catches a re-declared local union;
// catches nothing about the contract's own contents.
type _DestinationIsTheContract = Assert<Exact<QueueDestination, KbizDestination>>;
type _ValidationYieldsAContractDestination = Assert<Exact<ReturnType<typeof parseDestination>, KbizDestination>>;

// ── the intent itself ──────────────────────────────────────────────────────
// Everything the bot did NOT deliberately loosen must still be the contract's,
// field for field. `destination` (kept `unknown` — untrusted JSON) and
// `kbizCategoryId` (kept `string` — KBIZ owns the id space) are the two
// documented exceptions; `startedAt`/`completedAt`/`updatedAt` are bot-side
// bookkeeping the contract never described.
//
// This one has real (if narrow) teeth: because the interface EXTENDS the
// contract, the only way to break it is to add a bot-local field or re-type a
// shared one without listing it in the Omit above — which is exactly the
// regression that would put an undeclared field on the wire. It still says
// nothing about a rename on the reimbursement side.
type _IntentIsTheContract = Assert<
  Exact<
    Omit<TransferOtherQueueRequest, "destination" | "kbizCategoryId" | "startedAt" | "completedAt" | "updatedAt">,
    Omit<KbizPaymentIntent, "destination" | "kbizCategoryId">
  >
>;

// The bot must keep accepting every status and result the contract can produce.
// Inherited straight from the contract via the `extends` above, so these three
// are self-comparisons — kept as executable documentation of the intent, not as
// a drift detector.
type _StatusesMatch = Assert<Exact<TransferOtherQueueRequest["status"], KbizPaymentIntent["status"]>>;
type _ResultsMatch = Assert<Exact<TransferOtherQueueRequest["result"], KbizPaymentIntent["result"]>>;
type _PayeesMatch = Assert<Exact<TransferOtherQueueRequest["payee"], KbizPaymentIntent["payee"]>>;

// ── the two assertions that actually detect contract drift ─────────────────
// A TypeScript interface evaporates at runtime, so the lists below name the
// contract's vocabulary ONCE, as values. Unlike everything above they are
// hand-written, which is precisely why the `Exact` checks on them can fail:
// rename `KbizFavorite.accountLast4` upstream and the list no longer matches
// `keyof KbizFavorite`.
//
// These lists are ALSO what makes the drift visible to CI. They are hand-
// written, so on their own they would just agree with the bot's other
// hand-written code while both drifted from reimbursement — so
// test/shared-contract.test.ts reads the shared SOURCE as text and checks the
// declared field names and `kind` literals against them. That text check is
// the only one of the three gates (tsc / bun test / neither) that runs today.

/** Every field a published favorite carries. */
export const CONTRACT_FAVORITE_KEYS = ["nickname", "accountName", "bank", "accountMasked", "accountLast4"] as const;
type _FavoriteKeysAreExactlyTheContract = Assert<Exact<(typeof CONTRACT_FAVORITE_KEYS)[number], keyof KbizFavorite>>;

/** Every destination kind the bot must be able to pay. */
export const CONTRACT_DESTINATION_KINDS = ["handle", "favorite", "custom"] as const;
type _KindsAreExactlyTheContract = Assert<Exact<(typeof CONTRACT_DESTINATION_KINDS)[number], KbizDestination["kind"]>>;
