import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.goto("https://kbiz.kasikornbank.com/authen/login.jsp?lang=en", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(2000);

const candidates = await page.evaluate(() => {
  const els = document.querySelectorAll("a, div, span, button, input");
  return Array.from(els)
    .filter((e) => {
      const t = (e.textContent || "").trim().toLowerCase();
      return /^(log\s*in|login|sign\s*in)$/.test(t) || (e.id && /login|submit|signin/i.test(e.id));
    })
    .map((e) => ({
      tag: e.tagName,
      id: e.id,
      classes: e.className,
      text: (e.textContent || "").trim().slice(0, 80),
      onclick: e.getAttribute("onclick") ? "[has onclick]" : null,
    }));
});
for (const c of candidates) console.log(JSON.stringify(c));

console.log("\n--- form elements ---");
const forms = await page.evaluate(() =>
  Array.from(document.querySelectorAll("form")).map((f) => ({
    id: f.id,
    name: f.name,
    action: f.action,
    method: f.method,
  }))
);
for (const f of forms) console.log(JSON.stringify(f));

await browser.close();
