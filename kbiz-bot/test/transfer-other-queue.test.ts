// Pure-function coverage for the transfer-other queue-item contract: parsing
// the untrusted JSON blob apps/api writes, resolving intent-relative paths
// against the shared dir, and mapping a flow outcome to the queue patch. None
// of this touches a browser or the filesystem's real queue dir.
//
// Run with `bun test`.

import { describe, expect, it } from "bun:test";
import {
  mapFlowOutcomeToPatch,
  parseTransferOtherRequest,
  resolveSharedPath,
  slipFileBasename,
} from "../src/lib/transfer-other-queue";

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
