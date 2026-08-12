// Pure-function coverage for the transfer-other queue-item contract: parsing
// the untrusted JSON blob apps/api writes, resolving intent-relative paths
// against the shared dir, and mapping a flow outcome to the queue patch. None
// of this touches a browser or the filesystem's real queue dir.
//
// Run with `bun test`.

import { describe, expect, it } from "bun:test";
import {
  describeDestination,
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
