import { chromium, type BrowserContext, type Page } from "playwright";
import { resolve } from "node:path";

const USER_DATA_DIR = resolve("browser-data");
const LOGIN_URL = "https://kbiz.kasikornbank.com/authen/login.jsp?lang=en";
const DASHBOARD_URL = "https://kbiz.kasikornbank.com/menu/account/account-summary";

/**
 * Run `fn` inside a single Playwright persistent context anchored at
 * `browser-data/`. The same Chromium profile (cookies, localStorage,
 * fingerprint) is reused across every script — KBIZ sees one continuous
 * browser, so no "signed in on another device" conflicts and no need to
 * relogin between scripts as long as the server session is still alive.
 */
export async function withSession<T>(fn: (ctx: BrowserContext, page: Page) => Promise<T>): Promise<T> {
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless: false,
    slowMo: 50,
    viewport: { width: 1366, height: 800 },
  });
  ctx.on("page", (p) =>
    p.on("framenavigated", (frame) => {
      if (frame === p.mainFrame()) console.log(`   ↳ ${frame.url()}`);
    })
  );
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  try {
    return await fn(ctx, page);
  } finally {
    await ctx.close();
  }
}

/**
 * Ensure we are logged into KBIZ. Cheap if already authenticated (one
 * navigation check); does the username/password flow only when needed.
 */
export async function ensureLoggedIn(page: Page): Promise<void> {
  console.log("→ Checking session …");
  await page.goto(DASHBOARD_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  if (/\/menu\//.test(page.url())) {
    console.log("✓ Already logged in.");
    return;
  }
  console.log("→ Session expired or absent — logging in …");

  const username = process.env.KBIZ_USERNAME;
  const password = process.env.KBIZ_PASSWORD;
  if (!username || !password) throw new Error("Set KBIZ_USERNAME and KBIZ_PASSWORD in kbiz-bot/.env");

  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.locator("#userName").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#userName").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#loginBtn").click();

  await page.waitForURL(
    (url) => {
      const p = url.pathname.toLowerCase();
      return !p.includes("login") && !p.includes("authen");
    },
    { timeout: 60_000 }
  );
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  console.log("✓ Logged in.");
}
