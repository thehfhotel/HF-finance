import { readFile } from "node:fs/promises";

const PATH = process.env.REGISTERED_PATH ?? "data/kbiz-registered.json";

export type RegisteredEntry = {
  accountNumber: string;
  // The bank's romanized name-on-account (e.g. "MS. SALINTHIP PETRAK").
  accountName: string;
  // The Thai payee name on the KBIZ record. Absent in caches written before
  // the scraper started capturing it.
  payeeName?: string;
};

export type RegisteredFile = {
  fetchedAt: string;
  count: number;
  accounts: RegisteredEntry[];
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

export async function registeredByNumber(): Promise<Map<string, RegisteredEntry>> {
  const f = await loadRegistered();
  return new Map(f?.accounts.map((a) => [a.accountNumber, a]) ?? []);
}
