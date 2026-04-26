import { chromium } from "playwright";

const LOGIN_URL = "https://kbiz.kasikornbank.com/authen/login.jsp?lang=en";
const STATE_PATH = "storageState.json";

async function main() {
  const username = process.env.KBIZ_USERNAME;
  const password = process.env.KBIZ_PASSWORD;
  if (!username || !password) {
    throw new Error("Set KBIZ_USERNAME and KBIZ_PASSWORD in kbiz-bot/.env");
  }

  console.log("→ Launching browser (headful) …");
  const browser = await chromium.launch({ headless: false, slowMo: 50 });
  const context = await browser.newContext({ viewport: { width: 1366, height: 800 } });
  const page = await context.newPage();

  page.on("framenavigated", (frame) => {
    if (frame === page.mainFrame()) console.log(`   ↳ navigated: ${frame.url()}`);
  });

  console.log("→ Opening", LOGIN_URL);
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  // Selectors confirmed via probe2.ts against the live login page:
  //   #userName  text input
  //   #password  password input
  //   #loginBtn  <a> styled as button (NOT <button>) — must be clicked, not submitted
  console.log("→ Filling User ID / Password …");
  await page.locator("#userName").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#userName").fill(username);
  await page.locator("#password").fill(password);

  console.log("→ Submitting login …");
  await page.locator("#loginBtn").click();

  // KBIZ login flow (post-update — phone-app approval no longer required):
  //   login.jsp → loginAuthen.do → /login?dataRsso=... → final dashboard URL
  // Wait for a URL with no "login" and no "authen" substring to skip past
  // the SSO bounce and land on the real dashboard.
  console.log("→ Waiting for dashboard …");
  await page.waitForURL(
    (url) => {
      const p = url.pathname.toLowerCase();
      return !p.includes("login") && !p.includes("authen");
    },
    { timeout: 60_000 }
  );
  // Let any deferred dashboard XHRs settle so their cookies make it into state.
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  console.log("→ Saving session to", STATE_PATH);
  await context.storageState({ path: STATE_PATH });
  console.log(`   final URL: ${page.url()}`);

  console.log("✅ Login complete. You can close the browser when ready.");
  // Keep the browser open for a moment so the user can verify visually.
  await page.waitForTimeout(3_000);
  await browser.close();
}

main().catch((e) => {
  console.error("❌ Failed:", (e as Error).message);
  process.exit(1);
});
