import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SEED_ACCOUNTS } from "./seed";
import { registeredByNumber } from "./registered";

const DATA_PATH = process.env.DATA_PATH ?? "data/accounts.json";

export type Account = {
  id: string;
  accountNumber: string;
  accountName: string;
  // What the operator typed. KBIZ overwrites accountName on every sync, so
  // this is the only surviving copy of the provisional entry — it's what a
  // name disagreement is measured against. Never rewritten by a sync.
  enteredName?: string;
};

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

/**
 * KBIZ is the source of truth for ชื่อบัญชี: once an account is registered
 * with the bank, the Thai payee name on the KBIZ record replaces whatever was
 * typed here, on every sync — including when the two disagree.
 *
 * What was typed is preserved in `enteredName` instead of being discarded, so
 * a disagreement stays visible (see nameMismatch on /api/accounts). The local
 * entry is a check on the bank's record, not an override of it.
 *
 * Applied on read rather than on a sync event, because the sync runs in the
 * kbiz-bot container and only rewrites data/kbiz-registered.json — the app
 * gets no callback. Idempotent, and persists so the name survives the bank
 * cache going missing.
 */
async function applyBankNames(list: Account[]): Promise<Account[]> {
  const registered = await registeredByNumber();
  if (registered.size === 0) return list;
  let changed = false;
  for (const a of list) {
    const bankName = registered.get(a.accountNumber)?.payeeName?.trim();
    if (!bankName) continue;
    if (a.enteredName === undefined) {
      a.enteredName = a.accountName;
      changed = true;
    }
    if (bankName !== a.accountName) {
      a.accountName = bankName;
      changed = true;
    }
  }
  if (changed) await persist();
  return list;
}

export async function listAccounts(): Promise<Account[]> {
  return [...(await applyBankNames(await load()))];
}

export async function addAccount(input: { accountNumber: string; accountName: string }): Promise<Account> {
  const list = await load();
  const item: Account = {
    id: nextId(list),
    accountNumber: normalizeAccountNumber(input.accountNumber),
    accountName: input.accountName.trim(),
    enteredName: input.accountName.trim(),
  };
  list.push(item);
  await persist();
  return item;
}

export async function updateAccount(id: string, input: { accountNumber: string; accountName: string }): Promise<Account> {
  const list = await load();
  const idx = list.findIndex((a) => a.id === id);
  if (idx === -1) throw new Error("not found");
  // Re-typing the name is how an operator resolves a disagreement with the
  // bank, so an edit always resets the provisional entry too.
  list[idx] = {
    id,
    accountNumber: normalizeAccountNumber(input.accountNumber),
    accountName: input.accountName.trim(),
    enteredName: input.accountName.trim(),
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
