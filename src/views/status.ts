import { ZOOM_HTML } from "./zoom";

// Read-only "where's my submission" page. Visible without admin OTP — HR
// users who submit transfer requests can track them through to the KBIZ
// outcome here. No row-level PII, no xlsx download, no approve/reject —
// those live on /approvals (admin-only).

export const STATUS_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>สถานะคำขอ - KBIZ Payroll</title>
<style>
  :root { font: 16px/1.5 "Noto Sans Thai", system-ui, sans-serif; }
  body { max-width: 1100px; margin: 20px auto; padding: 0 20px; color: #1a1a1a; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; margin: 0; flex: 1; }
  nav a { color: #1d4ed8; text-decoration: none; margin-left: 14px; font-size: 15px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid #d1d5db; padding: 16px 18px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 4px 12px; color: #111827; background: #fff; font-size: 16px; font-weight: 700; border-radius: 4px; }
  button { cursor: pointer; border: 1px solid #888; background: #fff; border-radius: 4px; font: inherit; padding: 6px 12px; }
  .filter { display: flex; gap: 8px; align-items: center; margin-bottom: 12px; flex-wrap: wrap; }
  .filter button { padding: 4px 10px; }
  .filter button.active { background: #111827; color: #fff; border-color: #111827; }
  .filter select { padding: 4px 8px; border: 1px solid #ccc; border-radius: 4px; font: inherit; }
  .empty { color: #9ca3af; padding: 16px; text-align: center; }
  .badge { display: inline-block; padding: 3px 10px; border-radius: 10px; font-size: 12px; font-weight: 600; white-space: nowrap; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  .badge-approved { background: #dbeafe; color: #1d4ed8; }
  .badge-rejected { background: #fee2e2; color: #b91c1c; }
  .badge-running { background: #ede9fe; color: #6d28d9; }
  .badge-done { background: #d1fae5; color: #047857; }
  .badge-failed { background: #fee2e2; color: #b91c1c; }
  .req-card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; background: #fff; }
  .req-head { display: flex; gap: 12px; align-items: center; flex-wrap: wrap; margin-bottom: 6px; }
  .req-type { font-weight: 600; }
  .req-id { font-family: monospace; font-size: 12px; color: #6b7280; }
  .req-summary { color: #374151; font-size: 14px; margin-top: 4px; }
  .req-summary strong { color: #1d4ed8; font-variant-numeric: tabular-nums; }
  .audit { font-size: 12px; color: #6b7280; margin-top: 8px; }
  .result { background: #f9fafb; border-left: 4px solid #047857; padding: 8px 12px; margin-top: 8px; font-size: 14px; }
  .result.fail { border-left-color: #b91c1c; background: #fef2f2; }
  .err { color: #b91c1c; }
  code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }
</style>
</head>
<body>
<header>
  <h1>สถานะคำขอ</h1>
  <nav>
    <a href="/worksheet">คำนวณเงินเดือน</a>
    <a href="/accounts">จัดการบัญชี</a>
    <a href="/status" class="active">สถานะคำขอ</a>
    <!--ADMIN_NAV-->
  </nav>
  ${ZOOM_HTML}
</header>
<!--ADMIN_MODAL-->

<fieldset>
  <legend>คำขอที่ส่งไปคิว</legend>
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
    <select id="periodFilter">
      <option value="all">ทุกเดือน</option>
    </select>
    <span style="margin-left:auto;color:#6b7280;font-size:13px;" id="meta"></span>
    <button type="button" id="refresh">รีเฟรช</button>
  </div>
  <div id="list"></div>
</fieldset>

<script>
const list = document.getElementById("list");
const meta = document.getElementById("meta");
const periodFilter = document.getElementById("periodFilter");
let currentStatus = "all";
let currentPeriod = new URLSearchParams(window.location.search).get("period") || "all";
let cache = [];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function fmtAmount(n) {
  if (n == null) return "—";
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

const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

function periodLabel(p) {
  if (!p || !/^\\d{4}-\\d{2}$/.test(p)) return p || "—";
  const [y, m] = p.split("-").map(Number);
  return \`\${TH_MONTHS[m-1]} \${y + 543}\`;
}

function summarize(req) {
  if (req.type === "transfer-payroll") {
    const period = req.period ? periodLabel(req.period) : (req.effectiveDate ? "เงินเข้า " + req.effectiveDate : "");
    return \`โอนเงินเดือน · \${req.recipientCount} คน · <strong>฿\${fmtAmount(req.totalAmount)}</strong>\${period?" · "+escapeHtml(period):""}\`;
  }
  if (req.type === "add-payroll") {
    return \`เพิ่มผู้รับเงิน · \${req.recipientCount} บัญชี\`;
  }
  return req.type;
}

function renderResult(req) {
  if (!req.result) return "";
  const cls = req.result.success ? "result" : "result fail";
  const head = req.result.success ? "✓ KBIZ ดำเนินการสำเร็จ" : "✗ KBIZ ไม่สำเร็จ";
  const lines = [];
  if (req.result.referenceNo) lines.push("Reference: <code>"+escapeHtml(req.result.referenceNo)+"</code>");
  if (req.result.error) lines.push('<span class="err">'+escapeHtml(req.result.error)+'</span>');
  return \`<div class="\${cls}"><strong>\${head}</strong>\${lines.length?'<br>'+lines.join("<br>"):''}</div>\`;
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
  return \`<div class="req-card">
    <div class="req-head">
      <span class="req-type">\${summarize(req)}</span>
      \${statusBadge(req.status)}
      <span class="req-id">\${escapeHtml(req.id)}</span>
    </div>
    \${renderResult(req)}
    \${renderAudit(req)}
  </div>\`;
}

function applyFilter() {
  let filtered = cache;
  if (currentStatus !== "all") filtered = filtered.filter((r) => r.status === currentStatus);
  if (currentPeriod !== "all") filtered = filtered.filter((r) => r.period === currentPeriod);
  if (filtered.length === 0) {
    list.innerHTML = '<div class="empty">ไม่มีคำขอในกลุ่มนี้</div>';
  } else {
    list.innerHTML = filtered.map(renderCard).join("");
  }
  const counts = cache.reduce((acc, r) => { acc[r.status] = (acc[r.status] || 0) + 1; return acc; }, {});
  const bits = Object.entries(counts).map(([k, v]) => \`\${k}: \${v}\`).join(" · ");
  meta.textContent = cache.length === 0 ? "" : \`\${cache.length} รายการทั้งหมด · \${bits}\`;
}

function rebuildPeriodOptions() {
  // Distinct period values from current cache, sorted descending (newest first).
  const seen = new Set();
  for (const r of cache) if (r.period) seen.add(r.period);
  const sorted = Array.from(seen).sort().reverse();
  const cur = periodFilter.value;
  while (periodFilter.options.length > 1) periodFilter.remove(1);
  for (const p of sorted) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = periodLabel(p);
    periodFilter.appendChild(opt);
  }
  // Honour ?period= query param on first paint, otherwise preserve user selection.
  if (sorted.includes(currentPeriod)) periodFilter.value = currentPeriod;
  else if (sorted.includes(cur)) { periodFilter.value = cur; currentPeriod = cur; }
  else { periodFilter.value = "all"; currentPeriod = "all"; }
}

async function refresh() {
  const res = await fetch("/api/queue/status");
  if (!res.ok) { list.innerHTML = '<div class="empty err">โหลดข้อมูลไม่สำเร็จ</div>'; return; }
  cache = await res.json();
  rebuildPeriodOptions();
  applyFilter();
}

document.getElementById("filter").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-filter]");
  if (!btn) return;
  document.querySelectorAll("#filter button[data-filter]").forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  currentStatus = btn.dataset.filter;
  applyFilter();
});
periodFilter.addEventListener("change", () => {
  currentPeriod = periodFilter.value;
  applyFilter();
});
document.getElementById("refresh").addEventListener("click", refresh);

// Auto-refresh every 5s so worker progress (running → done/failed) shows.
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
