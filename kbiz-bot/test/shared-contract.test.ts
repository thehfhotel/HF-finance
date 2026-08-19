// PARITY IS DEAD: the bot no longer keeps its own copy of the KBIZ queue
// contract, it imports reimbursement's (`@reimbursement/shared`, mapped in
// tsconfig at `../reimbursement/packages/shared/src/index.ts`).
//
// This file is the TEXT half of that guarantee, and it runs under `bun test`
// alone — no node_modules, no type information — which matters because the
// type-level assertions in src/lib/shared-contract.ts also run in CI
// (.github/workflows/deploy.yml's `test` job runs `bun run typecheck` for
// kbiz-bot at :138-140, gating both pipelines' deploys) but this file is what
// still catches the drift if that step is ever skipped or misconfigured.
// (2026-08-19: this file used to claim CI never runs `tsc` — corrected
// alongside shared-contract.ts's header in the same commit that added
// `CONTRACT_OUTCOMES`, so a false "nothing checks this" note could not sit
// next to the fix for the exact gap it was wrong about.) What follows must
// fail on its own for the drift that matters:
//
//   1. the shared module stops resolving (the mapping tsc, tsx and bun read);
//   2. what the bot PRODUCES stops matching the contract's own vocabulary;
//   3. the contract's own DECLARATIONS are renamed out from under the bot —
//      caught by reading the shared source as text, because a bot-local key
//      list and a bot-local object literal will happily agree with each other
//      while both disagree with reimbursement (that is exactly how a rename
//      used to sail through green).
//
// Run with `bun test` — from kbiz-bot/ or from the repo root; both resolve the
// mapping, and the repo root is how CI runs it.

import { readFileSync } from "node:fs";
import { describe, expect, it } from "bun:test";
import {
  KBIZ_FAVORITES_FILE,
  sanitizeKbizMemo,
  type KbizDestination,
  type KbizFavorite,
} from "@reimbursement/shared";
import { CONTRACT_DESTINATION_KINDS, CONTRACT_FAVORITE_KEYS, CONTRACT_OUTCOMES } from "../src/lib/shared-contract";
import { FAVORITES_FILE, toFavorite } from "../src/lib/favorites-core";
import { parseDestination } from "../src/lib/transfer-other-queue";

/**
 * The contract's source, located from THIS file rather than the cwd — `bun
 * test` runs from kbiz-bot/ locally and from the repo root in CI, and only
 * `import.meta.url` is the same in both.
 */
const SHARED_SRC = new URL("../../reimbursement/packages/shared/src/index.ts", import.meta.url);

/** Drop comments so doc-comment prose can't be mistaken for a declaration. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

/** Locate a declaration head, or say plainly that the contract moved. */
function headIndex(src: string, head: string): number {
  const at = src.indexOf(head);
  if (at === -1) throw new Error(`shared contract no longer declares \`${head}\``);
  return at + head.length;
}

/**
 * The `{ … }` block following a declaration head, braces included.
 * Deliberately dumb: if the shape ever gets complicated enough to break this,
 * the assertions below FAIL rather than silently pass.
 */
function braceBlockAfter(src: string, head: string): string {
  const from = headIndex(src, head);
  const open = src.indexOf("{", from);
  if (open === -1) throw new Error(`\`${head}\` is no longer a brace block`);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error(`unterminated brace block for \`${head}\``);
}

/** Everything after a declaration head up to the `;` that closes it at depth 0. */
function untilSemicolonAfter(src: string, head: string): string {
  const from = headIndex(src, head);
  let depth = 0;
  for (let i = from; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") depth--;
    else if (src[i] === ";" && depth === 0) return src.slice(from, i);
  }
  throw new Error(`unterminated declaration for \`${head}\``);
}

/** Field names declared directly on an interface body (never a nested one). */
function interfaceFieldNames(src: string, name: string): string[] {
  const body = braceBlockAfter(stripComments(src), `export interface ${name}`);
  const names: string[] = [];
  let depth = 0;
  for (const m of body.matchAll(/[{}]|([A-Za-z_$][\w$]*)\s*\??\s*:/g)) {
    if (m[0] === "{") depth++;
    else if (m[0] === "}") depth--;
    else if (depth === 1 && m[1]) names.push(m[1]);
  }
  return names;
}

/** The `kind` string literals of a discriminated-union type alias. */
function unionKindLiterals(src: string, name: string): string[] {
  const body = untilSemicolonAfter(stripComments(src), `export type ${name} =`);
  return [...body.matchAll(/\bkind\s*\??\s*:\s*['"]([^'"]+)['"]/g)].map((m) => m[1]!);
}

/**
 * The string literals of `result.outcome`'s inline union.
 *
 * `outcome:` occurs exactly once in code in the shared source (index.ts:549)
 * — the other two mentions ("`success` — slip/reference captured…" etc.) are
 * doc-comment prose above the field, which `stripComments` removes first.
 * Verified 2026-08-19.
 */
function outcomeLiterals(src: string): string[] {
  const body = untilSemicolonAfter(stripComments(src), "outcome:");
  return [...body.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe("the shared KBIZ contract is imported, not re-declared", () => {
  it("resolves @reimbursement/shared through the tsconfig paths mapping", () => {
    expect(typeof sanitizeKbizMemo).toBe("function");
    expect(KBIZ_FAVORITES_FILE).toBe("kbiz-favorites.json");
  });

  it("publishes the manifest under the contract's own filename", () => {
    // Not "both spell it the same" — the same binding, so they cannot diverge.
    expect(FAVORITES_FILE).toBe(KBIZ_FAVORITES_FILE);
  });

  it("masks a scraped row into exactly the contract's favorite fields", () => {
    const favorite = toFavorite({
      nickname: "พี่วิว",
      accountName: "MS. TESTONE SAMPLE",
      bank: "Siam Commercial Bank",
      accountNo: "111-2-34567-8",
    });
    // A field added or dropped on either side of the contract shows up here.
    expect(Object.keys(favorite).sort()).toEqual([...CONTRACT_FAVORITE_KEYS].sort());
    // …and the full number still never makes it into the published shape.
    expect(JSON.stringify(favorite)).not.toContain("34567");

    const asContract: KbizFavorite = favorite;
    expect(asContract.accountLast4).toBe("5678");
  });

  it("validates every destination kind the contract can carry, and no other", () => {
    const parsed: KbizDestination[] = [
      parseDestination({ kind: "handle", handle: "revew" }),
      parseDestination({ kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "5678" }),
      parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "111-2-34567-8" }),
    ];
    expect(parsed.map((d) => d.kind).sort()).toEqual([...CONTRACT_DESTINATION_KINDS].sort());
    // Sharing the TYPE never softened the validation: the JSON is still
    // untrusted, and a kind the contract doesn't define is still refused.
    expect(() => parseDestination({ kind: "iban", iban: "TH12" })).toThrow(/unknown destination kind/);
  });

  it("sanitizes memos with the contract's rule (the bot's local copy is gone)", () => {
    // Pinned from the deleted kbiz-bot sanitizeMemo: Thai + ASCII alnum +
    // space survive, every other run collapses to ONE space, and the result is
    // capped at KBIZ's 100-char field limit.
    expect(sanitizeKbizMemo("ค่าน้ำ/ค่าไฟ")).toBe("ค่าน้ำ ค่าไฟ");
    expect(sanitizeKbizMemo("  ค่าเดินทาง#3FA9C1  ")).toBe("ค่าเดินทาง 3FA9C1");
    // ฿ is U+0E3F — INSIDE the Thai block, so it survives, exactly as it did
    // under the bot's own regex (the shared doc comment lists it as stripped;
    // the behavior, which is what both sides shipped, is what's pinned here).
    expect(sanitizeKbizMemo("฿1,234.56 · note")).toBe("฿1 234 56 note");
    expect(sanitizeKbizMemo("a".repeat(120)).length).toBe(100);
    // Idempotent — which is why the bot re-sanitizing an intent's memo (built
    // by reimbursement with this same function) is a provable no-op.
    const built = sanitizeKbizMemo("ค่าเดินทางไปประชุม 3FA9C1");
    expect(sanitizeKbizMemo(built)).toBe(built);
  });
});

// ── the contract's own declarations, read as TEXT ──────────────────────────
// Everything above compares the bot against the bot: `toFavorite` emits the
// bot's literal keys and CONTRACT_FAVORITE_KEYS lists those same names, so the
// two agree with each other even when BOTH have drifted from reimbursement.
// Renaming `KbizFavorite.accountLast4` in the shared package is caught by
// `tsc` — which CI does not run — and by nothing else. So: read the shared
// source and check the declared names themselves.
//
// Text, not `keyof`, because an interface leaves no runtime trace to reflect
// on. Crude on purpose: it needs no node_modules and no type information, so
// it runs everywhere `bun test` does.
describe("the contract's declarations still match what the bot hard-codes", () => {
  const src = readFileSync(SHARED_SRC, "utf8");

  it("declares KbizFavorite with exactly CONTRACT_FAVORITE_KEYS", () => {
    expect(interfaceFieldNames(src, "KbizFavorite").sort()).toEqual([...CONTRACT_FAVORITE_KEYS].sort());
  });

  it("declares KbizDestination with exactly CONTRACT_DESTINATION_KINDS", () => {
    expect([...new Set(unionKindLiterals(src, "KbizDestination"))].sort()).toEqual(
      [...CONTRACT_DESTINATION_KINDS].sort(),
    );
  });

  it("declares result.outcome with exactly CONTRACT_OUTCOMES", () => {
    // The reimbursement-side twin of this check lives in
    // apps/api/test/kbiz-poller.test.ts, comparing the same contract text
    // against kbiz-poller.ts's HANDLED_OUTCOMES — so a new outcome added here
    // without teaching the poller fails on THAT side too.
    expect(outcomeLiterals(src).sort()).toEqual([...CONTRACT_OUTCOMES].sort());
  });

  it("keeps the favorites filename the bot publishes under", () => {
    // The one contract value that is a string, so it can be read back directly.
    expect(src).toContain(`export const KBIZ_FAVORITES_FILE = '${KBIZ_FAVORITES_FILE}';`);
  });

  // The guard above is only worth its line count if it FAILS on the drift it
  // claims to catch. These feed the same parsers a mutated contract, so the
  // check is proved to bite without anyone editing the real shared package.
  it("fails on a renamed contract field", () => {
    const renamed = src.replace(/\baccountLast4\b/g, "accountLastFour");
    expect(interfaceFieldNames(renamed, "KbizFavorite")).toContain("accountLastFour");
    expect(interfaceFieldNames(renamed, "KbizFavorite")).not.toContain("accountLast4");
  });

  it("fails on an added contract field", () => {
    const added = src.replace("export interface KbizFavorite {", "export interface KbizFavorite {\n  promptPayId: string;");
    expect(interfaceFieldNames(added, "KbizFavorite")).toContain("promptPayId");
  });

  it("fails on a new destination kind", () => {
    const extended = src.replace(
      "export type KbizDestination =\n",
      "export type KbizDestination =\n  | { kind: 'promptpay'; promptPayId: string }\n",
    );
    expect(unionKindLiterals(extended, "KbizDestination")).toContain("promptpay");
  });

  it("fails on a new contract outcome", () => {
    // Mirrors the trap this whole file exists to catch (2026-08-19,
    // inv:contract D1): a member added to the union without teaching
    // outcomeLiterals/CONTRACT_OUTCOMES about it must show up as a diff, not
    // silently agree with itself.
    const extended = src.replace(
      "'success' | 'confirmed-failed' | 'unconfirmed' | 'push-expired'",
      "'success' | 'confirmed-failed' | 'unconfirmed' | 'push-expired' | 'reversed'",
    );
    expect(outcomeLiterals(extended)).toContain("reversed");
  });

  it("says so out loud if the declaration is gone entirely", () => {
    expect(() => interfaceFieldNames(src.replace("export interface KbizFavorite", "interface KbizFavorite"), "KbizFavorite")).toThrow(
      /no longer declares/,
    );
  });
});
