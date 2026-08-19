/**
 * ─────────────────────────────────────────────────────────────────────────────
 * apps/web headless boot smoke — the automated version of the manual
 * React-19 / Vite-8 smoke run on 2026-08-19.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * WHY THIS EXISTS
 *
 * `apps/web` had zero automated tests. A React or Vite major can typecheck
 * clean, build clean, and still blow up on the first paint (invalid hook call,
 * a minified React error, an undefined component). And `reimbursement/
 * CLAUDE.md` records the real hazard: mobile and desktop are two INDEPENDENT
 * render paths — mobile through `renderScreen`, desktop through
 * `DesktopApprover` / `DesktopEmployee` — and three bugs shipped through the
 * gap between them with a green typecheck. So a boot gate that only checks one
 * viewport is worth roughly half of nothing.
 *
 * WHAT IT DOES
 *
 *   1. builds the real production bundle (`bun --filter web build`),
 *   2. serves `dist/` from an ephemeral local port with SPA fallback,
 *   3. loads it in a real headless Chromium at 390×844 and 1440×900,
 *   4. fails on any `pageerror`, or any console line matching a React-class
 *      failure (see REACT_ERROR_PATTERNS),
 *   5. asserts `#app` actually mounted a subtree — and, via
 *      `data-render-path`, asserts WHICH render path mounted, so a desktop
 *      regression cannot hide behind a green mobile run.
 *
 * WHY IT IS NOT A `bun test` FILE
 *
 * The ROOT `bun test` suite (payroll-form + kbiz-bot + reimbursement api) runs
 * in CI WITHOUT kbiz-bot's `node_modules`, so nothing it collects may import a
 * browser stack. This file is therefore named `web-boot-smoke.ts` — it matches
 * none of bun's test globs (`*.test.*`, `*_test.*`, `*.spec.*`, `*_spec.*`) and
 * is invisible to `bun test` from any directory. Same trick, same reason, as
 * `kbiz-bot/src/probe-duplicate-popup-dom.ts`. It is also outside `apps/web`'s
 * `tsconfig.json` (`include: ["src"]`), so `tsc -b` does not try to typecheck
 * Bun-side code against a DOM-only lib set.
 *
 * RUN IT
 *
 *   bun --filter web smoke              # from reimbursement/
 *   bun run smoke                       # from apps/web/
 *   bun run test/web-boot-smoke.ts --no-build     # reuse an existing dist/
 *
 * Requires a Chromium: `bunx playwright install chromium`.
 */

import { chromium, type Browser, type ConsoleMessage, type Page } from 'playwright';
import { dirname, join, normalize, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';

const WEB_ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const DIST = join(WEB_ROOT, 'dist');
const ARGS = new Set(Bun.argv.slice(2));
/** Where to drop a screenshot for every FAILED scenario (CI uploads these). */
const ARTIFACT_DIR = process.env.SMOKE_ARTIFACT_DIR ?? join(WEB_ROOT, 'smoke-artifacts');
/** One knob, deliberately generous: a cold Chromium start on a shared CI
 *  runner is slow, and a too-tight timeout is exactly how a real gate becomes
 *  a flaky gate that people start re-running until it passes. */
const BOOT_TIMEOUT_MS = Number(process.env.SMOKE_BOOT_TIMEOUT_MS ?? 20_000);

// ─── What counts as a failure ────────────────────────────────────────────────
//
// Rule: ANY uncaught exception fails. Console lines fail only when they name a
// React-class failure. That split is on purpose — a benign console line (a
// mocked 404, a devtools notice) must never be able to block a deploy, but the
// error classes below are never benign in a production bundle.
const REACT_ERROR_PATTERNS: RegExp[] = [
  /Minified React error/i,
  /Invalid hook call/i,
  /Rendered (more|fewer) hooks than/i,
  /Hydration failed/i,
  /hydrat\w* mismatch/i,
  /is not a function/,
  /Element type is invalid/i,
  /type is invalid -- expected a string/i,
  /Objects are not valid as a React child/i,
  /Maximum update depth exceeded/i,
  /Cannot read propert(y|ies) of (undefined|null)/i,
  /undefined is not an object/i,
  /Cannot access '[^']+' before initialization/i,
  /React\.createElement: type is invalid/i,
];

function classify(text: string): string | null {
  for (const pattern of REACT_ERROR_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}

// ─── Mocked backend ──────────────────────────────────────────────────────────
//
// Only what BOOT touches. Read off `App.tsx`'s bootstrap effect + `refetch()`:
// the silent `POST /api/auth/cf-login` exchange, then seven parallel GETs.
// Lists come back EMPTY on purpose — an empty state still executes the whole
// render path, and mocking rows would couple this gate to `Bundle`'s shape and
// give it a second reason to go red.

type Role = 'employee' | 'approver';

const userFor = (role: Role) => ({
  id: role === 'approver' ? 'user_kpol' : 'user_niran',
  name: role === 'approver' ? 'กพล (สโมค)' : 'นิรันดร์ (สโมค)',
  role,
  initials: role === 'approver' ? 'กพ' : 'นร',
  badge: null,
  email: null,
});

const EMPTY_SLICE = { count: 0, total: 0 };
const STATS = {
  pending: EMPTY_SLICE,
  approved: EMPTY_SLICE,
  paying: EMPTY_SLICE,
  paid: EMPTY_SLICE,
  rejected: EMPTY_SLICE,
  drafts: 0,
};

/** pathname → JSON body. Exact pathnames; the query string is ignored. */
function mockRoutes(role: Role): Record<string, unknown> {
  return {
    '/api/auth/cf-login': { token: 'smoke-token', user: userFor(role) },
    '/api/me': userFor(role),
    '/api/receipts': [],
    '/api/receipts/categories': { categories: ['อาหาร', 'เดินทาง', 'อุปกรณ์'] },
    '/api/bundles': [],
    '/api/bundles/stats': STATS,
    '/api/inbox': [],
    '/api/vendors': { vendors: [] },
  };
}

// ─── Scenarios ───────────────────────────────────────────────────────────────

interface Scenario {
  name: string;
  viewport: 'mobile' | 'desktop';
  /** null = no backend at all (every /api call 503s), the true cold-prod case. */
  role: Role | null;
  path: string;
  /** The `data-render-path` marker that MUST be in the DOM once boot settles. */
  expect: string;
}

const SCENARIOS: Scenario[] = [
  // The two paths CLAUDE.md warns about, as an approver (the role with the
  // most screens and the only one that reaches DesktopApprover).
  { name: 'mobile · approver · /',            viewport: 'mobile',  role: 'approver', path: '/',            expect: 'mobile' },
  { name: 'desktop · approver · /',           viewport: 'desktop', role: 'approver', path: '/',            expect: 'desktop-approver' },
  // …and the OTHER desktop component, wired independently of the one above.
  { name: 'desktop · approver · /my-requests', viewport: 'desktop', role: 'approver', path: '/my-requests', expect: 'desktop-employee' },
  // The majority role: an employee never sees DesktopApprover at all.
  { name: 'mobile · employee · /',            viewport: 'mobile',  role: 'employee', path: '/',            expect: 'mobile' },
  { name: 'desktop · employee · /',           viewport: 'desktop', role: 'employee', path: '/',            expect: 'desktop-employee' },
  // Cold prod with the api down — the first screen a real outage shows.
  { name: 'mobile · no backend · /',          viewport: 'mobile',  role: null,       path: '/',            expect: 'mobile-login' },
  { name: 'desktop · no backend · /',         viewport: 'desktop', role: null,       path: '/',            expect: 'desktop-login' },
];

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;

// ─── Build ───────────────────────────────────────────────────────────────────

async function build(): Promise<void> {
  console.log('[smoke] building apps/web (tsc -b && vite build)…');
  const proc = Bun.spawn(['bun', 'run', 'build'], {
    cwd: WEB_ROOT,
    stdout: 'inherit',
    stderr: 'inherit',
  });
  const code = await proc.exited;
  if (code !== 0) throw new Error(`web build failed (exit ${code})`);
}

// ─── Static server (SPA fallback) ────────────────────────────────────────────

function serveDist() {
  const indexHtml = Bun.file(join(DIST, 'index.html'));
  return Bun.serve({
    port: 0,
    hostname: '127.0.0.1',
    async fetch(request) {
      const { pathname } = new URL(request.url);
      // normalize() collapses any `..` before the join, so a stray request
      // cannot walk out of dist/.
      const candidate = join(DIST, normalize(pathname));
      if (candidate.startsWith(DIST) && pathname !== '/') {
        const file = Bun.file(candidate);
        if (await file.exists()) return new Response(file);
      }
      // Every in-app URL (/my-requests, /overview, …) is served the SPA, the
      // same way nginx.conf's try_files does in the real image.
      return new Response(indexHtml, {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    },
  });
}

// ─── One scenario ────────────────────────────────────────────────────────────

interface Failure {
  scenario: string;
  reason: string;
}

async function runScenario(
  browser: Browser,
  origin: string,
  scenario: Scenario,
): Promise<Failure[]> {
  const failures: Failure[] = [];
  const fail = (reason: string) => failures.push({ scenario: scenario.name, reason });

  const context = await browser.newContext({
    viewport: VIEWPORTS[scenario.viewport],
    // Pin everything a render could branch on, so two runs of this gate on two
    // machines see the same app.
    locale: 'th-TH',
    timezoneId: 'Asia/Bangkok',
    colorScheme: 'light',
    reducedMotion: 'reduce',
  });
  const page: Page = await context.newPage();

  const routes = scenario.role === null ? null : mockRoutes(scenario.role);

  // ONE handler for every request, so there is no last-registered-wins
  // ambiguity between overlapping patterns — and, critically, so the gate is
  // hermetic: nothing in this test may touch the network. index.html links
  // Google Fonts and HfBar names erp.thehfhotel.org; both are aborted, and a
  // DNS blip can never turn this job red.
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    const sameOrigin = `${url.protocol}//${url.host}` === origin;

    if (url.pathname.startsWith('/api/')) {
      if (routes === null) {
        // 503 (not an abort) exercises App.tsx's mapped cf-login error branch
        // rather than a generic network failure.
        return route.fulfill({
          status: 503,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'smoke: backend intentionally down' }),
        });
      }
      const body = routes[url.pathname];
      if (body === undefined) {
        // A new boot fetch landed without a mock. Real red, with the fix in
        // the message — never a mystery timeout.
        fail(
          `unmocked boot request ${route.request().method()} ${url.pathname} — ` +
            `add it to mockRoutes() in test/web-boot-smoke.ts`,
        );
        return route.fulfill({ status: 501, contentType: 'application/json', body: '{}' });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(body),
      });
    }

    if (sameOrigin) return route.continue();
    return route.abort();
  });

  // An uncaught exception is a verdict, not a hint: resolve this the moment one
  // lands so the boot wait below aborts immediately instead of sitting out its
  // full timeout. A red run that takes 20s per scenario is a red run people
  // start ignoring.
  let onFatal: (reason: string) => void = () => {};
  const fatal = new Promise<string>((resolvePromise) => {
    onFatal = resolvePromise;
  });

  page.on('pageerror', (error) => {
    const reason = `pageerror: ${error.message.split('\n')[0]}`;
    fail(reason);
    onFatal(reason);
  });
  page.on('console', (message: ConsoleMessage) => {
    const text = message.text();
    const matched = classify(text);
    if (matched !== null) {
      const reason = `console.${message.type()} matched /${matched}/: ${text.slice(0, 300)}`;
      fail(reason);
      onFatal(reason);
    } else if (message.type() === 'error') {
      // Reported, never fatal — see REACT_ERROR_PATTERNS' note.
      console.log(`  · benign console.error: ${text.slice(0, 160)}`);
    }
  });

  try {
    await page.goto(`${origin}${scenario.path}`, {
      waitUntil: 'load',
      timeout: BOOT_TIMEOUT_MS,
    });

    // `data-render-path` appears ONLY once the bootstrap effect settles — the
    // loading spinner and the CenteredError screen both lack it. So this single
    // wait doubles as "boot finished" and "boot did not land on the error
    // screen", with no arbitrary sleep anywhere in this file.
    const booted = await Promise.race([
      page
        .waitForSelector(`#app [data-render-path="${scenario.expect}"]`, {
          state: 'attached',
          timeout: BOOT_TIMEOUT_MS,
        })
        .then(() => 'booted' as const),
      fatal.then(() => 'fatal' as const),
    ]);
    // The failure is already recorded by the listener that resolved `fatal`;
    // asserting on a half-mounted tree on top of it would only add noise.
    if (booted === 'fatal') throw new Error('aborted: fatal error during boot');

    const mounted = await page.evaluate(() => {
      const root = document.getElementById('app');
      if (root === null) return { found: false, children: 0, descendants: 0, path: null as string | null, text: 0 };
      const marker = root.querySelector('[data-render-path]');
      return {
        found: true,
        children: root.children.length,
        descendants: root.querySelectorAll('*').length,
        path: marker === null ? null : marker.getAttribute('data-render-path'),
        text: (root.textContent ?? '').trim().length,
      };
    });

    if (!mounted.found) fail('no #app mount node in the document');
    if (mounted.children === 0) fail('#app mounted no element children — React rendered nothing');
    // A mounted-but-hollow tree is the shape a swallowed render error takes.
    if (mounted.descendants < 10) {
      fail(`#app subtree is only ${mounted.descendants} elements — suspiciously empty`);
    }
    if (mounted.text === 0) fail('#app rendered no text at all');
    if (mounted.path !== scenario.expect) {
      fail(`render path was '${mounted.path}', expected '${scenario.expect}'`);
    }

    console.log(
      `  ${failures.length === 0 ? 'PASS' : 'FAIL'} ${scenario.name} ` +
        `→ ${mounted.path} (${mounted.descendants} elements, ${mounted.text} chars)`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.split('\n')[0] : String(error);
    // Don't double-report: the listener already filed the real reason.
    if (!message.startsWith('aborted: fatal error')) fail(message);
    console.log(`  FAIL ${scenario.name}`);
  }

  if (failures.length > 0) {
    try {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      const slug = scenario.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
      const shot = join(ARTIFACT_DIR, `${slug}.png`);
      await page.screenshot({ path: shot, fullPage: false });
      await writeFile(
        join(ARTIFACT_DIR, `${slug}.html`),
        await page.content(),
        'utf-8',
      );
      console.log(`       artifacts: ${shot}`);
    } catch {
      // A screenshot of a broken page is a nice-to-have, never the verdict.
    }
  }

  await context.close();
  return failures;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  if (!ARGS.has('--no-build')) await build();

  if (!(await Bun.file(join(DIST, 'index.html')).exists())) {
    console.error(`[smoke] no bundle at ${DIST}/index.html`);
    return 1;
  }

  const server = serveDist();
  const origin = `http://127.0.0.1:${server.port}`;
  console.log(`[smoke] serving ${DIST} at ${origin}`);

  let browser: Browser;
  try {
    browser = await chromium.launch();
  } catch (error) {
    console.error(
      '[smoke] could not launch chromium — run `bunx playwright install chromium`.\n' +
        `        ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`,
    );
    await server.stop(true);
    return 1;
  }

  const failures: Failure[] = [];
  try {
    for (const scenario of SCENARIOS) {
      failures.push(...(await runScenario(browser, origin, scenario)));
    }
  } finally {
    await browser.close();
    await server.stop(true);
  }

  console.log('');
  if (failures.length === 0) {
    console.log(`[smoke] ${SCENARIOS.length}/${SCENARIOS.length} scenarios passed — no React-class errors, both render paths mounted.`);
    return 0;
  }

  console.error(`[smoke] ${failures.length} failure(s):`);
  for (const failure of failures) {
    console.error(`  ✗ [${failure.scenario}] ${failure.reason}`);
  }
  console.error(`[smoke] artifacts in ${ARTIFACT_DIR}`);
  return 1;
}

process.exitCode = await main();
