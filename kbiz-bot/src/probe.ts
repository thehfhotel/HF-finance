import { chromium } from "playwright";

const LOGIN_URL = "https://kbiz.kasikornbank.com/authen/login.jsp?lang=en";

async function main() {
  const browser = await chromium.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000); // let any post-load JS settle

  const inputs = await page.locator("input").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      type: (e as HTMLInputElement).type,
      id: e.id,
      name: (e as HTMLInputElement).name,
      placeholder: (e as HTMLInputElement).placeholder,
      ariaLabel: e.getAttribute("aria-label"),
      visible: (e as HTMLElement).offsetParent !== null,
    }))
  );
  console.log("\n--- INPUTS ---");
  for (const i of inputs) console.log(JSON.stringify(i));

  const buttons = await page.locator("button, input[type=submit], a[role=button]").evaluateAll((els) =>
    els.map((e) => ({
      tag: e.tagName,
      type: (e as HTMLInputElement).type || null,
      id: e.id,
      classes: e.className,
      text: (e.textContent || "").trim().slice(0, 50),
      ariaLabel: e.getAttribute("aria-label"),
      visible: (e as HTMLElement).offsetParent !== null,
    }))
  );
  console.log("\n--- BUTTONS / SUBMITS ---");
  for (const b of buttons) console.log(JSON.stringify(b));

  await page.screenshot({ path: "probe-login.png", fullPage: true });
  console.log("\n→ Saved probe-login.png");

  await page.waitForTimeout(2000);
  await browser.close();
}

main().catch((e) => {
  console.error("Probe failed:", (e as Error).message);
  process.exit(1);
});
