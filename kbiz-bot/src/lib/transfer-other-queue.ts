import { basename, resolve } from "node:path";

/**
 * The `transfer-other` queue-item shape, written by reimbursement's apps/api
 * and driven forward by kbiz-bot. This mirrors reimbursement's
 * `KbizPaymentIntent` (packages/shared/src/index.ts) field-for-field — it is a
 * cross-repo JSON contract, not a shared import (kbiz-bot lives in a separate
 * repo). Keep names/values in lockstep with
 * docs/adr/0001-kbiz-transfer-automation.md in the reimbursement repo; a
 * drift here silently breaks the pipeline.
 */
export interface TransferOtherQueueRequest {
  /** Unique per attempt, and also the queue filename. */
  id: string;
  app: "reimbursement";
  type: "transfer-other";
  /** Only `"approved"` is ever picked up; the rest are states the bot writes. */
  status: "approved" | "running" | "done" | "failed" | "needs-review";
  createdAt: string;
  /** The bundle this pays. */
  bundleId: string;
  payee: { handle: string };
  /** Baht, e.g. 1234.5. */
  amount: number;
  /** Already sanitized by reimbursement's buildKbizMemo; the flow sanitizes again anyway. */
  memo: string;
  /** One of KBIZ's picker anchor ids, e.g. "10". */
  kbizCategoryId: string;
  /** Path relative to the shared dir, e.g. "vouchers/<id>.html". Omitted = no attachment. */
  voucherFile?: string;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  result?: {
    outcome: "success" | "confirmed-failed" | "unconfirmed";
    reference?: string;
    /** Basename only (e.g. "<id>.png"), living in the shared slips/ dir. */
    slipFile?: string;
    error?: string;
    finalUrl?: string;
    finishedAt?: string;
  };
}

/**
 * Validate + narrow a raw queue-file JSON blob into a TransferOtherQueueRequest.
 * apps/api writes this file over a shared filesystem mount — this is the
 * defensive boundary where we stop trusting it blindly and throw a
 * descriptive error naming the missing/malformed field, rather than crashing
 * deep inside the Playwright flow (or worse, silently doing the wrong thing
 * with `undefined`).
 */
export function parseTransferOtherRequest(raw: unknown): TransferOtherQueueRequest {
  if (!raw || typeof raw !== "object") throw new Error("transfer-other queue item is not a JSON object");
  const r = raw as Record<string, unknown>;
  const tag = typeof r.id === "string" && r.id ? r.id : "<unknown id>";

  if (typeof r.id !== "string" || !r.id) throw new Error('transfer-other queue item is missing "id"');
  if (r.type !== "transfer-other") {
    throw new Error(`${tag}: "type" is ${JSON.stringify(r.type)}, expected "transfer-other"`);
  }
  if (typeof r.bundleId !== "string" || !r.bundleId) throw new Error(`${tag}: missing "bundleId"`);

  const payee = r.payee as { handle?: unknown } | undefined;
  if (!payee || typeof payee !== "object" || typeof payee.handle !== "string" || !payee.handle) {
    throw new Error(`${tag}: missing "payee.handle"`);
  }
  if (typeof r.amount !== "number" || !Number.isFinite(r.amount) || r.amount <= 0) {
    throw new Error(`${tag}: "amount" must be a positive finite number, got ${JSON.stringify(r.amount)}`);
  }
  if (typeof r.memo !== "string") throw new Error(`${tag}: missing "memo"`);
  if (typeof r.kbizCategoryId !== "string" || !r.kbizCategoryId) {
    throw new Error(`${tag}: missing "kbizCategoryId"`);
  }
  if (r.voucherFile !== undefined && typeof r.voucherFile !== "string") {
    throw new Error(`${tag}: "voucherFile" must be a string when present`);
  }
  const STATUSES = new Set(["approved", "running", "done", "failed", "needs-review"]);
  if (typeof r.status !== "string" || !STATUSES.has(r.status)) {
    throw new Error(`${tag}: "status" is ${JSON.stringify(r.status)}, expected one of ${[...STATUSES].join(", ")}`);
  }

  return r as unknown as TransferOtherQueueRequest;
}

/**
 * Resolve an intent-relative path (e.g. `voucherFile: "vouchers/<id>.html"`)
 * against the shared queue-dir root, refusing anything that would resolve
 * outside it. The queue file arrives over a filesystem mount written by a
 * different process — a stray `../../` in `voucherFile` should fail closed,
 * not read whatever path it happens to land on.
 */
export function resolveSharedPath(sharedDir: string, relPath: string): string {
  const root = resolve(sharedDir);
  const target = resolve(root, relPath);
  if (target !== root && !target.startsWith(root + "/")) {
    throw new Error(`"${relPath}" resolves outside the shared dir (${root})`);
  }
  return target;
}

/** Basename of a captured slip file — the BASENAME-ONLY form `result.slipFile` contracts on. */
export function slipFileBasename(absSlipPath: string): string {
  return basename(absSlipPath);
}

export type TransferOtherQueuePatch = {
  status: "done" | "failed" | "needs-review";
  result: NonNullable<TransferOtherQueueRequest["result"]>;
};

/** What runTransferOtherFlow (or a pre-flight check before it ever runs) reported. */
export interface FlowOutcomeInput {
  success: boolean;
  /** Only meaningful when `success` is false; absent = failed before the phone push was armed. */
  outcome?: "confirmed-failed" | "unconfirmed";
  error?: string;
  reference?: string;
  finalUrl?: string;
  slipFile?: string;
}

/**
 * Map a flow outcome to the queue-file patch the bot writes back. Pure so the
 * three-way success / confirmed-failed / unconfirmed split (money-safety
 * decision 3 in docs/adr/0001-kbiz-transfer-automation.md) can be unit-tested
 * without a browser.
 *
 * A failure with no `outcome` at all — payee resolution, the ceiling check,
 * anything that failed before Next was ever clicked — is filed the same as
 * `confirmed-failed`: nothing moved, safe to retry. Only a genuine
 * `unconfirmed` (timed out / crashed after the phone push was armed) is
 * routed to `needs-review`, which reimbursement never auto-retries.
 */
export function mapFlowOutcomeToPatch(flow: FlowOutcomeInput, finishedAt: string = new Date().toISOString()): TransferOtherQueuePatch {
  if (flow.success) {
    return {
      status: "done",
      result: { outcome: "success", reference: flow.reference, slipFile: flow.slipFile, finalUrl: flow.finalUrl, finishedAt },
    };
  }
  if (flow.outcome === "unconfirmed") {
    return {
      status: "needs-review",
      result: { outcome: "unconfirmed", error: flow.error, slipFile: flow.slipFile, finalUrl: flow.finalUrl, finishedAt },
    };
  }
  return {
    status: "failed",
    result: { outcome: "confirmed-failed", error: flow.error, slipFile: flow.slipFile, finalUrl: flow.finalUrl, finishedAt },
  };
}
