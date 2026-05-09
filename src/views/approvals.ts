import { ZOOM_HTML } from "./zoom";

export const APPROVALS_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>คิวอนุมัติ - KBIZ Payroll</title>
<style>
  :root { font: 16px/1.5 "Noto Sans Thai", system-ui, sans-serif; }
  body { max-width: 1500px; margin: 20px auto; padding: 0 20px; color: #1a1a1a; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0; flex: 1; }
  nav a { color: #1d4ed8; text-decoration: none; margin-left: 14px; font-size: 15px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid #d1d5db; padding: 16px 18px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 4px 12px; color: #111827; background: #fff; font-size: 16px; font-weight: 700; border-radius: 4px; }
  button { cursor: pointer; border: 1px solid #888; background: #fff; border-radius: 4px; font: inherit; padding: 6px 12px; white-space: nowrap; }
  button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
  button.danger { color: #b91c1c; border-color: #ddd; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 8px 10px; text-align: left; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  th { background: #f3f4f6; font-weight: 600; font-size: 14px; border-bottom: 1px solid #ddd; }
  td.acct { font-variant-numeric: tabular-nums; color: #374151; }
  td.num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: #9ca3af; padding: 16px; text-align: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-approved { background: #dbeafe; color: #1d4ed8; }
  .badge-rejected { background: #fee2e2; color: #b91c1c; }
  .badge-running { background: #ede9fe; color: #6d28d9; }
  .badge-done { background: #d1fae5; color: #047857; }
  .badge-failed { background: #fee2e2; color: #b91c1c; }
  .req-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 14px; background: #fff; }
  .req-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 8px; }
  .req-id { font-family: monospace; font-size: 12px; color: #6b7280; }
  .req-type { font-weight: 600; }
  .req-meta { color: #6b7280; font-size: 13px; margin-bottom: 8px; }
  .req-actions { margin-left: auto; display: flex; gap: 8px; }
  .req-summary table { margin-top: 6px; }
  .filter { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .filter button { padding: 4px 10px; }
  .filter button.active { background: #111827; color: #fff; border-color: #111827; }
  .audit { font-size: 12px; color: #6b7280; margin-top: 8px; }
  .result { background: #f9fafb; border-left: 4px solid #047857; padding: 8px 12px; margin-top: 8px; font-size: 14px; }
  .result.fail { border-left-color: #b91c1c; background: #fef2f2; }
  .err { color: #b91c1c; }
  .ok { color: #047857; }
  details summary { cursor: pointer; color: #1d4ed8; font-size: 14px; user-select: none; }
  details[open] summary { margin-bottom: 8px; }
  dialog { border: 1px solid #d1d5db; border-radius: 8px; padding: 0; max-width: 420px; width: 92%; }
  dialog::backdrop { background: rgba(15,23,42,0.5); }
  dialog .body { padding: 18px 22px; }
  dialog h3 { margin: 0 0 8px; font-size: 18px; }
  dialog p { margin: 0 0 14px; color: #4b5563; font-size: 14px; }
  dialog input { font: 24px/1.2 monospace; padding: 10px 14px; width: 100%; box-sizing: border-box; letter-spacing: 4px; text-align: center; border: 1px solid #ccc; border-radius: 6px; }
  dialog .actions { margin-top: 14px; display: flex; gap: 8px; justify-content: flex-end; }
  dialog .err { color: #b91c1c; margin-top: 8px; font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>คิวอนุมัติคำขอ</h1>
  <nav>
    <a href="/worksheet">คำนวณเงินเดือน</a>
    <a href="/accounts">จัดการบัญชี</a>
    <a href="/status">สถานะคำขอ</a>
    <!--ADMIN_NAV-->
  </nav>
  ${ZOOM_HTML}
</header>
<!--ADMIN_MODAL-->

<fieldset>
  <legend>คำขอทั้งหมด</legend>
  <div class="filter" id="filter">
    <span>สถานะ:</span>
    <button data-filter="all" class="active">ทั้งหมด</button>
    <button data-filter="pending">รออนุมัติ</button>
    <button data-filter="approved">อนุมัติแล้ว</button>
    <button data-filter="running">กำลังประมวลผล</button>
    <button data-filter="done">สำเร็จ</button>
    <button data-filter="failed">ไม่สำเร็จ</button>
    <button data-filter="rejected">ปฏิเสธ</button>
    <span style="margin-left:14px;">เดือน:</span>
    <select id="periodFilter" style="padding:4px 8px;border:1px solid #ccc;border-radius:4px;font:inherit;">
      <option value="all">ทุกเดือน</option>
    </select>
    <span style="margin-left:auto;color:#6b7280;font-size:13px;" id="meta"></span>
    <button type="button" id="refresh">รีเฟรช</button>
  </div>
  <div id="list"></div>
</fieldset>

<dialog id="otpDialog">
  <div class="body">
    <h3>กรอก OTP</h3>
    <p>ระบบส่ง OTP ไปที่ Slack แล้ว ดู OTP จาก Slack แล้วกรอกที่นี่ (อายุ 5 นาที)</p>
    <input id="otpInput" type="text" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off">
    <div class="err" id="otpErr"></div>
    <div class="actions">
      <button type="button" id="otpCancel">ยกเลิก</button>
      <button type="button" id="otpSubmit" class="primary">ยืนยันอนุมัติ</button>
    </div>
  </div>
</dialog>

<script>
const list = document.getElementById("list");
const meta = document.getElementById("meta");
const periodFilter = document.getElementById("periodFilter");
let currentFilter = "all";
let currentPeriod = new URLSearchParams(window.location.search).get("period") || "all";
let cache = [];

const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function periodLabel(p) {
  if (!p || !/^\\d{4}-\\d{2}$/.test(p)) return p || "—";
  const [y, m] = p.split("-").map(Number);
  return \`\${TH_MONTHS[m-1]} \${y + 543}\`;
}

// Convert effectiveDate "DD/MM/YYYY" (Gregorian) → "YYYY-MM" period key.
// Used as a fallback for queue items predating the period field.
function periodFromEffective(eff) {
  if (!eff) return null;
  const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(eff);
  return m ? \`\${m[3]}-\${m[2]}\` : null;
}

function reqPeriod(req) {
  if (req.summary && req.summary.period) return req.summary.period;
  if (req.summary && req.summary.effectiveDate) return periodFromEffective(req.summary.effectiveDate);
  return null;
}

const otpDialog = document.getElementById("otpDialog");
const otpInput = document.getElementById("otpInput");
const otpErr = document.getElementById("otpErr");
const otpSubmit = document.getElementById("otpSubmit");
const otpCancel = document.getElementById("otpCancel");
let otpTargetId = null;

otpCancel.addEventListener("click", () => otpDialog.close());
otpDialog.addEventListener("close", () => { otpTargetId = null; otpInput.value = ""; otpErr.textContent = ""; });
otpInput.addEventListener("input", () => { otpErr.textContent = ""; });
otpSubmit.addEventListener("click", () => submitOtp());
otpInput.addEventListener("keydown", (e) => { if (e.key === "Enter") submitOtp(); });

async function submitOtp() {
  if (!otpTargetId) return;
  const otp = otpInput.value.trim();
  if (!/^\\d{6}$/.test(otp)) { otpErr.textContent = "OTP ต้องเป็นตัวเลข 6 หลัก"; return; }
  otpSubmit.disabled = true;
  try {
    const res = await fetch(\`/api/queue/\${otpTargetId}/approve\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ otp }),
    });
    if (!res.ok) {
      otpErr.textContent = await res.text();
      return;
    }
    otpDialog.close();
    await refresh();
  } finally {
    otpSubmit.disabled = false;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function formatAccount(n) {
  const s = String(n).replace(/[^0-9]/g, "");
  if (s.length === 10) return s.slice(0,3)+"-"+s.slice(3,4)+"-"+s.slice(4,9)+"-"+s.slice(9);
  return s;
}

function fmtAmount(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return \`\${pad(d.getDate())}/\${pad(d.getMonth()+1)}/\${d.getFullYear()+543} \${pad(d.getHours())}:\${pad(d.getMinutes())}\`;
}

function statusBadge(status) {
  const labels = {
    pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
    rejected: "ปฏิเสธ", running: "กำลังประมวลผล",
    done: "สำเร็จ", failed: "ไม่สำเร็จ",
  };
  return \`<span class="badge badge-\${status}">\${labels[status] || status}</span>\`;
}

function summarize(req) {
  if (req.type === "transfer-payroll") {
    const s = req.summary;
    return \`โอนเงินเดือน · \${s.rows.length} ราย · ฿\${fmtAmount(s.totalAmount)} · เงินเข้า \${s.effectiveDate}\`;
  }
  if (req.type === "add-payroll") {
    return \`เพิ่มผู้รับเงิน · \${req.summary.accounts.length} บัญชี\`;
  }
  return req.type;
}

function renderRows(req) {
  if (req.type === "transfer-payroll") {
    const rows = req.summary.rows.map((r, i) => \`
      <tr>
        <td>\${i+1}</td>
        <td>\${escapeHtml(r.accountName)}</td>
        <td class="acct">\${escapeHtml(formatAccount(r.accountNumber))}</td>
        <td class="num">\${fmtAmount(r.amount)}</td>
      </tr>\`).join("");
    return \`<table>
      <thead><tr><th style="width:48px">#</th><th>ชื่อบัญชี</th><th>เลขบัญชี</th><th class="num">จำนวนเงิน</th></tr></thead>
      <tbody>\${rows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;border-top:2px solid #1d4ed8;">รวม</td><td class="num" style="font-weight:700;border-top:2px solid #1d4ed8;color:#1d4ed8;">\${fmtAmount(req.summary.totalAmount)}</td></tr></tfoot>
    </table>\`;
  }
  if (req.type === "add-payroll") {
    const rows = req.summary.accounts.map((a, i) => \`
      <tr>
        <td>\${i+1}</td>
        <td>\${escapeHtml(a.accountName)}</td>
        <td class="acct">\${escapeHtml(formatAccount(a.accountNumber))}</td>
      </tr>\`).join("");
    return \`<table>
      <thead><tr><th style="width:48px">#</th><th>ชื่อบัญชี</th><th>เลขบัญชี</th></tr></thead>
      <tbody>\${rows}</tbody>
    </table>\`;
  }
  return "";
}

function renderResult(req) {
  if (!req.result) return "";
  const cls = req.result.success ? "result" : "result fail";
  const head = req.result.success ? "✓ KBIZ ดำเนินการสำเร็จ" : "✗ KBIZ ไม่สำเร็จ";
  const lines = [];
  if (req.result.referenceNo) lines.push("Reference: <code>"+escapeHtml(req.result.referenceNo)+"</code>");
  if (req.result.finalUrl) lines.push("URL: <code>"+escapeHtml(req.result.finalUrl)+"</code>");
  if (req.result.error) lines.push('<span class="err">'+escapeHtml(req.result.error)+'</span>');
  return \`<div class="\${cls}"><strong>\${head}</strong><br>\${lines.join("<br>")}</div>\`;
}

function renderAudit(req) {
  const lines = [\`สร้างเมื่อ \${fmtDate(req.createdAt)}\`];
  if (req.approvedAt) lines.push(\`อนุมัติเมื่อ \${fmtDate(req.approvedAt)}\`);
  if (req.rejectedAt) lines.push(\`ปฏิเสธเมื่อ \${fmtDate(req.rejectedAt)}\${req.rejectionReason?" — "+escapeHtml(req.rejectionReason):""}\`);
  if (req.startedAt) lines.push(\`เริ่มประมวลผล \${fmtDate(req.startedAt)}\`);
  if (req.completedAt) lines.push(\`เสร็จเมื่อ \${fmtDate(req.completedAt)}\`);
  return '<div class="audit">' + lines.join(" · ") + "</div>";
}

function renderCard(req) {
  const actions = req.status === "pending"
    ? \`<button class="primary" data-action="approve" data-id="\${req.id}">อนุมัติ</button>
       <button class="danger" data-action="reject" data-id="\${req.id}">ปฏิเสธ</button>\`
    : "";
  // Snapshot view link only when the queue item carries an embedded sheet
  // (transfer-payroll items submitted post-feature). Older items have no
  // worksheet snapshot so the link would dead-end.
  const snapLink = req.type === "transfer-payroll" && req.summary && req.summary.sheet
    ? \`<a href="/worksheet?snapshot=\${encodeURIComponent(req.id)}" style="font-size:13px;">ดูรายละเอียดเงินเดือน</a>\`
    : "";
  return \`<div class="req-card">
    <div class="req-head">
      <span class="req-type">\${summarize(req)}</span>
      \${statusBadge(req.status)}
      <span class="req-id">\${req.id}</span>
      <span class="req-actions">
        \${snapLink}
        <a href="/api/queue/\${req.id}/xlsx" style="font-size:13px;">ดาวน์โหลด xlsx</a>
        \${actions}
      </span>
    </div>
    \${renderResult(req)}
    \${renderAudit(req)}
    <details><summary>ดูรายการผู้รับเงิน (\${req.type === "transfer-payroll" ? req.summary.rows.length : req.summary.accounts.length} รายการ)</summary>
      <div class="req-summary">\${renderRows(req)}</div>
    </details>
  </div>\`;
}

function applyFilter() {
  let filtered = cache;
  if (currentFilter !== "all") filtered = filtered.filter((r) => r.status === currentFilter);
  if (currentPeriod !== "all") filtered = filtered.filter((r) => reqPeriod(r) === currentPeriod);
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">ไม่มีคำขอในกลุ่มนี้</div>';
  } else {
    list.innerHTML = filtered.map(renderCard).join("");
    list.querySelectorAll("button[data-action]").forEach((btn) => {
      btn.addEventListener("click", () => handleAction(btn.dataset.action, btn.dataset.id));
    });
  }
  const counts = cache.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const bits = Object.entries(counts).map(([k, v]) => \`\${k}: \${v}\`).join(" · ");
  meta.textContent = cache.length === 0 ? "" : \`\${cache.length} รายการทั้งหมด · \${bits}\`;
}

function rebuildPeriodOptions() {
  const seen = new Set();
  for (const r of cache) { const p = reqPeriod(r); if (p) seen.add(p); }
  const sorted = Array.from(seen).sort().reverse();
  const cur = periodFilter.value;
  while (periodFilter.options.length > 1) periodFilter.remove(1);
  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = periodLabel(p);
    periodFilter.appendChild(opt);
  }
  if (sorted.includes(currentPeriod)) periodFilter.value = currentPeriod;
  else if (sorted.includes(cur)) { periodFilter.value = cur; currentPeriod = cur; }
  else { periodFilter.value = "all"; currentPeriod = "all"; }
}

async function refresh() {
  const res = await fetch("/api/queue");
  if (!res.ok) { list.innerHTML = '<div class="empty err">โหลดข้อมูลไม่สำเร็จ</div>'; return; }
  cache = await res.json();
  rebuildPeriodOptions();
  applyFilter();
}

periodFilter.addEventListener("change", () => {
  currentPeriod = periodFilter.value;
  applyFilter();
});

async function handleAction(action, id) {
  if (action === "approve") {
    const res = await fetch(\`/api/queue/\${id}/request-otp\`, { method: "POST" });
    if (!res.ok) { alert("ส่ง OTP ไปยัง Slack ไม่สำเร็จ: " + (await res.text())); return; }
    otpTargetId = id;
    otpErr.textContent = "";
    otpInput.value = "";
    otpDialog.showModal();
    setTimeout(() => otpInput.focus(), 50);
    return;
  }
  if (action === "reject") {
    const reason = prompt("เหตุผลที่ปฏิเสธ (ไม่ระบุก็ได้):");
    if (reason === null) return;
    const res = await fetch(\`/api/queue/\${id}/reject\`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ reason: reason || undefined }),
    });
    if (!res.ok) { alert("ไม่สำเร็จ: " + (await res.text())); return; }
    await refresh();
  }
}

document.getElementById("filter").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  document.querySelectorAll("#filter button[data-filter]").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentFilter = btn.dataset.filter;
  applyFilter();
});
document.getElementById("refresh").addEventListener("click", refresh);

// Auto-refresh every 5s so result updates from kbiz-bot show without manual reload
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
