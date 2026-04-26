import type { Account } from "./store";

// Bootstrap-only fallback when data/accounts.json doesn't yet exist.
// Production has its own data/accounts.json (bind-mounted), so this stays empty.
// Operators add accounts through the /accounts UI.
export const SEED_ACCOUNTS: Account[] = [];
