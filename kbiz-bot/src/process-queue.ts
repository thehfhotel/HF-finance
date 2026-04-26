import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { withSession } from "./lib/session";
import { runAddPayrollFlow } from "./flows/add-payroll-flow";
import { runTransferPayrollFlow } from "./flows/transfer-payroll-flow";

const QUEUE_DIR = resolve("..", "data", "queue");
const SLACK = process.env.SLACK_WEBHOOK_URL;

type QueueRequest = {
  id: string;
  type: "add-payroll" | "transfer-payroll";
  status: string;
  xlsxPath: string;
  summary: any;
  result?: { success: boolean; finalUrl?: string; error?: string };
};

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
      const req = JSON.parse(buf) as QueueRequest;
      if (req.status === "approved") out.push(req);
    } catch {}
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

async function patchRequest(id: string, patch: Partial<QueueRequest>): Promise<void> {
  const path = join(QUEUE_DIR, `${id}.json`);
  const buf = await readFile(path, "utf8");
  const req = JSON.parse(buf);
  Object.assign(req, patch, { updatedAt: new Date().toISOString() });
  await writeFile(path, JSON.stringify(req, null, 2), "utf8");
}

async function main() {
  const approved = await listApproved();
  if (approved.length === 0) {
    console.log("No approved requests in queue.");
    return;
  }
  console.log(`Processing ${approved.length} approved request(s) …`);

  // Single browser session, single Chromium launch — run all approved jobs in
  // sequence. KBIZ kills concurrent sessions, so doing them serially is the
  // only safe option anyway.
  await withSession(async (_ctx, page) => {
    for (const req of approved) {
      console.log(`\n=== ${req.id}  (${req.type}) ===`);
      // Resolve xlsx path: payroll-form stored it relative to its CWD (data/queue/...);
      // when read from kbiz-bot/ we need to climb one level.
      const xlsxAbs = req.xlsxPath.startsWith("data/")
        ? resolve("..", req.xlsxPath)
        : resolve(req.xlsxPath);

      await patchRequest(req.id, { status: "running", startedAt: new Date().toISOString() });
      await notifySlack(`:hourglass_flowing_sand: Running \`${req.id}\` (${req.type})`);

      try {
        const result =
          req.type === "transfer-payroll"
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

  console.log("\nDone.");
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
