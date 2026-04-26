import { withSession, ensureLoggedIn } from "./lib/session";

await withSession(async (_ctx, page) => {
  await ensureLoggedIn(page);
  console.log(`   final URL: ${page.url()}`);
  console.log("✅ Logged in. Persistent profile saved to browser-data/.");
  await page.waitForTimeout(2_000);
});
