import { chromium } from "playwright";
import { existsSync } from "node:fs";

const STATE_PATH = "storageState.json";
const HOME_URL = "https://kbiz.kasikornbank.com/menu/account/account-summary";

async function main() {
  if (!existsSync(STATE_PATH)) {
    throw new Error(`No ${STATE_PATH}. Run 'npm run login' first.`);
  }

  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ storageState: STATE_PATH });
  const page = await context.newPage();

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log(`   ↳ ${frame.url()}`);
  });

  console.log("→ Opening", HOME_URL, "with saved cookies …");
  await page.goto(HOME_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  const final = page.url();
  const looksLoggedIn = !/login|authen/i.test(final);
  console.log(`\n   final URL: ${final}`);
  console.log(`   verdict: ${looksLoggedIn ? "✅ session valid" : "❌ session NOT valid (bounced to login)"}`);

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((e) => {
  console.error("❌", (e as Error).message);
  process.exit(1);
});
