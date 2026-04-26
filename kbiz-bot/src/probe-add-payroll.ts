import { chromium } from "playwright";

const TARGET = "https://kbiz.kasikornbank.com/menu/setting/account-list/account-payroll";

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ storageState: "storageState.json" });
const page = await context.newPage();

page.on("framenavigated", (frame) => {
  if (frame === page.mainFrame()) console.log(`   ↳ ${frame.url()}`);
});

console.log("→ Opening", TARGET);
await page.goto(TARGET, { waitUntil: "domcontentloaded" });
await page.waitForLoadState("networkidle", { timeout: 30_000 }).catch(() => {});
console.log("   final:", page.url());
await page.waitForTimeout(2000);

console.log("\n--- INPUT[file] (top frame) ---");
const fileInputsTop = await page.locator('input[type="file"]').evaluateAll((els) =>
  els.map((e) => ({
    id: e.id,
    name: (e as HTMLInputElement).name,
    accept: (e as HTMLInputElement).accept,
    classes: e.className,
    visible: (e as HTMLElement).offsetParent !== null,
  }))
);
for (const i of fileInputsTop) console.log(JSON.stringify(i));

console.log("\n--- iframes ---");
for (const f of page.frames()) {
  if (f === page.mainFrame()) continue;
  console.log("  frame:", f.url());
  try {
    const inFrame = await f.locator('input[type="file"]').evaluateAll((els) =>
      els.map((e) => ({
        id: e.id,
        name: (e as HTMLInputElement).name,
        accept: (e as HTMLInputElement).accept,
      }))
    );
    for (const i of inFrame) console.log("    file input:", JSON.stringify(i));
  } catch {}
}

console.log("\n--- buttons mentioning upload/save/submit ---");
const btns = await page.evaluate(() => {
  const all = document.querySelectorAll("a, button, div, span, input");
  return Array.from(all)
    .filter((e) => {
      const t = (e.textContent || "").trim();
      return /upload|save|submit|browse|next|confirm|ดาวน์โหลด|อัปโหลด|บันทึก|ยืนยัน|ถัดไป|เลือก/i.test(t) && t.length < 80;
    })
    .slice(0, 30)
    .map((e) => ({ tag: e.tagName, id: e.id, text: (e.textContent || "").trim().slice(0, 60) }));
});
for (const b of btns) console.log(JSON.stringify(b));

await page.screenshot({ path: "probe-add-payroll.png", fullPage: true });
console.log("\n→ screenshot: probe-add-payroll.png");

await page.waitForTimeout(3000);
await browser.close();
