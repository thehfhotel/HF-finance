import { Elysia, t } from "elysia";
import { readFile } from "node:fs/promises";
import { randomBytes, randomInt } from "node:crypto";
import { buildWorkbook, buildBeneficiaryWorkbook } from "./excel";
import { MAIN_HTML } from "./views/main";
import { ACCOUNTS_HTML } from "./views/accounts";
import { APPROVALS_HTML } from "./views/approvals";
import { WORKSHEET_HTML } from "./views/worksheet";
import { STATUS_HTML } from "./views/status";
import { ADMIN_MODAL_HTML, adminNavHtml } from "./views/admin";
import { addAccount, deleteAccount, listAccounts, updateAccount } from "./store";
import { loadRegistered, registeredSet } from "./registered";
import { getRequest, listRequests, submitRequest, updateRequest } from "./queue";
import { notifySlack } from "./slack";
import { isValidPeriod, loadSheet, saveSheet } from "./sheets";

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

// Admin session unlock — gates the สร้างไฟล์ (/) and คิวอนุมัติ (/approvals)
// pages plus their state-changing endpoints. Two-step Slack OTP:
//   POST /api/admin/request-otp  → returns { token }, sends OTP to Slack
//   POST /api/admin/unlock       → { token, otp } → sets admin_session cookie
// Sessions and pending OTPs are in-memory; restart logs everyone out.
const ADMIN_SESSION_TTL_MS = 4 * 60 * 60_000; // 4h
const adminSessions = new Map<string, number>(); // sessionId → expiresAt
const adminOtpChallenges = new Map<string, { otp: string; expiresAt: number; attempts: number }>(); // pre-unlock token → challenge

function parseCookies(header: string | undefined | null): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

function isAdminUnlocked(headers: Record<string, string | undefined>): boolean {
  const sid = parseCookies(headers.cookie)["admin_session"];
  if (!sid) return false;
  const expiresAt = adminSessions.get(sid);
  if (!expiresAt) return false;
  if (Date.now() > expiresAt) {
    adminSessions.delete(sid);
    return false;
  }
  return true;
}

function renderHTML(template: string, currentPath: string, isAdmin: boolean): Response {
  const body = template
    .replace("<!--ADMIN_NAV-->", adminNavHtml(currentPath, isAdmin))
    .replace("<!--ADMIN_MODAL-->", ADMIN_MODAL_HTML);
  return new Response(body, { headers: { "content-type": "text/html; charset=utf-8" } });
}

function adminGuard(headers: Record<string, string | undefined>, set: { status?: number }): true | Response {
  if (isAdminUnlocked(headers)) return true;
  set.status = 401;
  return new Response("ต้องเข้าโหมด admin ก่อน", { status: 401 });
}


const app = new Elysia()
  .get("/", ({ headers, redirect }) =>
    isAdminUnlocked(headers) ? renderHTML(MAIN_HTML, "/", true) : redirect("/worksheet", 302)
  )
  .get("/worksheet", ({ headers }) => renderHTML(WORKSHEET_HTML, "/worksheet", isAdminUnlocked(headers)))
  .get("/accounts", ({ headers }) => renderHTML(ACCOUNTS_HTML, "/accounts", isAdminUnlocked(headers)))
  .get("/approvals", ({ headers, redirect }) =>
    isAdminUnlocked(headers) ? renderHTML(APPROVALS_HTML, "/approvals", true) : redirect("/worksheet", 302)
  )
  .get("/status", ({ headers }) => renderHTML(STATUS_HTML, "/status", isAdminUnlocked(headers)))
  .get("/health", () => "ok")

  // Sanitised status feed for the /status page — no per-row PII, no xlsx
  // path, no embedded sheet snapshot. Just enough for HR to track their
  // own submissions through to the KBIZ result. Open to non-admins on
  // purpose: counterpart to the open POST /api/queue/transfer.
  .get("/api/queue/status", async () => {
    const all = await listRequests();
    return all.map((r) => ({
      id: r.id,
      type: r.type,
      status: r.status,
      period: r.summary.type === "transfer-payroll" ? r.summary.period : undefined,
      effectiveDate: r.summary.type === "transfer-payroll" ? r.summary.effectiveDate : undefined,
      totalAmount: r.summary.type === "transfer-payroll" ? r.summary.totalAmount : undefined,
      recipientCount:
        r.summary.type === "transfer-payroll" ? r.summary.rows.length :
        r.summary.type === "add-payroll" ? r.summary.accounts.length : 0,
      createdAt: r.createdAt,
      approvedAt: r.approvedAt,
      rejectedAt: r.rejectedAt,
      rejectionReason: r.rejectionReason,
      startedAt: r.startedAt,
      completedAt: r.completedAt,
      result: r.result,
    }));
  })

  // Admin OTP unlock flow. Pre-unlock token is single-use; on success a
  // 4-hour session cookie is set. Lock endpoint clears both server-side
  // session and the cookie.
  .post("/api/admin/request-otp", async () => {
    const token = randomBytes(16).toString("hex");
    const otp = newOtp();
    adminOtpChallenges.set(token, { otp, expiresAt: Date.now() + OTP_TTL_MS, attempts: 0 });
    await notifySlack(`:closed_lock_with_key: *Admin unlock OTP*\nOTP: \`${otp}\`  (5 นาที)`);
    return { token };
  })
  .post(
    "/api/admin/unlock",
    ({ body, set }) => {
      const ch = adminOtpChallenges.get(body.token);
      if (!ch) { set.status = 400; return "ยังไม่ได้ขอ OTP — กดส่ง OTP อีกครั้ง"; }
      if (Date.now() > ch.expiresAt) {
        adminOtpChallenges.delete(body.token);
        set.status = 400;
        return "OTP หมดอายุแล้ว กรุณาขอ OTP ใหม่";
      }
      ch.attempts++;
      if (ch.attempts > OTP_MAX_ATTEMPTS) {
        adminOtpChallenges.delete(body.token);
        set.status = 429;
        return "ลอง OTP เกินจำนวนที่อนุญาต กรุณาขอ OTP ใหม่";
      }
      if (ch.otp !== body.otp.trim()) {
        set.status = 400;
        return `OTP ไม่ถูกต้อง (ลอง ${ch.attempts}/${OTP_MAX_ATTEMPTS})`;
      }
      adminOtpChallenges.delete(body.token);
      const sid = randomBytes(24).toString("hex");
      const expiresAt = Date.now() + ADMIN_SESSION_TTL_MS;
      adminSessions.set(sid, expiresAt);
      set.headers["set-cookie"] = `admin_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${ADMIN_SESSION_TTL_MS / 1000}`;
      return { unlocked: true, expiresAt };
    },
    { body: t.Object({ token: t.String({ minLength: 1, maxLength: 64 }), otp: t.String({ pattern: "^\\d{6}$" }) }) }
  )
  .post("/api/admin/lock", ({ headers, set }) => {
    const sid = parseCookies(headers.cookie)["admin_session"];
    if (sid) adminSessions.delete(sid);
    set.headers["set-cookie"] = `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
    return { unlocked: false };
  })

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

  .get("/api/sheets/:period", async ({ params, set }) => {
    if (!isValidPeriod(params.period)) { set.status = 400; return "invalid period (expected YYYY-MM)"; }
    return loadSheet(params.period);
  })
  .put(
    "/api/sheets/:period",
    async ({ params, body, set }) => {
      if (!isValidPeriod(params.period)) { set.status = 400; return "invalid period (expected YYYY-MM)"; }
      return saveSheet(params.period, body);
    },
    {
      body: t.Object({
        effectiveDate: t.String({ maxLength: 10 }),
        generalNotes: t.String({ maxLength: 5000 }),
        dismissed: t.Optional(t.Array(t.String({ minLength: 1, maxLength: 40 }), { maxItems: 500 })),
        rows: t.Array(
          t.Object({
            accountId: t.String({ minLength: 1, maxLength: 40 }),
            accountNumber: t.String({ maxLength: 30 }),
            accountName: t.String({ maxLength: 100 }),
            bank: t.String({ maxLength: 20 }),
            nickname: t.String({ maxLength: 50 }),
            position: t.String({ maxLength: 50 }),
            salary: t.Number({ minimum: 0 }),
            socialSecurity: t.Number({ minimum: 0 }),
            savings: t.Number({ minimum: 0 }),
            advance: t.Number({ minimum: 0 }),
            loan: t.Number({ minimum: 0 }),
            interest: t.Number({ minimum: 0 }),
            roomCost: t.Number({ minimum: 0 }),
            leave: t.Number({ minimum: 0 }),
            otherDeduction: t.Number({ minimum: 0 }),
            commission: t.Number({ minimum: 0 }),
            breakfast: t.Number({ minimum: 0 }),
            ot: t.Number({ minimum: 0 }),
            otherAddition: t.Number({ minimum: 0 }),
            note: t.String({ maxLength: 500 }),
          }),
          { maxItems: 200 }
        ),
      }),
    }
  )

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
    // Open to non-admins: HR submits transfer requests; admins approve them
    // separately via /approvals (still OTP-gated). The submission contains
    // sensitive row/amount data, but only HR can land here in the first
    // place — there's no anonymous internet access (Cloudflare tunnel only).
    "/api/queue/transfer",
    async ({ body }) => {
      const buf = await buildWorkbook(body);
      const totalAmount = body.rows.reduce((s, r) => s + r.amount, 0);
      // Snapshot the full worksheet (deductions/additions/notes) into the
      // queue item. The worksheet has just been autosaved by the client
      // before submit — loadSheet() returns the current on-disk state.
      // Falls back to undefined for malformed periods so older clients that
      // don't send period still work.
      const sheet = body.period && isValidPeriod(body.period)
        ? await loadSheet(body.period)
        : undefined;
      const req = await submitRequest({
        type: "transfer-payroll",
        summary: {
          type: "transfer-payroll",
          effectiveDate: body.effectiveDate,
          totalAmount: Math.round(totalAmount * 100) / 100,
          rows: body.rows,
          period: body.period,
          sheet,
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
        period: t.Optional(t.String({ pattern: "^\\d{4}-(0[1-9]|1[0-2])$" })),
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

  .get("/api/queue", ({ headers, set }) => {
    const guard = adminGuard(headers, set);
    if (guard !== true) return guard;
    return listRequests();
  })
  .get("/api/queue/:id", async ({ params, headers, set }) => {
    const guard = adminGuard(headers, set);
    if (guard !== true) return guard;
    const req = await getRequest(params.id);
    if (!req) { set.status = 404; return "not found"; }
    return req;
  })
  .get("/api/queue/:id/xlsx", async ({ params, headers, set }) => {
    const guard = adminGuard(headers, set);
    if (guard !== true) return guard;
    const req = await getRequest(params.id);
    if (!req) { set.status = 404; return "not found"; }
    const buf = await readFile(req.xlsxPath);
    set.headers["content-type"] = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    set.headers["content-disposition"] = `attachment; filename="${params.id}.xlsx"`;
    return buf;
  })
  .post(
    "/api/queue/:id/request-otp",
    async ({ params, headers, set }) => {
      const guard = adminGuard(headers, set);
      if (guard !== true) return guard;
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
    async ({ params, body, headers, set }) => {
      const guard = adminGuard(headers, set);
      if (guard !== true) return guard;
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
    async ({ params, body, headers, set }) => {
      const guard = adminGuard(headers, set);
      if (guard !== true) return guard;
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
    async ({ body, headers, set }) => {
      const guard = adminGuard(headers, set);
      if (guard !== true) return guard;
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
