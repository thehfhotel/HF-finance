import { chromium, type BrowserContext, type Page } from "playwright";
import { resolve } from "node:path";
import { isUnauthenticatedUrl } from "./approval-wait";

const USER_DATA_DIR = resolve("browser-data");
// lang=th since 2026-08-12: the picker's Account Name column renders the
// bank's THAI name-on-account under a Thai session (English romanizes it),
// and reimbursement wants Thai names. Every text matcher that navigates the
// UI is bilingual, and bank matching goes through aliasesForBank().
const LOGIN_URL = "https://kbiz.kasikornbank.com/authen/login.jsp?lang=th";
const DASHBOARD_URL = "https://kbiz.kasikornbank.com/menu/account/account-summary";

// Moved to approval-wait.ts (a pure, playwright-free module) so the
// post-"Next" approval wait loop can import it without dragging playwright
// into `bun test`. Re-exported here so every existing importer of
// session.ts (this file's own use below, transfer-other-flow.ts:3) keeps
// working unchanged.
export { isUnauthenticatedUrl };

export async function withSession<T>(fn: (ctx: BrowserContext, page: Page) => Promise<T>): Promise<T> {
  const headless = process.env.KBIZ_HEADLESS === "1";
  const ctx = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    slowMo: headless ? 0 : 50,
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
 *
 * KBIZ does an async session check after initial render, so we stabilize
 * for a moment before judging the URL.
 */
export async function gotoAuthenticated(page: Page, url: string): Promise<void> {
  const tryOnce = async () => {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
    // KBIZ runs an async session check on every navigation — sometimes it
    // takes 2-5 seconds before the SPA decides to bounce to /error. We
    // poll the URL + the visible "session expired" text up to 6s, and
    // declare success only if neither shows up.
    for (let i = 0; i < 12; i++) {
      await page.waitForTimeout(500);
      if (isUnauthenticatedUrl(page.url())) return false;
      const sessionDead = await page
        .evaluate(() => /Sorry[\s\S]+session has expired|session expired or you are signed in|เซสชัน(?:ของคุณ)?หมดอายุ|หมดเวลาการใช้งาน|เข้าสู่ระบบจากอุปกรณ์อื่น/i.test((document.body as HTMLElement).innerText))
        .catch(() => false);
      if (sessionDead) return false;
    }
    return !isUnauthenticatedUrl(page.url());
  };

  console.log("→ Navigating to", url);
  if (await tryOnce()) return;

  console.log("   bounced to", page.url(), "— recovering");
  await loginFlow(page);
  console.log("→ Retrying", url);
  if (await tryOnce()) return;

  throw new Error(`After re-login still bouncing — final URL: ${page.url()}`);
}

export async function ensureLoggedIn(page: Page): Promise<void> {
  await gotoAuthenticated(page, DASHBOARD_URL);
}
