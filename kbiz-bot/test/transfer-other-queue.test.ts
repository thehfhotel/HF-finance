// Pure-function coverage for the transfer-other queue-item contract: parsing
// the untrusted JSON blob apps/api writes, resolving intent-relative paths
// against the shared dir, and mapping a flow outcome to the queue patch. None
// of this touches a browser or the filesystem's real queue dir.
//
// Run with `bun test`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "bun:test";
import {
  decideDuplicateConfirm,
  SAME_MONEY_WINDOW_MS,
  describeDestination,
  destinationSignature,
  duplicateHeldText,
  duplicatePopupMessage,
  mapFlowOutcomeToPatch,
  parseDestination,
  parseTransferOtherRequest,
  resolveQueuePayee,
  resolveSharedPath,
  slipFileBasename,
} from "../src/lib/transfer-other-queue";
import type { TransferConfig } from "../src/lib/transfer-config";

function validIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "abc123",
    app: "reimbursement",
    type: "transfer-other",
    status: "approved",
    createdAt: "2026-08-12T10:00:00.000Z",
    bundleId: "bundle-1",
    payee: { handle: "revew" },
    amount: 1234.5,
    memo: "ค่าเดินทางไปประชุม 3FA9C1",
    kbizCategoryId: "30",
    voucherFile: "vouchers/abc123.html",
    ...overrides,
  };
}

describe("parseTransferOtherRequest", () => {
  it("accepts a well-formed intent unchanged", () => {
    const intent = validIntent();
    expect(parseTransferOtherRequest(intent)).toEqual(intent);
  });

  it("accepts an intent with no voucherFile (no attachment)", () => {
    const { voucherFile, ...rest } = validIntent();
    expect(parseTransferOtherRequest(rest).voucherFile).toBeUndefined();
  });

  it("rejects a non-object", () => {
    expect(() => parseTransferOtherRequest(null)).toThrow(/not a JSON object/);
    expect(() => parseTransferOtherRequest("nope")).toThrow(/not a JSON object/);
  });

  it("rejects a missing id", () => {
    const { id, ...rest } = validIntent();
    expect(() => parseTransferOtherRequest(rest)).toThrow(/missing "id"/);
  });

  it("rejects the wrong type", () => {
    expect(() => parseTransferOtherRequest(validIntent({ type: "transfer-payroll" }))).toThrow(
      /"type" is "transfer-payroll", expected "transfer-other"/,
    );
  });

  it("rejects a missing bundleId", () => {
    const { bundleId, ...rest } = validIntent();
    expect(() => parseTransferOtherRequest(rest)).toThrow(/missing "bundleId"/);
  });

  it("rejects a missing payee.handle", () => {
    expect(() => parseTransferOtherRequest(validIntent({ payee: {} }))).toThrow(/missing "payee.handle"/);
    expect(() => parseTransferOtherRequest(validIntent({ payee: undefined }))).toThrow(/missing "payee.handle"/);
  });

  it("rejects a non-positive or non-finite amount", () => {
    expect(() => parseTransferOtherRequest(validIntent({ amount: 0 }))).toThrow(/"amount" must be a positive/);
    expect(() => parseTransferOtherRequest(validIntent({ amount: -5 }))).toThrow(/"amount" must be a positive/);
    expect(() => parseTransferOtherRequest(validIntent({ amount: Number.POSITIVE_INFINITY }))).toThrow(
      /"amount" must be a positive/,
    );
    expect(() => parseTransferOtherRequest(validIntent({ amount: "1234.50" }))).toThrow(/"amount" must be a positive/);
  });

  it("rejects a missing kbizCategoryId", () => {
    const { kbizCategoryId, ...rest } = validIntent();
    expect(() => parseTransferOtherRequest(rest)).toThrow(/missing "kbizCategoryId"/);
  });

  it("rejects a non-string voucherFile", () => {
    expect(() => parseTransferOtherRequest(validIntent({ voucherFile: 42 }))).toThrow(/"voucherFile" must be a string/);
  });

  it("rejects an unrecognized status", () => {
    expect(() => parseTransferOtherRequest(validIntent({ status: "queued" }))).toThrow(/"status" is "queued"/);
  });

  it("names the intent id in later errors once id is known", () => {
    expect(() => parseTransferOtherRequest(validIntent({ bundleId: undefined }))).toThrow(/^abc123:/);
  });

  it("accepts a null payee when the intent carries a destination", () => {
    // The picker writes payee: null for anything but a handle; the
    // destination is what gets paid.
    const intent = validIntent({ payee: null, destination: { kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "5678" } });
    expect(parseTransferOtherRequest(intent).payee).toBeNull();
  });

  it("still requires payee.handle when there is no destination at all", () => {
    expect(() => parseTransferOtherRequest(validIntent({ payee: null }))).toThrow(/missing "payee.handle"/);
  });

  it("does NOT reject a malformed destination — that has to fail the item, not hide the file", () => {
    // A file that throws here is skipped by listApproved and sits "approved"
    // forever; the destination is validated at resolve time instead so the
    // item can be patched to failed with the reason.
    const intent = validIntent({ payee: null, destination: { kind: "nonsense" } });
    expect(parseTransferOtherRequest(intent).destination).toEqual({ kind: "nonsense" });
  });
});

// ── destination picker (handle / favorite / custom) ─────────────────────────

// Fake payee book — no real account ever appears in this repo.
const CONFIG: TransferConfig = {
  maxTransfer: 50_000,
  recipients: {
    revew: { mode: "favorite", nickname: "พี่วิว", accountNo: "111-2-34567-8", bank: "Kasikornbank" },
  },
};

describe("parseDestination", () => {
  it("parses a handle destination", () => {
    expect(parseDestination({ kind: "handle", handle: "revew" })).toEqual({ kind: "handle", handle: "revew" });
  });

  it("parses a favorite destination, keeping only the last 4 digits", () => {
    expect(
      parseDestination({ kind: "favorite", nickname: "พี่วิว", bank: "Siam Commercial Bank", accountLast4: "5678", accountName: "MS. TESTONE SAMPLE" }),
    ).toEqual({
      kind: "favorite",
      nickname: "พี่วิว",
      bank: "Siam Commercial Bank",
      accountLast4: "5678",
      accountName: "MS. TESTONE SAMPLE",
    });
  });

  it("strips the mask off accountLast4 (…5678 → 5678)", () => {
    const dest = parseDestination({ kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "…5678" });
    expect(dest).toMatchObject({ accountLast4: "5678" });
  });

  it("rejects a favorite whose accountLast4 isn't 4 digits", () => {
    expect(() => parseDestination({ kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "567" })).toThrow(
      /"accountLast4" must be exactly 4 digits/,
    );
  });

  it("rejects a favorite missing nickname or bank", () => {
    expect(() => parseDestination({ kind: "favorite", bank: "SCB", accountLast4: "5678" })).toThrow(/missing "nickname"/);
    expect(() => parseDestination({ kind: "favorite", nickname: "พี่วิว", accountLast4: "5678" })).toThrow(/missing "bank"/);
  });

  it("parses a custom destination, stripping separators from the account number", () => {
    expect(parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "111-2-34567-8" })).toEqual({
      kind: "custom",
      bank: "Bangkok Bank",
      accountNo: "1112345678",
      accountName: undefined,
    });
    expect(parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "020 4 01234 567" })).toMatchObject({
      accountNo: "020401234567",
    });
  });

  it("rejects a custom account number outside 8–15 digits", () => {
    expect(() => parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "12345" })).toThrow(/must be 8–15 digits/);
    expect(() => parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "1234567890123456" })).toThrow(
      /must be 8–15 digits/,
    );
  });

  it("rejects a custom account number carrying anything but digits and separators", () => {
    expect(() => parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "11a2345678" })).toThrow(/must be digits/);
  });

  it("never echoes the account number in an error", () => {
    // The message lands in the queue file, the approver's screen and Slack.
    let message = "";
    try {
      parseDestination({ kind: "custom", bank: "Bangkok Bank", accountNo: "1234567" });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toContain("must be 8–15 digits");
    expect(message).not.toContain("1234567");
  });

  it("rejects an unknown kind and a non-object", () => {
    expect(() => parseDestination({ kind: "iban", iban: "TH12" })).toThrow(/unknown destination kind "iban"/);
    expect(() => parseDestination({})).toThrow(/unknown destination kind undefined/);
    expect(() => parseDestination(null)).toThrow(/must be an object/);
    expect(() => parseDestination("favorite")).toThrow(/must be an object/);
  });

  it("tags errors with the intent id it was given", () => {
    expect(() => parseDestination({ kind: "nope" }, "abc123")).toThrow(/^abc123:/);
  });
});

describe("resolveQueuePayee", () => {
  const req = (over: Record<string, unknown>) =>
    ({ id: "abc123", payee: null, ...over }) as Parameters<typeof resolveQueuePayee>[0];

  it("resolves a handle destination through the payee book", () => {
    const payee = resolveQueuePayee(req({ destination: { kind: "handle", handle: "revew" } }), CONFIG);
    expect(payee).toEqual({
      mode: "favorite",
      nickname: "พี่วิว",
      accountNo: "111-2-34567-8",
      bank: "Kasikornbank",
      accountName: undefined,
    });
  });

  it("resolves a favorite destination WITHOUT any account number", () => {
    const payee = resolveQueuePayee(
      req({ destination: { kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "5678" } }),
      CONFIG,
    );
    expect(payee).toEqual({
      mode: "favorite",
      nickname: "พี่วิว",
      bank: "SCB",
      accountLast4: "5678",
      accountName: undefined,
    });
    expect(payee.accountNo).toBeUndefined();
  });

  it("resolves a custom destination to the digits the flow will type", () => {
    const payee = resolveQueuePayee(
      req({ destination: { kind: "custom", bank: "Bangkok Bank", accountNo: "111-2-34567-8", accountName: "MS. TESTONE SAMPLE" } }),
      CONFIG,
    );
    expect(payee).toEqual({
      mode: "custom",
      bank: "Bangkok Bank",
      accountNo: "1112345678",
      accountName: "MS. TESTONE SAMPLE",
    });
  });

  it("prefers the destination over payee.handle", () => {
    const payee = resolveQueuePayee(
      req({ payee: { handle: "revew" }, destination: { kind: "custom", bank: "Bangkok Bank", accountNo: "222-3-45678-9" } }),
      CONFIG,
    );
    expect(payee.mode).toBe("custom");
    expect(payee.bank).toBe("Bangkok Bank");
  });

  it("falls back to payee.handle for a pre-picker intent", () => {
    expect(resolveQueuePayee(req({ payee: { handle: "revew" } }), CONFIG).nickname).toBe("พี่วิว");
  });

  it("fails on an unknown handle, from either route", () => {
    expect(() => resolveQueuePayee(req({ payee: { handle: "ghost" } }), CONFIG)).toThrow(/Unknown payee handle "ghost"/);
    expect(() => resolveQueuePayee(req({ destination: { kind: "handle", handle: "ghost" } }), CONFIG)).toThrow(
      /Unknown payee handle "ghost"/,
    );
  });

  it("fails on a malformed destination instead of falling back to the handle", () => {
    expect(() => resolveQueuePayee(req({ payee: { handle: "revew" }, destination: { kind: "iban" } }), CONFIG)).toThrow(
      /unknown destination kind "iban"/,
    );
  });

  it("fails when the intent names no destination at all", () => {
    expect(() => resolveQueuePayee(req({}), CONFIG)).toThrow(/neither a "destination" nor a "payee.handle"/);
  });
});

describe("describeDestination", () => {
  it("shows a custom destination as bank + last 4 ONLY", () => {
    const line = describeDestination({
      payee: null,
      destination: { kind: "custom", bank: "Bangkok Bank", accountNo: "111-2-34567-8" },
    });
    expect(line).toBe("custom (Bangkok Bank …5678)");
    expect(line).not.toContain("1112345678");
    expect(line).not.toContain("111-2-34567-8");
  });

  it("describes favorite and handle destinations", () => {
    expect(
      describeDestination({ payee: null, destination: { kind: "favorite", nickname: "พี่วิว", bank: "SCB", accountLast4: "5678" } }),
    ).toBe('favorite "พี่วิว" (SCB …5678)');
    expect(describeDestination({ payee: null, destination: { kind: "handle", handle: "revew" } })).toBe('handle "revew"');
  });

  it("falls back to the handle, and never throws on a broken destination", () => {
    expect(describeDestination({ payee: { handle: "revew" } })).toBe('handle "revew"');
    expect(describeDestination({ payee: null })).toBe("no destination");
    expect(describeDestination({ payee: null, destination: { kind: "iban" } })).toBe("unparseable destination");
  });
});

describe("resolveSharedPath", () => {
  const root = "/srv/kbiz-queue";

  it("resolves a plain relative path under the shared dir", () => {
    expect(resolveSharedPath(root, "vouchers/abc123.html")).toBe("/srv/kbiz-queue/vouchers/abc123.html");
  });

  it("resolves the root itself", () => {
    expect(resolveSharedPath(root, ".")).toBe(root);
  });

  it("refuses a path that escapes the shared dir via ..", () => {
    expect(() => resolveSharedPath(root, "../../etc/passwd")).toThrow(/resolves outside the shared dir/);
  });

  it("refuses a sibling directory that merely shares the root as a string prefix", () => {
    // "/srv/kbiz-queue-evil" starts with "/srv/kbiz-queue" as a raw string,
    // so a naive startsWith(root) check (without the trailing slash) would
    // wrongly accept it.
    expect(() => resolveSharedPath(root, "../kbiz-queue-evil/x.html")).toThrow(/resolves outside the shared dir/);
  });
});

describe("slipFileBasename", () => {
  it("strips the directory, keeping only the filename", () => {
    expect(slipFileBasename("/srv/kbiz-queue/slips/transfer-abc123-2026-08-12T10-00-00-000Z.png")).toBe(
      "transfer-abc123-2026-08-12T10-00-00-000Z.png",
    );
  });

  it("is a no-op on an already-bare filename", () => {
    expect(slipFileBasename("abc123.png")).toBe("abc123.png");
  });
});

describe("mapFlowOutcomeToPatch", () => {
  const at = "2026-08-12T10:05:00.000Z";

  it("maps a success to done/success, carrying reference, slipFile, finalUrl", () => {
    const patch = mapFlowOutcomeToPatch(
      { success: true, reference: "TRBS123456", slipFile: "transfer-abc-x.png", finalUrl: "https://kbiz.example/done" },
      at,
    );
    expect(patch).toEqual({
      status: "done",
      result: {
        outcome: "success",
        reference: "TRBS123456",
        slipFile: "transfer-abc-x.png",
        finalUrl: "https://kbiz.example/done",
        finishedAt: at,
      },
    });
  });

  it("maps an unconfirmed outcome to needs-review — never auto-retried", () => {
    const patch = mapFlowOutcomeToPatch({ success: false, outcome: "unconfirmed", error: "timed out waiting for the tap" }, at);
    expect(patch.status).toBe("needs-review");
    expect(patch.result.outcome).toBe("unconfirmed");
    expect(patch.result.error).toBe("timed out waiting for the tap");
  });

  it("maps a confirmed-failed outcome to failed — safe to retry", () => {
    const patch = mapFlowOutcomeToPatch({ success: false, outcome: "confirmed-failed", error: "KBIZ rejected the transfer" }, at);
    expect(patch.status).toBe("failed");
    expect(patch.result.outcome).toBe("confirmed-failed");
  });

  it("maps a push-expired outcome to failed/push-expired — the bank already voided it, safe to retry", () => {
    // RED until IMPL-A's TransferFailureOutcome/approval-wait.ts and IMPL-D's
    // flow land: the narrow local `outcome` type this file used to declare
    // would have rejected the literal "push-expired" outright.
    const patch = mapFlowOutcomeToPatch(
      { success: false, outcome: "push-expired", error: "the bank voided the transaction — window closed unconfirmed" },
      at,
    );
    expect(patch.status).toBe("failed");
    expect(patch.result.outcome).toBe("push-expired");
    expect(patch.result.error).toContain("voided");
  });

  it("maps a pre-arm failure with no outcome the same as confirmed-failed", () => {
    // Payee resolution / ceiling check failures happen before Next is ever
    // clicked — nothing moved, so this must be retryable, not needs-review.
    const patch = mapFlowOutcomeToPatch({ success: false, error: 'Unknown payee handle "ghost"' }, at);
    expect(patch.status).toBe("failed");
    expect(patch.result.outcome).toBe("confirmed-failed");
    expect(patch.result.error).toBe('Unknown payee handle "ghost"');
  });

  it("defaults finishedAt to now when not given", () => {
    const before = Date.now();
    const patch = mapFlowOutcomeToPatch({ success: true });
    const parsed = Date.parse(patch.result.finishedAt!);
    expect(parsed).toBeGreaterThanOrEqual(before);
  });
});

// ── payee-handles manifest (the admin-dropdown feed) ────────────────────────
import { buildHandlesManifest, HANDLES_FILE } from "../src/lib/payee-handles";

describe("payee handles manifest", () => {
  it("handles are the recipient keys, sorted, with a timestamp", () => {
    const m = buildHandlesManifest(
      {
        maxTransfer: 50000,
        recipients: {
          somchai: { accountNo: "1", bank: "K" },
          revew: { mode: "favorite", nickname: "พี่วิว", accountNo: "2", bank: "SCB" },
        },
      },
      new Date("2026-08-12T00:00:00Z"),
    );
    expect(m.handles).toEqual(["revew", "somchai"]);
    expect(m.updatedAt).toBe("2026-08-12T00:00:00.000Z");
    expect(m.payees).toEqual([
      { handle: "revew", mode: "favorite", nickname: "พี่วิว", bank: "SCB", accountName: undefined, accountMasked: "…2" },
      { handle: "somchai", mode: "favorite", nickname: undefined, bank: "K", accountName: undefined, accountMasked: "…1" },
    ]);
  });

  it("manifest filename is what both queue scanners skip", () => {
    expect(HANDLES_FILE).toBe("payee-handles.json");
  });
});

// ── back-to-back tap alerts (2026-08-12/13 incidents) ───────────────────────
// Both incidents: two transfer-other items approved together; push #2 armed
// ~30 s after tap #1, raised no phone banner, expired unseen → unconfirmed.
// The fix is an arm-time alert that (a) fires when the push actually exists
// and (b) says which transfer in the batch this tap is for.
import {
  pauseBeforeArmMessage,
  requestOrderCompare,
  tapNeededMessage,
  transferOtherPositions,
} from "../src/lib/transfer-other-queue";

describe("transferOtherPositions", () => {
  it("numbers a back-to-back pair 1/2 and 2/2", () => {
    const positions = transferOtherPositions([
      { id: "pi_first", type: "transfer-other" },
      { id: "pi_second", type: "transfer-other" },
    ]);
    expect(positions.get("pi_first")).toEqual({ position: 1, total: 2 });
    expect(positions.get("pi_second")).toEqual({ position: 2, total: 2 });
  });

  it("counts ONLY money items — sync and payroll arm no phone push", () => {
    const positions = transferOtherPositions([
      { id: "sync_1", type: "list-favorites" },
      { id: "pi_a", type: "transfer-other" },
      { id: "payroll_1", type: "transfer-payroll" },
      { id: "pi_b", type: "transfer-other" },
    ]);
    expect(positions.get("pi_a")).toEqual({ position: 1, total: 2 });
    expect(positions.get("pi_b")).toEqual({ position: 2, total: 2 });
    expect(positions.has("sync_1")).toBe(false);
    expect(positions.has("payroll_1")).toBe(false);
  });

  it("a lone transfer is 1/1", () => {
    const positions = transferOtherPositions([{ id: "pi_only", type: "transfer-other" }]);
    expect(positions.get("pi_only")).toEqual({ position: 1, total: 1 });
  });
});

describe("tapNeededMessage", () => {
  it("names the item, amount, masked destination and batch position", () => {
    const msg = tapNeededMessage({
      id: "pi_3d2eae1e",
      dest: 'favorite "พี่วิว" (Siam Commercial …7394)',
      amount: 580,
      position: { position: 2, total: 2 },
    });
    expect(msg).toContain("TAP NEEDED NOW");
    expect(msg).toContain("`pi_3d2eae1e`");
    expect(msg).toContain("transfer 2/2");
    expect(msg).toContain("฿580.00");
    expect(msg).toContain('favorite "พี่วิว" (Siam Commercial …7394)');
    // The back-to-back warning: the second push shows no banner on the phone.
    expect(msg).toContain("NO banner");
  });

  it("EVERY ping carries the no-banner warning, including a lone transfer (position:1,total:1)", () => {
    // INVERTED 2026-08-19: this assertion used to read `.not.toContain("NO
    // banner")` and PINNED the very bug this spec fixes. 2026-08-18 run B was
    // 1/1 in its own batch snapshot, so the old `position.total > 1` gate
    // stripped the ping of the one sentence describing the operator's actual
    // situation — and the sentence itself was wrong: the trigger (user
    // testimony, 2026-08-19) is the K BIZ app being FOREGROUND at arming, not
    // the transfer being second in a batch. A lone transfer approved soon
    // after the operator's own last unrelated tap is exactly as exposed.
    const msg = tapNeededMessage({
      id: "pi_solo",
      dest: 'handle "revew"',
      amount: 1190,
      position: { position: 1, total: 1 },
    });
    expect(msg).toContain("฿1190.00");
    expect(msg).toContain("NO banner");
    expect(msg).toContain("Keep K BIZ CLOSED");
  });

  it("survives a missing position (manual runs), and still carries the no-banner warning", () => {
    const msg = tapNeededMessage({ id: "pi_x", dest: 'handle "revew"', amount: 1 });
    expect(msg).toContain("`pi_x`");
    expect(msg).toContain("(transfer, ฿1.00");
    expect(msg).toContain("NO banner");
  });
});

describe("requestOrderCompare", () => {
  it("orders by createdAt, not id — the 2026-08-13 inversion", () => {
    // Requested A first, but B's uuid sorts first: id order ran B before A.
    const a = { id: "pi_zz-first-requested", createdAt: "2026-08-13T01:00:00.000Z" };
    const b = { id: "pi_aa-second-requested", createdAt: "2026-08-13T01:05:00.000Z" };
    expect([b, a].sort(requestOrderCompare).map((r) => r.id)).toEqual([
      "pi_zz-first-requested",
      "pi_aa-second-requested",
    ]);
  });

  it("missing createdAt sorts last; ties fall back to id (total, deterministic)", () => {
    const noStamp = { id: "pi_a" };
    const early = { id: "pi_z", createdAt: "2026-08-13T01:00:00.000Z" };
    const tie1 = { id: "pi_m", createdAt: "2026-08-13T02:00:00.000Z" };
    const tie2 = { id: "pi_k", createdAt: "2026-08-13T02:00:00.000Z" };
    expect([noStamp, tie1, early, tie2].sort(requestOrderCompare).map((r) => r.id)).toEqual([
      "pi_z",
      "pi_k",
      "pi_m",
      "pi_a",
    ]);
  });
});

describe("pauseBeforeArmMessage", () => {
  it("says how long, which transfer, and to background the app", () => {
    const msg = pauseBeforeArmMessage({
      dest: 'favorite "พี่วิว" (Siam Commercial …7394)',
      amount: 580,
      gapSeconds: 90,
      position: { position: 2, total: 2 },
    });
    expect(msg).toContain("Pausing 90s");
    expect(msg).toContain("transfer 2/2");
    expect(msg).toContain("฿580.00");
    expect(msg).toContain('favorite "พี่วิว" (Siam Commercial …7394)');
    expect(msg).toContain("background the K BIZ app");
    expect(msg).toContain("leave it closed");
  });

  it("survives a missing position", () => {
    const msg = pauseBeforeArmMessage({ dest: 'handle "revew"', amount: 1, gapSeconds: 90 });
    expect(msg).toContain("Pausing 90s before transfer (");
  });

  it("F4 — works for a payroll item, which has no single amount to name", () => {
    const msg = pauseBeforeArmMessage({ dest: "transfer-payroll", gapSeconds: 90 });
    expect(msg).toContain("Pausing 90s before transfer (transfer-payroll)");
    expect(msg).toContain("background the K BIZ app");
    expect(msg).not.toContain("฿");
  });

  it("CROSS-POLL REMAINDER (spec finding 7): a fractional gapMs rounds to a clean integer second, never prints decimals", () => {
    // process-queue.ts never calls this with a bare integer like 90 in the
    // cross-poll case — it computes `Math.round(gapMs / 1000)` from
    // decideArm's `gap = Math.max(0, gapMs - age)` (arm-gate.ts §1.7), which
    // is real wall-clock arithmetic and essentially never lands on an exact
    // multiple of 1000ms. arm-gate.test.ts:731 pins the shape this remainder
    // actually takes: TAP_COOLDOWN_MS (90_000) minus an elapsed `age` of
    // 30_803ms = 59_197ms. Reverting process-queue.ts's `Math.round(gapMs /
    // 1000)` back to a bare `gapMs / 1000` (spec finding 7's original
    // regression: Slack printing "59.197s") would not fail THIS assertion —
    // pauseBeforeArmMessage only formats whatever gapSeconds it is handed —
    // but it pins the exact rounding process-queue.ts must perform before
    // calling in, and the sibling "process-queue.ts wiring" guard below
    // source-greps that the call site still does so.
    const gapMs = 59_197; // TAP_COOLDOWN_MS(90_000) - age(30_803), arm-gate.test.ts:731
    const msg = pauseBeforeArmMessage({ dest: 'handle "revew"', gapSeconds: Math.round(gapMs / 1000) });
    expect(msg).toContain("Pausing 59s before transfer (");
    expect(msg).not.toContain("59.197");
    expect(msg).not.toContain("59.");
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Structural guard — process-queue.ts's two gapSeconds call sites are not
// importable here (the driver pulls playwright for real; root CI runs this
// file BEFORE kbiz-bot/node_modules exists). Read it as TEXT, like arm-gate
// .test.ts's "process-queue.ts wiring" block pins the same file's other
// invariants.
// ───────────────────────────────────────────────────────────────────────────

describe("process-queue.ts wiring — gapSeconds rounding (spec finding 7)", () => {
  it("both Slack call sites round gapMs to whole seconds, not truncate or print raw ms/1000", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/process-queue.ts", import.meta.url)), "utf8");
    const hits = src.match(/gapSeconds:\s*Math\.round\(gapMs \/ 1000\)/g) ?? [];
    // pauseBeforeArmMessage's call site (transfer 2/2 pause) and the S2 Slack
    // line share this computation — both must round, or one of the two
    // messages regresses to fractional seconds while the other stays fixed.
    expect(hits.length).toBe(2);
    expect(src).not.toMatch(/gapSeconds:\s*gapMs \/ 1000\b/);
  });
});

describe("process-queue.ts wiring — SAME_MONEY_WINDOW_MS (money review finding 6)", () => {
  it("decideDuplicateConfirm is called with `now`, and readPriorAttempts feeds it a createdAt", () => {
    const src = readFileSync(fileURLToPath(new URL("../src/process-queue.ts", import.meta.url)), "utf8");
    // The one call site: omitting `now` here silently reverts to the
    // unbounded pre-fix behavior (decideDuplicateConfirm treats a missing
    // `now` as "no window applies" — fail-closed by DESIGN there, but that
    // means this wiring, not that function, is what actually turns the
    // bound on in production).
    const callStart = src.indexOf("decideDuplicateConfirm({");
    expect(callStart).toBeGreaterThan(-1);
    const call = src.slice(callStart, src.indexOf("});", callStart));
    expect(call).toContain("now: Date.now()");
    // readPriorAttempts must parse a createdAt onto every attempt it returns,
    // or decideDuplicateConfirm's `now` bound has nothing to compare against
    // and every match falls back to "still inside the window" anyway —
    // silently defeating the fix without a single test going red here.
    expect(src).toContain("createdAt: Number.isFinite(createdAtMs) ? createdAtMs : undefined,");
  });
});

// ── KBIZ's exact-duplicate popup (user-verified 2026-08-19, 0/9 production
// arms) — the pure decision + the two message builders. ────────────────────

describe("decideDuplicateConfirm", () => {
  it("no prior attempts on this bundle + a complete scan → confirm", () => {
    expect(decideDuplicateConfirm({ bundleId: "bundle-1", scanOk: true, priorAttempts: [] })).toEqual({
      confirm: true,
      reason: "no-prior-attempt",
    });
  });

  it("a prior unconfirmed attempt on THIS bundle → refuse, with a detail naming it", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-1",
      scanOk: true,
      priorAttempts: [{ id: "pi_4c224962", bundleId: "bundle-1", status: "needs-review", outcome: "unconfirmed" }],
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
    expect(result.detail).toContain("pi_4c224962");
    expect(result.detail).toContain("unconfirmed");
  });

  it("a prior confirmed-failed attempt STILL refuses — strict on purpose", () => {
    // WHY: KBIZ's own popup only fires when the earlier transaction ACTUALLY
    // WENT THROUGH at the bank (GAP 2) — our own queue record saying
    // "confirmed-failed" does not prove the bank agrees ฿0 moved, and
    // trusting our record over the bank's live popup is exactly the
    // double-pay path this function exists to close. Fail closed regardless
    // of what outcome the prior attempt itself recorded.
    const result = decideDuplicateConfirm({
      bundleId: "bundle-1",
      scanOk: true,
      priorAttempts: [{ id: "pi_older", bundleId: "bundle-1", status: "failed", outcome: "confirmed-failed" }],
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
  });

  it("a prior attempt on a DIFFERENT bundle does not block when no destinationKey/amount is given", () => {
    // The benign case the auto-confirm exists for: two different bundles
    // that happen to be the same payee and the same amount, with no
    // destination/amount signature to compare (the caller's own request
    // could not compute one, or an old-shaped record) — the cross-bundle
    // check below is simply skipped, not treated as a match.
    const result = decideDuplicateConfirm({
      bundleId: "bundle-1",
      scanOk: true,
      priorAttempts: [{ id: "pi_other_bundle", bundleId: "bundle-2", status: "done", outcome: "success" }],
    });
    expect(result).toEqual({ confirm: true, reason: "no-prior-attempt" });
  });

  // ── MONEY REVIEW FINDING 2 (2026-08-19): KBIZ's own duplicate predicate is
  // payee+amount, not bundle — a bundle-only guard is defeated whenever the
  // SAME money is represented by a DIFFERENT bundle (a resubmitted receipt
  // after an `unconfirmed` original, a duplicated data entry, ...).

  it("a prior attempt on a DIFFERENT bundle DOES block when it shares this request's destination + amount", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        { id: "pi_older", bundleId: "bundle-1", status: "needs-review", outcome: "unconfirmed", destinationKey: "favorite:kbank:พี่วิว:1234", amount: 500 },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
    expect(result.detail).toContain("pi_older");
    expect(result.detail).toContain("bundle-1");
  });

  it("same destination but a DIFFERENT amount does not block via the cross-bundle check", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        { id: "pi_older", bundleId: "bundle-1", status: "done", outcome: "success", destinationKey: "favorite:kbank:พี่วิว:1234", amount: 500 },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 999,
    });
    expect(result).toEqual({ confirm: true, reason: "no-prior-attempt" });
  });

  // ── MONEY REVIEW FINDING 6 (2026-08-19, second fix round): the cross-bundle
  // same-money check above was UNBOUNDED — a recurring same-payee/same-amount
  // payment (monthly rent) would be HELD every single time, forever. Bounded
  // to SAME_MONEY_WINDOW_MS, keyed on each prior attempt's own `createdAt`.

  it("a same-destination-+-amount match INSIDE the window still blocks", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        {
          id: "pi_last_week",
          bundleId: "bundle-1",
          status: "done",
          outcome: "success",
          destinationKey: "favorite:kbank:พี่วิว:1234",
          amount: 500,
          createdAt: now - SAME_MONEY_WINDOW_MS / 2, // 7 days ago
        },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
      now,
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
    expect(result.detail).toContain("pi_last_week");
  });

  it("a same-destination-+-amount match OUTSIDE the window no longer blocks — the monthly-rent case", () => {
    const now = Date.parse("2026-09-01T00:00:00.000Z");
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        {
          id: "pi_last_month",
          bundleId: "bundle-1",
          status: "done",
          outcome: "success",
          destinationKey: "favorite:kbank:พี่วิว:1234",
          amount: 500,
          createdAt: now - SAME_MONEY_WINDOW_MS - 1, // just past the window
        },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
      now,
    });
    expect(result).toEqual({ confirm: true, reason: "no-prior-attempt" });
  });

  it("a same-destination-+-amount match with NO createdAt still blocks — fail-closed against a missing timestamp", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        { id: "pi_undated", bundleId: "bundle-1", status: "done", outcome: "success", destinationKey: "favorite:kbank:พี่วิว:1234", amount: 500 },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
      now: Date.parse("2026-09-01T00:00:00.000Z"),
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
  });

  it("omitting `now` entirely still blocks regardless of createdAt — back-compat with the unbounded pre-fix behavior", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-2",
      scanOk: true,
      priorAttempts: [
        {
          id: "pi_very_old",
          bundleId: "bundle-1",
          status: "done",
          outcome: "success",
          destinationKey: "favorite:kbank:พี่วิว:1234",
          amount: 500,
          createdAt: Date.parse("2020-01-01T00:00:00.000Z"),
        },
      ],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
      // no `now`
    });
    expect(result.confirm).toBe(false);
    expect(result.reason).toBe("prior-attempt");
  });

  it("the SAME bundle's own prior attempt still wins over the cross-bundle check (bundle-scoped detail, not the money-scoped one)", () => {
    const result = decideDuplicateConfirm({
      bundleId: "bundle-1",
      scanOk: true,
      priorAttempts: [{ id: "pi_same_bundle", bundleId: "bundle-1", status: "needs-review", outcome: "unconfirmed" }],
      destinationKey: "favorite:kbank:พี่วิว:1234",
      amount: 500,
    });
    expect(result.reason).toBe("prior-attempt");
    expect(result.detail).toContain("pi_same_bundle");
    expect(result.detail).not.toContain("same destination");
  });

  it("an incomplete scan never licenses a confirm", () => {
    expect(decideDuplicateConfirm({ bundleId: "bundle-1", scanOk: false, priorAttempts: [] })).toEqual({
      confirm: false,
      reason: "scan-failed",
    });
  });

  it("no bundleId at all → refuse, unknown-bundle", () => {
    expect(decideDuplicateConfirm({ bundleId: undefined, scanOk: true, priorAttempts: [] })).toEqual({
      confirm: false,
      reason: "unknown-bundle",
    });
  });
});

describe("duplicateHeldText / duplicatePopupMessage", () => {
  it("duplicateHeldText(prior-attempt) starts with HELD:, names the detail, points at ประวัติทำรายการ, carries no account number", () => {
    const text = duplicateHeldText("prior-attempt", "`pi_4c224962` (unconfirmed)");
    expect(text.startsWith("HELD: ")).toBe(true);
    expect(text).toContain("pi_4c224962");
    expect(text).toContain("ประวัติทำรายการ");
    expect(text).not.toMatch(/\d{9,}/); // mask guard — no 9+ digit run
  });

  // ── SPEC REVIEW FINDING 3 (2026-08-19): scan-failed / unknown-bundle carry
  // no `detail` at all — reachable on any readdir failure, and on EVERY
  // manual `transfer-other -- --confirm` run (that CLI passes no
  // duplicatePolicy). The old code substituted a placeholder
  // ("(no detail — see the queue archive)") that asserted a prior attempt
  // exists when the truth is "the bot could not even check".

  it("duplicateHeldText(scan-failed) never claims a specific prior attempt exists", () => {
    const text = duplicateHeldText("scan-failed");
    expect(text.startsWith("HELD: ")).toBe(true);
    expect(text).not.toContain("(no detail");
    expect(text).not.toContain("undefined");
    expect(text).toContain("ประวัติทำรายการ");
  });

  it("duplicateHeldText(unknown-bundle) never claims a specific prior attempt exists", () => {
    const text = duplicateHeldText("unknown-bundle");
    expect(text.startsWith("HELD: ")).toBe(true);
    expect(text).not.toContain("(no detail");
    expect(text).not.toContain("undefined");
  });

  it("duplicatePopupMessage: confirmed names the id/bundle and says it pressed ยืนยัน", () => {
    const msg = duplicatePopupMessage({ id: "pi_x", bundleId: "bundle-1", confirmed: true, reason: "no-prior-attempt" });
    expect(msg).toContain("pi_x");
    expect(msg).toContain("bundle-1");
    expect(msg).toContain("pressed ยืนยัน");
  });

  it("duplicatePopupMessage: refused (prior-attempt) says it did NOT confirm and points at ประวัติทำรายการ", () => {
    const msg = duplicatePopupMessage({
      id: "pi_x",
      bundleId: "bundle-1",
      confirmed: false,
      reason: "prior-attempt",
      detail: "`pi_4c224962` (unconfirmed)",
    });
    expect(msg).toContain("pi_x");
    expect(msg).toContain("did NOT confirm");
    expect(msg).toContain("ประวัติทำรายการ");
    expect(msg).toContain("pi_4c224962");
  });

  it("duplicatePopupMessage: refused (scan-failed / unknown-bundle) never interpolates a bare 'undefined'", () => {
    for (const reason of ["scan-failed", "unknown-bundle"] as const) {
      const msg = duplicatePopupMessage({ id: "pi_x", bundleId: "bundle-1", confirmed: false, reason });
      expect(msg).toContain("did NOT confirm");
      expect(msg).not.toContain("undefined");
    }
  });
});

// ── destinationSignature — the resilient, always-masked destination key the
// cross-bundle duplicate check compares (money review finding 2). ─────────

describe("destinationSignature", () => {
  it("custom destination → bank + last-4, masked", () => {
    expect(destinationSignature({ destination: { kind: "custom", bank: "KBank", accountNo: "1112223334" } })).toBe(
      "custom:kbank:3334",
    );
  });

  it("an ARCHIVED custom destination (accountNo already redacted to accountLast4) still produces a signature", () => {
    // reimbursement's redactArchivedAccountNo (apps/api/src/kbiz.ts) replaces
    // accountNo with accountLast4 on archive — parseDestination's own
    // required("accountNo") would THROW on this exact shape.
    expect(destinationSignature({ destination: { kind: "custom", bank: "KBank", accountLast4: "4334" } })).toBe(
      "custom:kbank:4334",
    );
  });

  it("favorite destination → bank + nickname + last-4", () => {
    expect(
      destinationSignature({ destination: { kind: "favorite", bank: "KBank", nickname: "พี่วิว", accountLast4: "1234" } }),
    ).toBe("favorite:kbank:พี่วิว:1234");
  });

  it("handle destination → the handle", () => {
    expect(destinationSignature({ destination: { kind: "handle", handle: "vendor-a" } })).toBe("handle:vendor-a");
  });

  it("falls back to payee.handle when there is no destination at all (pre-picker intents)", () => {
    expect(destinationSignature({ payee: { handle: "vendor-a" } })).toBe("handle:vendor-a");
  });

  it("never a full account number", () => {
    const sig = destinationSignature({ destination: { kind: "custom", bank: "KBank", accountNo: "1112223334" } });
    expect(sig).not.toMatch(/\d{9,}/);
  });

  it("returns undefined, never throws, on garbage input", () => {
    expect(destinationSignature({})).toBeUndefined();
    expect(destinationSignature({ destination: {} })).toBeUndefined();
    expect(destinationSignature({ destination: { kind: "custom", bank: "KBank" } })).toBeUndefined();
  });
});
