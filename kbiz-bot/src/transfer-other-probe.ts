import { withSession, gotoAuthenticated } from "./lib/session";

/**
 * Selector probe for the "transfer to another person's account" page
 * (fundtranfer-other). Opens the page in your warm KBIZ session and dumps every
 * input, select (with its options), label, and button — so the real selectors
 * can be pinned instead of guessed.
 *
 * Read-only: it fills nothing and clicks nothing. Run it once, paste the output
 * back, and the flow's selectors get locked to this page's actual DOM.
 *
 *   npm run transfer-other-probe
 */

const URL = "https://kbiz.kasikornbank.com/menu/fundtranfer/fundtranfer/fundtranfer-other";

await withSession(async (_ctx, page) => {
  await gotoAuthenticated(page, URL);
  await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  console.log(`\n=== ${page.url()} ===\n`);

  const inputs = await page.locator("input, textarea").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      type: (e as HTMLInputElement).type ?? null,
      id: e.id || null,
      name: (e as HTMLInputElement).name || null,
      placeholder: (e as HTMLInputElement).placeholder || null,
      ariaLabel: e.getAttribute("aria-label"),
      maxLength: (e as HTMLInputElement).maxLength ?? null,
      visible: (e as HTMLElement).offsetParent !== null,
    })),
  );
  console.log("--- INPUTS / TEXTAREAS ---");
  for (const i of inputs) console.log(JSON.stringify(i));

  const selects = await page.locator("select").evaluateAll((els) =>
    els.map((e) => ({
      id: e.id || null,
      name: (e as HTMLSelectElement).name || null,
      ariaLabel: e.getAttribute("aria-label"),
      visible: (e as HTMLElement).offsetParent !== null,
      options: Array.from((e as HTMLSelectElement).options)
        .map((o) => o.textContent?.trim())
        .slice(0, 30),
    })),
  );
  console.log("\n--- NATIVE SELECTS ---");
  for (const s of selects) console.log(JSON.stringify(s));

  // Angular custom dropdowns often aren't <select>. Surface likely candidates.
  const combos = await page
    .locator('[role="combobox"], .ng-select, [class*="dropdown"], [class*="select"]')
    .evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => ({
          tag: e.tagName,
          id: e.id || null,
          classes: (e.className || "").toString().slice(0, 80),
          text: (e.textContent || "").trim().slice(0, 60),
        }))
        .slice(0, 40),
    );
  console.log("\n--- CUSTOM DROPDOWN CANDIDATES ---");
  for (const c of combos) console.log(JSON.stringify(c));

  const labels = await page.locator("label").evaluateAll((els) =>
    els
      .filter((e) => (e as HTMLElement).offsetParent !== null)
      .map((e) => ({
        for: e.getAttribute("for"),
        text: (e.textContent || "").trim().slice(0, 60),
      })),
  );
  console.log("\n--- LABELS ---");
  for (const l of labels) console.log(JSON.stringify(l));

  const buttons = await page
    .locator('button, a[role="button"], input[type="submit"], [role="button"]')
    .evaluateAll((els) =>
      els
        .filter((e) => (e as HTMLElement).offsetParent !== null)
        .map((e) => ({
          tag: e.tagName,
          id: e.id || null,
          classes: (e.className || "").toString().slice(0, 60),
          text: (e.textContent || "").trim().slice(0, 50),
        })),
    );
  console.log("\n--- BUTTONS ---");
  for (const b of buttons) console.log(JSON.stringify(b));

  await page.screenshot({ path: "probe-transfer-other.png", fullPage: true });
  console.log("\n→ Saved probe-transfer-other.png");
  await page.waitForTimeout(1_500);
});
