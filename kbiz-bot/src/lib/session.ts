import { chromium, type BrowserContext, type Page } from "playwright";
import { resolve } from "node:path";

const USER_DATA_DIR = resolve("browser-data");
const LOGIN_URL = "https://kbiz.kasikornbank.com/authen/login.jsp?lang=en";
const DASHBOARD_URL = "https://kbiz.kasikornbank.com/menu/account/account-summary";

const isUnauthenticatedUrl = (url: string) => /\/error\b|\/login(\?|$)|\/authen\//.test(url);

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

async function loginFlow(page: Page): Promise<void> {
  const username = process.env.KBIZ_USERNAME;
  const password = process.env.KBIZ_PASSWORD;
  if (!username || !password) throw new Error("Set KBIZ_USERNAME and KBIZ_PASSWORD in kbiz-bot/.env");

  console.log("→ Logging in …");
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.locator("#userName").waitFor({ state: "visible", timeout: 30_000 });
  await page.locator("#userName").fill(username);
  await page.locator("#password").fill(password);
  await page.locator("#loginBtn").click();
  await page.waitForURL((url) => !isUnauthenticatedUrl(url.toString()), { timeout: 60_000 });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  console.log("✓ Logged in");
}

/**
 * Navigate to `url` as an authenticated user. If KBIZ bounces us to
 * /error, /login, or /authen — recover by re-running loginFlow once and
 * retrying the target. The /error page even tells the user "Go to login
 * page"; we just do that programmatically.
 */
export async function gotoAuthenticated(page: Page, url: string): Promise<void> {
  console.log("→ Navigating to", url);
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});

  if (isUnauthenticatedUrl(page.url())) {
    console.log("   bounced to", page.url(), "— recovering");
    await loginFlow(page);
    console.log("→ Retrying", url);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    if (isUnauthenticatedUrl(page.url())) {
      throw new Error(`After re-login still bouncing — final URL: ${page.url()}`);
    }
  }
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await gotoAuthenticated(page, DASHBOARD_URL);
}
