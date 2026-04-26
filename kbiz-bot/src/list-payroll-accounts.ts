import { withSession, gotoAuthenticated } from "./lib/session";
import { scrapeRegisteredAccounts } from "./lib/scrape-registered";

const LIST_URL = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";

await withSession(async (_ctx, page) => {
  await gotoAuthenticated(page, LIST_URL);
  const reg = await scrapeRegisteredAccounts(page);
  console.log(`✓ ${reg.count} registered accounts written to data/kbiz-registered.json`);
  for (const a of reg.accounts.slice(0, 5)) console.log("  -", a.accountNumber, a.accountName);
  if (reg.accounts.length > 5) console.log("  …");
});
