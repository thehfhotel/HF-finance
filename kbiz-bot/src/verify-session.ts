import { withSession, ensureLoggedIn } from "./lib/session";

await withSession(async (_ctx, page) => {
  await ensureLoggedIn(page);
  console.log(`   final URL: ${page.url()}`);
  console.log("✅ Session valid.");
  await page.waitForTimeout(1_000);
});
