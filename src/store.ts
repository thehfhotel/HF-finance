import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SEED_ACCOUNTS } from "./seed";

const DATA_PATH = process.env.DATA_PATH ?? "data/accounts.json";

export type Account = { id: string; accountNumber: string; accountName: string };

let cache: Account[] | null = null;

async function load(): Promise<Account[]> {
  if (cache) return cache;
  try {
    const buf = await readFile(DATA_PATH, "utf8");
    cache = JSON.parse(buf) as Account[];
  } catch {
    cache = SEED_ACCOUNTS.map((a) => ({ ...a }));
    await persist();
  }
  return cache!;
}

async function persist() {
  if (!cache) return;
  await mkdir(dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(cache, null, 2), "utf8");
}

function nextId(items: Account[]) {
  const max = items.reduce((m, a) => Math.max(m, parseInt(a.id, 10) || 0), 0);
  return String(max + 1);
}

export function normalizeAccountNumber(n: string) {
  return n.replace(/[\s-]/g, "");
}

export async function listAccounts(): Promise<Account[]> {
  return [...(await load())];
}

export async function addAccount(input: { accountNumber: string; accountName: string }): Promise<Account> {
  const list = await load();
  const item: Account = {
    id: nextId(list),
    accountNumber: normalizeAccountNumber(input.accountNumber),
    accountName: input.accountName.trim(),
  };
  list.push(item);
  await persist();
  return item;
}

export async function updateAccount(id: string, input: { accountNumber: string; accountName: string }): Promise<Account> {
  const list = await load();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("not found");
  list[idx] = {
    id,
    accountNumber: normalizeAccountNumber(input.accountNumber),
    accountName: input.accountName.trim(),
  };
  await persist();
  return list[idx];
}

export async function deleteAccount(id: string): Promise<void> {
  const list = await load();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("not found");
  list.splice(idx, 1);
  await persist();
}
