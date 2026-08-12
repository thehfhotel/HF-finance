import { basename, resolve } from "node:path";
import type { Payee } from "../flows/transfer-other-flow";
import { resolveRecipient, toPayee, type TransferConfig } from "./transfer-config";

/**
 * Where a payment goes, chosen by the approver at pay time. Mirrors
 * reimbursement's `KbizDestination` (packages/shared/src/index.ts) — same
 * cross-repo JSON contract as the intent itself.
 *
 *  - "handle": the admin-mapped payee; the bot's own gitignored payee book
 *    resolves it, exactly as before the picker existed.
 *  - "favorite": a synced KBIZ saved account. Carries NO full account number
 *    (the synced list is masked); the flow verifies nickname + bank + last-4
 *    against the live picker and requires exactly one match.
 *  - "custom": a typed destination — the one kind that must carry the full
 *    number, because the bot has to type it into KBIZ.
 */
export type QueueDestination =
  | { kind: "handle"; handle: string }
  | { kind: "favorite"; nickname: string; bank: string; accountLast4: string; accountName?: string }
  | { kind: "custom"; bank: string; accountNo: string; accountName?: string };

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
  /**
   * The pre-picker way of naming a payee: an admin-mapped handle. Writers set
   * it only for a `kind: "handle"` destination and `null` otherwise, so
   * readers PREFER `destination` and fall back here for older intents.
   */
  payee: { handle: string } | null;
  /**
   * Where the money goes. Deliberately untyped at parse time: a malformed
   * destination must FAIL the item with a clear error (parseDestination, at
   * resolve time), not make the whole file unreadable — an unparseable file
   * is skipped by listApproved and would sit "approved" forever while
   * reimbursement shows the bundle stuck in `paying`.
   */
  destination?: unknown;
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

  // A destination supersedes payee.handle, so payee may legitimately be null
  // whenever one is present — its own validation happens in parseDestination,
  // where a bad value fails the item instead of hiding the whole file.
  const payee = r.payee as { handle?: unknown } | null | undefined;
  const hasDestination = r.destination !== undefined && r.destination !== null;
  if (!hasDestination && (!payee || typeof payee !== "object" || typeof payee.handle !== "string" || !payee.handle)) {
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

/** KBIZ account numbers render with dashes/spaces; both are pure formatting. */
const ACCOUNT_SEPARATORS = /[\s-]+/g;

/**
 * Validate a typed ("custom") account number: 8–15 digits once the separators
 * are stripped, and nothing else. Thai account numbers are 10 digits (12 for
 * some banks), so this rejects a truncated paste or a mistyped field without
 * pinning one bank's format.
 *
 * The number itself is NEVER echoed in the error — that string ends up in the
 * queue file, the approver's screen and Slack.
 */
export function normalizeCustomAccountNo(raw: string, tag: string): string {
  const stripped = raw.replace(ACCOUNT_SEPARATORS, "");
  if (!/^\d+$/.test(stripped)) {
    throw new Error(`${tag}: custom destination "accountNo" must be digits (with optional spaces/dashes)`);
  }
  if (stripped.length < 8 || stripped.length > 15) {
    throw new Error(`${tag}: custom destination "accountNo" must be 8–15 digits, got ${stripped.length}`);
  }
  return stripped;
}

/**
 * Validate + narrow the intent's `destination`. Every failure names the field,
 * because this is the one place a picker bug on reimbursement's side becomes
 * visible: the item fails with the message the approver reads.
 */
export function parseDestination(raw: unknown, tag = "destination"): QueueDestination {
  if (!raw || typeof raw !== "object") {
    throw new Error(`${tag}: "destination" must be an object, got ${JSON.stringify(raw)}`);
  }
  const d = raw as Record<string, unknown>;
  const kind = typeof d.kind === "string" ? d.kind : "";

  const required = (key: string): string => {
    const v = d[key];
    if (typeof v !== "string" || !v.trim()) {
      throw new Error(`${tag}: "${kind}" destination is missing "${key}"`);
    }
    return v.trim();
  };
  const optional = (key: string): string | undefined => {
    const v = d[key];
    if (v === undefined || v === null) return undefined;
    if (typeof v !== "string") throw new Error(`${tag}: destination "${key}" must be a string when present`);
    return v.trim() || undefined;
  };

  switch (kind) {
    case "handle":
      return { kind: "handle", handle: required("handle") };
    case "favorite": {
      const accountLast4 = required("accountLast4").replace(/\D+/g, "");
      if (accountLast4.length !== 4) {
        throw new Error(`${tag}: favorite destination "accountLast4" must be exactly 4 digits`);
      }
      return {
        kind: "favorite",
        nickname: required("nickname"),
        bank: required("bank"),
        accountLast4,
        accountName: optional("accountName"),
      };
    }
    case "custom":
      return {
        kind: "custom",
        bank: required("bank"),
        accountNo: normalizeCustomAccountNo(required("accountNo"), tag),
        accountName: optional("accountName"),
      };
    default:
      throw new Error(`${tag}: unknown destination kind ${JSON.stringify(d.kind)} — expected "handle", "favorite" or "custom"`);
  }
}

/** Resolve a payee-book handle into the flow's Payee. Never guesses a payee. */
function payeeForHandle(config: TransferConfig, handle: string): Payee {
  try {
    return toPayee(resolveRecipient(config, handle).recipient);
  } catch (e) {
    throw new Error(`Unknown payee handle "${handle}": ${(e as Error).message}`);
  }
}

/**
 * The intent's destination as the flow's Payee.
 *
 * `destination` wins whenever it is present — `payee.handle` is only the
 * fallback for intents written before the picker existed. A "favorite" gets
 * NO account number (the synced list is masked; the flow verifies against the
 * live picker by nickname + bank + last-4), and a "custom" gets the validated
 * digits it will type. Anything unrecognized throws, and the caller files the
 * item as failed — nothing has been submitted to KBIZ at this point.
 */
export function resolveQueuePayee(
  req: Pick<TransferOtherQueueRequest, "id" | "payee" | "destination">,
  config: TransferConfig,
): Payee {
  if (req.destination !== undefined && req.destination !== null) {
    const dest = parseDestination(req.destination, req.id);
    if (dest.kind === "favorite") {
      return {
        mode: "favorite",
        nickname: dest.nickname,
        bank: dest.bank,
        accountLast4: dest.accountLast4,
        accountName: dest.accountName,
      };
    }
    if (dest.kind === "custom") {
      return { mode: "custom", bank: dest.bank, accountNo: dest.accountNo, accountName: dest.accountName };
    }
    return payeeForHandle(config, dest.handle);
  }

  if (req.payee?.handle) return payeeForHandle(config, req.payee.handle);
  throw new Error(`${req.id}: intent carries neither a "destination" nor a "payee.handle" — nothing to pay.`);
}

/**
 * One-line destination for logs and Slack. A CUSTOM destination is shown as
 * bank + last 4 ONLY: it is the single kind carrying a full account number,
 * and Slack is not where that belongs. Never throws — a broken destination
 * still has to be reportable.
 */
export function describeDestination(req: Pick<TransferOtherQueueRequest, "payee" | "destination">): string {
  if (req.destination === undefined || req.destination === null) {
    return req.payee?.handle ? `handle "${req.payee.handle}"` : "no destination";
  }
  let dest: QueueDestination;
  try {
    dest = parseDestination(req.destination);
  } catch {
    return "unparseable destination";
  }
  if (dest.kind === "handle") return `handle "${dest.handle}"`;
  if (dest.kind === "favorite") return `favorite "${dest.nickname}" (${dest.bank} …${dest.accountLast4})`;
  return `custom (${dest.bank} …${dest.accountNo.slice(-4)})`;
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
