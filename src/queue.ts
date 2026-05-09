import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Sheet } from "./sheets";

const QUEUE_DIR = process.env.QUEUE_DIR ?? "data/queue";

export type RequestType = "add-payroll" | "transfer-payroll";
export type Status = "pending" | "approved" | "rejected" | "running" | "done" | "failed";

export type AddPayrollSummary = {
  type: "add-payroll";
  accounts: { accountNumber: string; accountName: string }[];
};

export type TransferSummary = {
  type: "transfer-payroll";
  effectiveDate: string;
  totalAmount: number;
  rows: { accountNumber: string; accountName: string; amount: number }[];
  // Period (YYYY-MM) and full worksheet snapshot are recorded at submission
  // time so the historical view can show the breakdown (deductions, additions,
  // notes) exactly as the operator saw it. Older queue items predate this
  // and have neither field — the snapshot UI gracefully falls back to the
  // bare row list in that case.
  period?: string;
  sheet?: Sheet;
};

export type Summary = AddPayrollSummary | TransferSummary;

export type QueueResult = {
  success: boolean;
  finalUrl?: string;
  referenceNo?: string;
  error?: string;
};

export type QueueRequest = {
  id: string;
  type: RequestType;
  status: Status;
  summary: Summary;
  xlsxPath: string;
  createdAt: string;
  updatedAt: string;
  approvedAt?: string;
  rejectedAt?: string;
  rejectionReason?: string;
  startedAt?: string;
  completedAt?: string;
  result?: QueueResult;
};

function newId(): string {
  const now = new Date();
  const stamp = now.toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${stamp}-${rand}`;
}

async function ensureDir(): Promise<void> {
  await mkdir(QUEUE_DIR, { recursive: true });
}

function metaPath(id: string): string {
  return join(QUEUE_DIR, `${id}.json`);
}

export async function submitRequest(input: {
  type: RequestType;
  summary: Summary;
  xlsxBuffer: Buffer;
}): Promise<QueueRequest> {
  await ensureDir();
  const id = newId();
  const now = new Date().toISOString();
  const xlsxPath = join(QUEUE_DIR, `${id}.xlsx`);
  await writeFile(xlsxPath, input.xlsxBuffer);
  const req: QueueRequest = {
    id,
    type: input.type,
    status: "pending",
    summary: input.summary,
    xlsxPath,
    createdAt: now,
    updatedAt: now,
  };
  await writeFile(metaPath(id), JSON.stringify(req, null, 2), "utf8");
  return req;
}

export async function listRequests(): Promise<QueueRequest[]> {
  await ensureDir();
  const files = await readdir(QUEUE_DIR);
  const reqs: QueueRequest[] = [];
  for (const f of files) {
    if (!f.endsWith(".json")) continue;
    try {
      const buf = await readFile(join(QUEUE_DIR, f), "utf8");
      reqs.push(JSON.parse(buf) as QueueRequest);
    } catch {}
  }
  reqs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return reqs;
}

export async function getRequest(id: string): Promise<QueueRequest | null> {
  try {
    const buf = await readFile(metaPath(id), "utf8");
    return JSON.parse(buf) as QueueRequest;
  } catch {
    return null;
  }
}

export async function updateRequest(id: string, patch: Partial<QueueRequest>): Promise<QueueRequest> {
  const existing = await getRequest(id);
  if (!existing) throw new Error(`Request ${id} not found`);
  const updated: QueueRequest = {
    ...existing,
    ...patch,
    id: existing.id,
    updatedAt: new Date().toISOString(),
  };
  await writeFile(metaPath(id), JSON.stringify(updated, null, 2), "utf8");
  return updated;
}
