import { Elysia, t } from "elysia";
import { readFile } from "node:fs/promises";
import { randomInt } from "node:crypto";
import { buildWorkbook, buildBeneficiaryWorkbook } from "./excel";
import { MAIN_HTML } from "./views/main";
import { ACCOUNTS_HTML } from "./views/accounts";
import { APPROVALS_HTML } from "./views/approvals";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "./store";
import { loadRegistered, registeredSet } from "./registered";
import { getRequest, listRequests, submitRequest, updateRequest } from "./queue";
import { notifySlack } from "./slack";

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

// In-memory OTP challenges keyed by request id. Lost on restart (rare and
// safe — approver just requests a new OTP). Each entry: 6-digit code, TTL,
// attempt counter.
const OTP_TTL_MS = 5 * 60_000;
const OTP_MAX_ATTEMPTS = 5;
const otpChallenges = new Map<string, { otp: string; expiresAt: number; attempts: number }>();
const newOtp = () => String(randomInt(100000, 1_000_000));

const app = new Elysia()
  .get("/", () => html(MAIN_HTML))
  .get("/accounts", () => html(ACCOUNTS_HTML))
  .get("/approvals", () => html(APPROVALS_HTML))
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
    "/api/queue/transfer",
    async ({ body }) => {
      const buf = await buildWorkbook(body);
      const totalAmount = body.rows.reduce((s, r) => s + r.amount, 0);
      const req = await submitRequest({
        type: "transfer-payroll",
        summary: {
          type: "transfer-payroll",
          effectiveDate: body.effectiveDate,
          totalAmount: Math.round(totalAmount * 100) / 100,
          rows: body.rows,
        },
        xlsxBuffer: buf,
      });
      const fmt = totalAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      await notifySlack(
        `:moneybag: *Payroll transfer awaiting approval*\n` +
          `• Effective: ${body.effectiveDate}\n` +
          `• ${body.rows.length} recipient(s), total ฿${fmt}\n` +
          `• Review: <http://localhost:3000/approvals|/approvals> (id: \`${req.id}\`)`
      );
      return req;
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

  .post(
    "/api/queue/add-payroll",
    async ({ body, set }) => {
      const reg = await registeredSet();
      const filtered = body.accounts.filter((a) => !reg.has(a.accountNumber));
      if (filtered.length === 0) {
        set.status = 400;
        return `บัญชีที่เลือกทั้งหมด (${body.accounts.length}) ลงทะเบียนกับ KBIZ แล้ว`;
      }
      const buf = await buildBeneficiaryWorkbook(filtered);
      const req = await submitRequest({
        type: "add-payroll",
        summary: { type: "add-payroll", accounts: filtered },
        xlsxBuffer: buf,
      });
      await notifySlack(
        `:bust_in_silhouette: *Add Payroll Account awaiting approval*\n` +
          `• ${filtered.length} new account(s)\n` +
          `• Review: <http://localhost:3000/approvals|/approvals> (id: \`${req.id}\`)`
      );
      return req;
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

  .get("/api/queue", () => listRequests())
  .get("/api/queue/:id", async ({ params, set }) => {
    const req = await getRequest(params.id);
    if (!req) { set.status = 404; return "not found"; }
    return req;
  })
  .get("/api/queue/:id/xlsx", async ({ params, set }) => {
    const req = await getRequest(params.id);
    if (!req) { set.status = 404; return "not found"; }
    const buf = await readFile(req.xlsxPath);
    set.headers["content-type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    set.headers["content-disposition"] = `attachment; filename="${params.id}.xlsx"`;
    return buf;
  })
  .post(
    "/api/queue/:id/request-otp",
    async ({ params, set }) => {
      const existing = await getRequest(params.id);
      if (!existing) { set.status = 404; return "not found"; }
      if (existing.status !== "pending") { set.status = 409; return `cannot OTP-challenge (status: ${existing.status})`; }
      const otp = newOtp();
      const expiresAt = Date.now() + OTP_TTL_MS;
      otpChallenges.set(params.id, { otp, expiresAt, attempts: 0 });
      await notifySlack(
        `:closed_lock_with_key: *OTP เพื่ออนุมัติ* \`${existing.id}\` (${existing.type})\n` +
          `OTP: \`${otp}\`  (5 นาที)`
      );
      return { sent: true };
    }
  )
  .post(
    "/api/queue/:id/approve",
    async ({ params, body, set }) => {
      const existing = await getRequest(params.id);
      if (!existing) { set.status = 404; return "not found"; }
      if (existing.status !== "pending") { set.status = 409; return `cannot approve (status: ${existing.status})`; }
      const ch = otpChallenges.get(params.id);
      if (!ch) { set.status = 400; return "ยังไม่ได้ขอ OTP — กดปุ่มอนุมัติใหม่อีกครั้ง"; }
      if (Date.now() > ch.expiresAt) {
        otpChallenges.delete(params.id);
        set.status = 400;
        return "OTP หมดอายุแล้ว กรุณาขอ OTP ใหม่";
      }
      ch.attempts++;
      if (ch.attempts > OTP_MAX_ATTEMPTS) {
        otpChallenges.delete(params.id);
        set.status = 429;
        return "ลอง OTP เกินจำนวนที่อนุญาต กรุณาขอ OTP ใหม่";
      }
      if (ch.otp !== body.otp.trim()) {
        set.status = 400;
        return `OTP ไม่ถูกต้อง (ลอง ${ch.attempts}/${OTP_MAX_ATTEMPTS})`;
      }
      otpChallenges.delete(params.id);
      const updated = await updateRequest(params.id, {
        status: "approved",
        approvedAt: new Date().toISOString(),
      });
      await notifySlack(`:white_check_mark: Approved \`${updated.id}\` (${updated.type}) — ready for KBIZ`);
      return updated;
    },
    { body: t.Object({ otp: t.String({ pattern: "^\\d{6}$" }) }) }
  )
  .post(
    "/api/queue/:id/reject",
    async ({ params, body, set }) => {
      const existing = await getRequest(params.id);
      if (!existing) { set.status = 404; return "not found"; }
      if (existing.status !== "pending") { set.status = 409; return `cannot reject (status: ${existing.status})`; }
      const updated = await updateRequest(params.id, {
        status: "rejected",
        rejectedAt: new Date().toISOString(),
        rejectionReason: body?.reason,
      });
      await notifySlack(`:x: Rejected \`${updated.id}\` (${updated.type})${body?.reason ? ` — ${body.reason}` : ""}`);
      return updated;
    },
    { body: t.Optional(t.Object({ reason: t.Optional(t.String({ maxLength: 500 })) })) }
  )

  // Legacy direct-download endpoints (PoC, kept as fallback)
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
