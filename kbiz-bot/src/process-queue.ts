import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import type { Page } from "playwright";
import { withSession, gotoAuthenticated } from "./lib/session";
import { runAddPayrollFlow } from "./flows/add-payroll-flow";
import { runTransferPayrollFlow } from "./flows/transfer-payroll-flow";
import { runTransferOtherFlow } from "./flows/transfer-other-flow";
import { scrapeRegisteredAccounts } from "./lib/scrape-registered";
import { loadTransferConfig, resolveRecipient, toPayee } from "./lib/transfer-config";
import { htmlToPdf } from "./lib/html-to-pdf";
import {
  mapFlowOutcomeToPatch,
  parseTransferOtherRequest,
  resolveSharedPath,
  slipFileBasename,
  type TransferOtherQueuePatch,
  type TransferOtherQueueRequest,
} from "./lib/transfer-other-queue";

// Same page list-payroll-accounts.ts scrapes; a "list-registered" queue item
// is the button-triggered version of that manual script.
const LIST_URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";

// KBIZ_QUEUE_DIR / KBIZ_SHARED_DIR decouple this from the `../data` layout so
// the container can be pointed at a shared cross-repo dir (e.g.
// `/srv/kbiz-queue`) instead. Unset preserves today's behavior exactly.
const QUEUE_DIR = process.env.KBIZ_QUEUE_DIR ? resolve(process.env.KBIZ_QUEUE_DIR) : resolve("..", "data", "queue");
// Root that a transfer-other intent's relative paths (voucherFile) resolve
// against. Defaults to `../data`, matching QUEUE_DIR's and capture-slip's
// default `../data/{queue,slips}` so the three line up unless overridden.
const SHARED_DIR = process.env.KBIZ_SHARED_DIR ? resolve(process.env.KBIZ_SHARED_DIR) : resolve("..", "data");
const SLACK = process.env.SLACK_WEBHOOK_URL;

/** The add-payroll / transfer-payroll / list-registered queue-item shape. */
type PayrollQueueRequest = {
  id: string;
  type: "add-payroll" | "transfer-payroll" | "list-registered";
  status: string;
  xlsxPath: string;
  summary: unknown;
  startedAt?: string;
  completedAt?: string;
  updatedAt?: string;
  result?: { success: boolean; finalUrl?: string; error?: string };
};

type QueueRequest = PayrollQueueRequest | TransferOtherQueueRequest;

async function notifySlack(text: string) {
  if (!SLACK) return;
  try {
    await fetch(SLACK, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
  } catch {}
}

async function listApproved(): Promise<QueueRequest[]> {
  const files = await readdir(QUEUE_DIR).catch(() => [] as string[]);
  const out: QueueRequest[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const buf = await readFile(join(QUEUE_DIR, f), "utf8");
      const parsed = JSON.parse(buf) as { type?: unknown };
      const req: QueueRequest =
        parsed.type === "transfer-other" ? parseTransferOtherRequest(parsed) : (parsed as PayrollQueueRequest);
      if (req.status === "approved") out.push(req);
    } catch (e) {
      console.warn(`⚠ skipping malformed queue file ${f}: ${(e as Error).message}`);
    }
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function patchRequest(id: string, patch: Record<string, unknown>): Promise<void> {
  const path = join(QUEUE_DIR, `${id}.json`);
  const buf = await readFile(path, "utf8");
  const req = JSON.parse(buf);
  Object.assign(req, patch, { updatedAt: new Date().toISOString() });
  await writeFile(path, JSON.stringify(req, null, 2), "utf8");
}

async function runListRegistered(page: Page): Promise<{ success: boolean; finalUrl?: string; error?: string }> {
  await gotoAuthenticated(page, LIST_URL);
  const reg = await scrapeRegisteredAccounts(page); // writes data/kbiz-registered.json
  console.log(`✓ ${reg.count} registered accounts written to data/kbiz-registered.json`);
  return { success: true, finalUrl: LIST_URL };
}

/**
 * Drive a single `transfer-other` intent: resolve the payee from the bot's
 * own config (the intent carries only a handle — see decision 4 in
 * docs/adr/0001-kbiz-transfer-automation.md), best-effort attach the
 * rendered voucher, run the flow with `confirm: true`, and map the outcome
 * to the queue patch the watch loop writes back.
 *
 * Every early-return here happens BEFORE the phone push is ever armed, so it
 * is always safe to file as "nothing moved" (mapFlowOutcomeToPatch's
 * no-outcome branch). Only the flow itself, once Next is clicked, can produce
 * a genuine `unconfirmed`.
 */
async function runTransferOtherQueueItem(page: Page, req: TransferOtherQueueRequest): Promise<TransferOtherQueuePatch> {
  let config;
  try {
    config = loadTransferConfig();
  } catch (e) {
    return mapFlowOutcomeToPatch({ success: false, error: `config: ${(e as Error).message}` });
  }

  let recipient;
  try {
    ({ recipient } = resolveRecipient(config, req.payee.handle));
  } catch (e) {
    // Unknown handle → fail with a clear error. Never guess a payee.
    return mapFlowOutcomeToPatch({ success: false, error: `Unknown payee handle "${req.payee.handle}": ${(e as Error).message}` });
  }

  if (req.amount > config.maxTransfer) {
    return mapFlowOutcomeToPatch({
      success: false,
      error: `Amount ฿${req.amount.toFixed(2)} exceeds config ceiling ฿${config.maxTransfer.toLocaleString()} — refusing.`,
    });
  }

  let attachmentPath: string | undefined;
  if (req.voucherFile) {
    try {
      const htmlPath = resolveSharedPath(SHARED_DIR, req.voucherFile);
      const html = await readFile(htmlPath, "utf8");
      const pdfPath = resolveSharedPath(SHARED_DIR, `vouchers/${req.id}.pdf`);
      const pdf = await htmlToPdf(html, pdfPath);
      if (pdf) attachmentPath = pdf.path;
    } catch (e) {
      console.warn(`⚠ voucher unavailable for ${req.id} (${(e as Error).message}) — proceeding without attachment.`);
    }
  }

  const flow = await runTransferOtherFlow(page, {
    payee: toPayee(recipient),
    amount: req.amount,
    memo: req.memo,
    attachmentPath,
    kbizCategoryId: req.kbizCategoryId,
    slug: req.id,
    maxTransfer: config.maxTransfer,
    confirm: true,
  });

  if (flow.success) {
    return mapFlowOutcomeToPatch({
      success: true,
      reference: flow.reference,
      finalUrl: flow.finalUrl,
      slipFile: flow.slip ? slipFileBasename(flow.slip.screenshotPath) : undefined,
    });
  }
  return mapFlowOutcomeToPatch({
    success: false,
    outcome: flow.outcome === "unconfirmed" ? "unconfirmed" : "confirmed-failed",
    error: flow.error,
    slipFile: flow.shot ? slipFileBasename(flow.shot) : undefined,
  });
}

async function processBatch(): Promise<number> {
  const approved = await listApproved();
  if (approved.length === 0) return 0;
  console.log(`\n[${new Date().toISOString()}] Processing ${approved.length} approved request(s) …`);

  // Single Chromium session, sequential — KBIZ kills concurrent sessions.
  await withSession(async (_ctx, page) => {
    for (const req of approved) {
      console.log(`\n=== ${req.id}  (${req.type}) ===`);
      // The claim. listApproved() snapshots the queue up front and each
      // preceding transfer can wait minutes for a phone tap, so by the time we
      // get here the file may have been WITHDRAWN (reimbursement's stale-sweep
      // archives an intent the bot never started). A vanished file is a clean
      // per-item skip — it must never abort the rest of the batch.
      try {
        await patchRequest(req.id, { status: "running", startedAt: new Date().toISOString() });
      } catch (e) {
        console.log(`↷ ${req.id} skipped — queue file gone before claim (withdrawn?): ${(e as Error).message}`);
        continue;
      }
      await notifySlack(`:hourglass_flowing_sand: Running \`${req.id}\` (${req.type})`);

      if (req.type === "transfer-other") {
        try {
          const patch = await runTransferOtherQueueItem(page, req);
          await patchRequest(req.id, { status: patch.status, result: patch.result, completedAt: new Date().toISOString() });
          const icon = patch.status === "done" ? "✅" : patch.status === "needs-review" ? "⚠️" : "❌";
          const slackIcon = patch.status === "done" ? ":white_check_mark:" : patch.status === "needs-review" ? ":warning:" : ":x:";
          const detail = patch.result.error ? ` — ${patch.result.error}` : patch.result.reference ? ` → ${patch.result.reference}` : "";
          await notifySlack(`${slackIcon} ${patch.status} \`${req.id}\` (transfer-other, bundle ${req.bundleId})${detail}`);
          console.log(`${icon} ${req.id} ${patch.status}`);
        } catch (e) {
          // Unknown crash: we cannot prove the phone push was never armed, so
          // this is filed as needs-review (never auto-retried), not failed —
          // the same "ambiguity is never auto-resolved" rule the flow itself
          // uses for a timeout. See money-safety invariant 2 in the ADR.
          const error = (e as Error).message;
          const patch = mapFlowOutcomeToPatch({ success: false, outcome: "unconfirmed", error: `Crashed: ${error}` });
          await patchRequest(req.id, { status: patch.status, result: patch.result, completedAt: new Date().toISOString() });
          await notifySlack(`:warning: Crashed \`${req.id}\` (transfer-other, bundle ${req.bundleId}) → needs-review — ${error}`);
          console.log(`⚠️ ${req.id} crashed → needs-review: ${error}`);
        }
        continue;
      }

      // list-registered has no workbook (xlsxPath is "")
      const xlsxAbs = req.xlsxPath.startsWith("data/") ? resolve("..", req.xlsxPath) : resolve(req.xlsxPath);

      try {
        const result =
          req.type === "list-registered"
            ? await runListRegistered(page)
            : req.type === "transfer-payroll"
              ? await runTransferPayrollFlow(page, xlsxAbs)
              : await runAddPayrollFlow(page, xlsxAbs);

        if (result.success) {
          await patchRequest(req.id, {
            status: "done",
            completedAt: new Date().toISOString(),
            result: { success: true, finalUrl: result.finalUrl },
          });
          await notifySlack(`:white_check_mark: Done \`${req.id}\` (${req.type}) → ${result.finalUrl}`);
          console.log(`✅ ${req.id} done`);
        } else {
          await patchRequest(req.id, {
            status: "failed",
            completedAt: new Date().toISOString(),
            result: { success: false, error: result.error },
          });
          await notifySlack(`:x: Failed \`${req.id}\` (${req.type}) — ${result.error}`);
          console.log(`❌ ${req.id} failed: ${result.error}`);
        }
      } catch (e) {
        const error = (e as Error).message;
        await patchRequest(req.id, {
          status: "failed",
          completedAt: new Date().toISOString(),
          result: { success: false, error },
        });
        await notifySlack(`:x: Crashed \`${req.id}\` (${req.type}) — ${error}`);
        console.log(`❌ ${req.id} crashed: ${error}`);
      }
    }
  });
  return approved.length;
}

async function main() {
  const watch = process.argv.includes("--watch");
  const intervalMs = Number(process.env.QUEUE_POLL_MS ?? 30_000);

  if (!watch) {
    const n = await processBatch();
    if (n === 0) console.log("No approved requests in queue.");
    return;
  }

  console.log(`Watching ${resolve(QUEUE_DIR)} — polling every ${intervalMs}ms. Ctrl+C to stop.`);
  // First pass immediately
  await processBatch().catch((e) => console.error("batch error:", (e as Error).message));
  // Then loop
  while (true) {
    await new Promise((r) => setTimeout(r, intervalMs));
    try {
      await processBatch();
    } catch (e) {
      console.error("batch error:", (e as Error).message);
    }
  }
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
