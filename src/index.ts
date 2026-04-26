import { Elysia, t } from "elysia";
import { readFile } from "node:fs/promises";
import { buildWorkbook, buildBeneficiaryWorkbook } from "./excel";
import { MAIN_HTML } from "./views/main";
import { ACCOUNTS_HTML } from "./views/accounts";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "./store";
import { loadRegistered, registeredSet } from "./registered";

const html = (body: string) =>
  new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });

const staticFile = async (path: string, mime: string) => {
  const buf = await readFile(path);
  return new Response(buf, { headers: { "content-type": mime, "cache-control": "public, max-age=86400" } });
};

const accountBody = t.Object({
  accountNumber: t.String({ pattern: "^[0-9\\-\\s]{6,30}$" }),
  accountName: t.String({ minLength: 1, maxLength: 100 }),
});

const app = new Elysia()
  .get("/", () => html(MAIN_HTML))
  .get("/accounts", () => html(ACCOUNTS_HTML))
  .get("/health", () => "ok")

  .get("/static/flatpickr.css", () => staticFile("node_modules/flatpickr/dist/flatpickr.min.css", "text/css; charset=utf-8"))
  .get("/static/flatpickr.js", () => staticFile("node_modules/flatpickr/dist/flatpickr.min.js", "application/javascript; charset=utf-8"))
  .get("/static/flatpickr-th.js", () => staticFile("node_modules/flatpickr/dist/l10n/th.js", "application/javascript; charset=utf-8"))
  .get("/static/html2canvas.js", () => staticFile("node_modules/html2canvas/dist/html2canvas.min.js", "application/javascript; charset=utf-8"))

  .get("/api/accounts", async () => {
    const accounts = await listAccounts();
    const reg = await registeredSet();
    return accounts.map((a) => ({ ...a, registered: reg.has(a.accountNumber) }));
  })
  .get("/api/registered", async () => (await loadRegistered()) ?? { fetchedAt: null, count: 0, accounts: [] })
  .post("/api/accounts", ({ body }) => addAccount(body), { body: accountBody })
  .put("/api/accounts/:id", ({ params, body }) => updateAccount(params.id, body), { body: accountBody })
  .delete("/api/accounts/:id", async ({ params, set }) => {
    await deleteAccount(params.id);
    set.status = 204;
    return "";
  })

  .post(
    "/generate-beneficiary",
    async ({ body, set }) => {
      // KBIZ rejects uploads containing already-registered accounts.
      // Filter them out here using the latest scrape from kbiz-bot.
      const reg = await registeredSet();
      const filtered = body.accounts.filter((a) => !reg.has(a.accountNumber));
      const skipped = body.accounts.length - filtered.length;
      if (filtered.length === 0) {
        set.status = 400;
        return `บัญชีที่เลือกทั้งหมด (${skipped}) ลงทะเบียนกับ KBIZ แล้ว`;
      }
      const buf = await buildBeneficiaryWorkbook(filtered);
      const stamp = new Date().toISOString().slice(0, 10);
      set.headers["content-type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] = `attachment; filename="KBIZAddBeneficiary-${stamp}.xlsx"`;
      if (skipped > 0) set.headers["x-skipped-registered"] = String(skipped);
      return buf;
    },
    {
      body: t.Object({
        accounts: t.Array(
          t.Object({
            accountNumber: t.String({ minLength: 1, maxLength: 20 }),
            accountName: t.String({ minLength: 1, maxLength: 100 }),
          }),
          { minItems: 1, maxItems: 100 }
        ),
      }),
    }
  )

  .post(
    "/generate",
    async ({ body, set }) => {
      const buf = await buildWorkbook(body);
      const stamp = body.effectiveDate.replaceAll("/", "-");
      set.headers["content-type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
      set.headers["content-disposition"] = `attachment; filename="KBIZPayroll-${stamp}.xlsx"`;
      return buf;
    },
    {
      body: t.Object({
        effectiveDate: t.String({ pattern: "^\\d{2}/\\d{2}/\\d{4}$" }),
        rows: t.Array(
          t.Object({
            accountNumber: t.String({ minLength: 1, maxLength: 20 }),
            accountName: t.String({ minLength: 1, maxLength: 100 }),
            amount: t.Number({ exclusiveMinimum: 0 }),
          }),
          { minItems: 1, maxItems: 100 }
        ),
      }),
    }
  )
  .listen({ hostname: "0.0.0.0", port: Number(process.env.PORT ?? 3000) });

console.log(`payroll-form listening on http://${app.server?.hostname}:${app.server?.port}`);
