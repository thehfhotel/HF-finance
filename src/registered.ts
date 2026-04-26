import { readFile } from "node:fs/promises";

const PATH = process.env.REGISTERED_PATH ?? "data/kbiz-registered.json";

export type RegisteredFile = {
  fetchedAt: string;
  count: number;
  accounts: { accountNumber: string; accountName: string }[];
};

// Re-read on every call (file is small, mutates rarely, simpler than cache invalidation)
export async function loadRegistered(): Promise<RegisteredFile | null> {
  try {
    const buf = await readFile(PATH, "utf8");
    return JSON.parse(buf) as RegisteredFile;
  } catch {
    return null;
  }
}

export async function registeredSet(): Promise<Set<string>> {
  const f = await loadRegistered();
  return new Set(f?.accounts.map((a) => a.accountNumber) ?? []);
}
