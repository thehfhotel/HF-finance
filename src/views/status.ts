import { ZOOM_HTML } from "./zoom";

// Read-only "where's my submission" page. Visible without admin OTP — HR
// users who submit transfer requests can track them through to the KBIZ
// outcome here. No row-level PII, no xlsx download, no approve/reject —
// those live on /approvals (admin-only).
//
// Layout: hero (latest request) + condensed history rows. Filters appear
// only when there's enough volume to need them.

export const STATUS_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>สถานะคำขอ - KBIZ Payroll</title>
<style>
  :root { font: 16px/1.5 "Noto Sans Thai", system-ui, sans-serif; }
  body { max-width: 880px; margin: 24px auto; padding: 0 20px; color: #1a1a1a; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; flex-wrap: wrap; }
  h1 { font-size: 22px; margin: 0; flex: 1; font-weight: 600; }
  nav a { color: #1d4ed8; text-decoration: none; margin-left: 14px; font-size: 15px; }
  nav a.active { font-weight: 600; }
  h2 { font-size: 14px; font-weight: 500; color: #6b7280; margin: 32px 0 10px; letter-spacing: 0.02em; }

  .updated {
    font-size: 12px; color: #9ca3af; margin-bottom: 12px; transition: color 0.4s;
  }
  .updated.pulse { color: #047857; }

  /* Hero card — latest request gets the focal weight. */
  .hero {
    border: 1px solid #e5e7eb; border-radius: 10px; padding: 22px 26px;
    background: #fff; border-left-width: 4px;
  }
  .hero.s-pending  { border-left-color: #f59e0b; }
  .hero.s-approved { border-left-color: #1d4ed8; }
  .hero.s-running  { border-left-color: #6d28d9; }
  .hero.s-done     { border-left-color: #047857; }
  .hero.s-failed   { border-left-color: #b91c1c; }
  .hero.s-rejected { border-left-color: #b91c1c; }
  .hero-row1 { display: flex; align-items: baseline; gap: 12px; }
  .hero-row1 .ago { color: #6b7280; font-size: 14px; }
  .hero-headline { font-size: 18px; font-weight: 600; margin-top: 8px; }
  .hero-figures {
    margin-top: 4px; color: #4b5563; font-size: 14px; font-variant-numeric: tabular-nums;
  }
  .hero-figures .amount {
    color: #0f172a; font-weight: 600; font-size: 18px;
  }
  .hero-state {
    margin-top: 16px; padding: 10px 14px; border-radius: 6px;
    font-size: 14px; color: #374151; background: #f9fafb;
    border-left: 3px solid transparent;
  }
  .hero-state.success { background: transparent; border-left-color: #047857; padding-left: 12px; padding-right: 0; }
  .hero-state.failure { background: #fef2f2; border-left-color: #b91c1c; color: #991b1b; }
  .hero-state .ref { font-family: ui-monospace, SFMono-Regular, monospace; color: #111827; }
  .hero-state .label { color: #6b7280; margin-right: 6px; }
  .hero-actions {
    margin-top: 16px; display: flex; gap: 14px; align-items: center;
  }
  .hero-actions a { color: #1d4ed8; text-decoration: none; font-size: 13px; }
  .hero-actions a:hover { text-decoration: underline; }
  .hero-actions .spacer { color: #d1d5db; }

  .hero-details {
    margin-top: 12px; font-size: 13px; color: #6b7280;
  }
  .hero-details summary { cursor: pointer; user-select: none; color: #1d4ed8; font-size: 13px; }
  .hero-details[open] summary { margin-bottom: 8px; }
  .hero-details .kv {
    display: grid; grid-template-columns: max-content 1fr; gap: 4px 16px; margin-top: 8px;
  }
  .hero-details .kv dt { color: #6b7280; }
  .hero-details .kv dd { margin: 0; font-variant-numeric: tabular-nums; color: #374151; }
  .hero-details .kv dd code { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; }

  /* History rows — single line, muted, scannable. */
  .row {
    display: grid;
    grid-template-columns: 90px 70px 1fr auto auto auto;
    gap: 14px; align-items: center;
    padding: 10px 14px; font-size: 14px;
    border: 1px solid #f0f0f0; border-radius: 6px; background: #fff;
    margin-bottom: 6px;
  }
  .row.s-failed, .row.s-rejected { border-left: 3px solid #fca5a5; }
  .row .pill {
    display: inline-block; padding: 2px 8px; border-radius: 10px;
    font-size: 11px; font-weight: 600; text-align: center;
  }
  .row .when { color: #6b7280; font-size: 12px; font-variant-numeric: tabular-nums; }
  .row .label { color: #1f2937; }
  .row .figures { color: #6b7280; font-variant-numeric: tabular-nums; font-size: 13px; }
  .row .ref { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 12px; color: #6b7280; }
  .row .links { display: flex; gap: 10px; }
  .row .links a { color: #1d4ed8; text-decoration: none; font-size: 12px; }
  .row .links a:hover { text-decoration: underline; }

  /* Pills (shared with hero + rows). Color tokens match /approvals. */
  .pill.p-pending  { background: #fef3c7; color: #92400e; }
  .pill.p-approved { background: #dbeafe; color: #1d4ed8; }
  .pill.p-running  { background: #ede9fe; color: #6d28d9; }
  .pill.p-done     { background: #d1fae5; color: #047857; }
  .pill.p-failed   { background: #fee2e2; color: #b91c1c; }
  .pill.p-rejected { background: #fee2e2; color: #b91c1c; }
  .hero-row1 .pill { padding: 4px 12px; font-size: 13px; }

  .empty { color: #9ca3af; padding: 28px; text-align: center; border: 1px dashed #e5e7eb; border-radius: 8px; }

  /* Filter row — only mounted when cache exceeds threshold. */
  .filters {
    display: flex; gap: 10px; align-items: center; margin: 8px 0 16px;
    font-size: 13px; color: #6b7280;
  }
  .filters select {
    font: inherit; padding: 4px 8px; border: 1px solid #d1d5db;
    border-radius: 4px; background: #fff; color: #374151;
  }
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

<div class="updated" id="updated">&nbsp;</div>

<div id="filtersHost"></div>

<div id="hero"></div>

<div id="historyHost"></div>

<script>
const heroEl = document.getElementById("hero");
const historyHost = document.getElementById("historyHost");
const filtersHost = document.getElementById("filtersHost");
const updatedEl = document.getElementById("updated");
let lastFetchedAt = 0;
let cache = [];
let currentPeriod = new URLSearchParams(window.location.search).get("period") || "all";

const STATUS_LABELS = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธ", running: "กำลังประมวลผล",
  done: "สำเร็จ", failed: "ไม่สำเร็จ",
};
const STATE_HINTS = {
  pending: "รอผู้อนุมัติยืนยัน OTP",
  approved: "อนุมัติแล้ว · รอ kbiz-bot รับงาน",
  running: "กำลังดำเนินการในระบบ KBIZ…",
};
const TH_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                   "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
const TH_MONTHS_SHORT = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
                         "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function fmtAmount(n) {
  if (n == null) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function periodLong(p) {
  if (!p || !/^\\d{4}-\\d{2}$/.test(p)) return p || "";
  const [y, m] = p.split("-").map(Number);
  return \`\${TH_MONTHS[m-1]} \${y + 543}\`;
}
function periodShort(p) {
  if (!p || !/^\\d{4}-\\d{2}$/.test(p)) return p || "";
  const [y, m] = p.split("-").map(Number);
  return \`\${TH_MONTHS_SHORT[m-1]} \${y + 543}\`;
}
function relativeTime(iso) {
  if (!iso) return "";
  const sec = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (sec < 60) return "เมื่อสักครู่";
  if (sec < 3600) return \`เมื่อ \${Math.floor(sec/60)} นาทีที่แล้ว\`;
  if (sec < 86400) return \`เมื่อ \${Math.floor(sec/3600)} ชั่วโมงที่แล้ว\`;
  if (sec < 86400 * 7) return \`เมื่อ \${Math.floor(sec/86400)} วันที่แล้ว\`;
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return \`\${pad(d.getDate())}/\${pad(d.getMonth()+1)}/\${d.getFullYear()+543}\`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return \`\${pad(d.getDate())}/\${pad(d.getMonth()+1)}/\${d.getFullYear()+543} \${pad(d.getHours())}:\${pad(d.getMinutes())}\`;
}
function shortWhen(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");
  return \`\${pad(d.getDate())}/\${pad(d.getMonth()+1)} \${pad(d.getHours())}:\${pad(d.getMinutes())}\`;
}
// "Effective time" for relative display = the most recent state transition.
function effectiveTime(req) {
  return req.completedAt || req.startedAt || req.approvedAt || req.rejectedAt || req.createdAt;
}

function headlineFor(req) {
  if (req.type === "transfer-payroll") {
    return \`โอนเงินเดือน \${periodLong(req.period) || "—"}\`;
  }
  if (req.type === "add-payroll") {
    return "เพิ่มผู้รับเงินใหม่ (KBIZ)";
  }
  return req.type;
}

function renderHero(req) {
  const status = req.status;
  const pillClass = "p-" + status;
  const cardClass = "hero s-" + status;

  // Figure line: "23 คน · ฿487,520.50 · เงินเข้า 09/05/2569"
  const bits = [];
  if (req.recipientCount) bits.push(\`\${req.recipientCount} \${req.type === "transfer-payroll" ? "คน" : "บัญชี"}\`);
  if (req.totalAmount != null) bits.push(\`<span class="amount">฿\${fmtAmount(req.totalAmount)}</span>\`);
  if (req.effectiveDate) bits.push(\`เงินเข้า \${escapeHtml(req.effectiveDate)}\`);

  // State line — depends on lifecycle stage.
  let stateHtml = "";
  if (req.result) {
    if (req.result.success) {
      const ref = req.result.referenceNo
        ? \`<span class="label">KBIZ Reference</span><span class="ref">\${escapeHtml(req.result.referenceNo)}</span>\`
        : "ไม่พบ reference";
      stateHtml = \`<div class="hero-state success">\${ref}</div>\`;
    } else {
      stateHtml = \`<div class="hero-state failure">KBIZ ไม่สำเร็จ — \${escapeHtml(req.result.error || "ไม่ทราบสาเหตุ")}</div>\`;
    }
  } else if (status === "rejected") {
    stateHtml = \`<div class="hero-state failure">ปฏิเสธ\${req.rejectionReason ? " — " + escapeHtml(req.rejectionReason) : ""}</div>\`;
  } else if (STATE_HINTS[status]) {
    stateHtml = \`<div class="hero-state">\${STATE_HINTS[status]}</div>\`;
  }

  // Audit disclosure
  const audit = [];
  audit.push(["สร้าง", req.createdAt]);
  if (req.approvedAt) audit.push(["อนุมัติ", req.approvedAt]);
  if (req.rejectedAt) audit.push(["ปฏิเสธ", req.rejectedAt]);
  if (req.startedAt) audit.push(["เริ่มประมวลผล", req.startedAt]);
  if (req.completedAt) audit.push(["เสร็จ", req.completedAt]);
  const auditHtml = audit.map(([k, v]) => \`<dt>\${k}</dt><dd>\${fmtDate(v)}</dd>\`).join("");

  // Detail links — only meaningful for transfer-payroll items (the
  // worksheet snapshot view is structured around the worksheet schema).
  const actionsHtml = req.type === "transfer-payroll"
    ? \`<div class="hero-actions">
        <a href="/worksheet?snapshot=\${encodeURIComponent(req.id)}">ดูรายละเอียดเงินเดือน</a>
        <span class="spacer">·</span>
        <a href="/api/queue/\${encodeURIComponent(req.id)}/xlsx">ดาวน์โหลด xlsx</a>
       </div>\`
    : "";

  return \`<div class="\${cardClass}">
    <div class="hero-row1">
      <span class="pill \${pillClass}">\${STATUS_LABELS[status] || status}</span>
      <span class="ago">\${relativeTime(effectiveTime(req))}</span>
    </div>
    <div class="hero-headline">\${escapeHtml(headlineFor(req))}</div>
    <div class="hero-figures">\${bits.join(" · ")}</div>
    \${stateHtml}
    \${actionsHtml}
    <details class="hero-details">
      <summary>ดูเวลาทุกขั้นตอน</summary>
      <dl class="kv">\${auditHtml}<dt>ID</dt><dd><code>\${escapeHtml(req.id)}</code></dd></dl>
    </details>
  </div>\`;
}

function renderRow(req) {
  const ref = req.result && req.result.referenceNo ? escapeHtml(req.result.referenceNo) : "";
  const figures = [
    req.recipientCount ? \`\${req.recipientCount} \${req.type === "transfer-payroll" ? "คน" : "บัญชี"}\` : "",
    req.totalAmount != null ? \`฿\${fmtAmount(req.totalAmount)}\` : "",
  ].filter(Boolean).join(" · ");
  const detailLink = req.type === "transfer-payroll"
    ? \`<a href="/worksheet?snapshot=\${encodeURIComponent(req.id)}">รายละเอียด</a>\`
    : "";
  return \`<div class="row s-\${req.status}" title="\${escapeHtml(req.id)}">
    <span class="pill p-\${req.status}">\${STATUS_LABELS[req.status] || req.status}</span>
    <span class="when">\${shortWhen(effectiveTime(req))}</span>
    <span class="label">\${escapeHtml(headlineFor(req))}</span>
    <span class="figures">\${figures}</span>
    <span class="ref">\${ref}</span>
    <span class="links">\${detailLink}</span>
  </div>\`;
}

function renderFilters(periods) {
  // Only mount the dropdown when there's actually a choice to make.
  if (periods.length <= 1) {
    filtersHost.innerHTML = "";
    return;
  }
  const opts = ['<option value="all">ทุกเดือน</option>']
    .concat(periods.map((p) => \`<option value="\${escapeHtml(p)}"\${p === currentPeriod ? " selected" : ""}>\${escapeHtml(periodLong(p))}</option>\`));
  filtersHost.innerHTML = \`<div class="filters">
    <span>กรองตามเดือน:</span>
    <select id="periodFilter">\${opts.join("")}</select>
  </div>\`;
  document.getElementById("periodFilter").addEventListener("change", (e) => {
    currentPeriod = e.target.value;
    paint();
  });
}

function paint() {
  let items = cache.slice();
  if (currentPeriod !== "all") items = items.filter((r) => r.period === currentPeriod);

  if (items.length === 0) {
    heroEl.innerHTML = '<div class="empty">ยังไม่มีคำขอ</div>';
    historyHost.innerHTML = "";
    return;
  }

  // Hero = first item (cache is sorted desc by createdAt server-side).
  heroEl.innerHTML = renderHero(items[0]);

  const rest = items.slice(1);
  if (rest.length === 0) {
    historyHost.innerHTML = "";
  } else {
    historyHost.innerHTML =
      \`<h2>ก่อนหน้านี้ (\${rest.length})</h2>\` +
      rest.map(renderRow).join("");
  }
}

function repaintRelativeTimes() {
  // Re-render the hero "ago" without re-fetching, so the time stays accurate
  // between auto-refresh ticks.
  if (cache.length === 0) return;
  const items = currentPeriod === "all" ? cache : cache.filter((r) => r.period === currentPeriod);
  if (items.length === 0) return;
  const ago = document.querySelector(".hero-row1 .ago");
  if (ago) ago.textContent = relativeTime(effectiveTime(items[0]));
}

function flashUpdated() {
  lastFetchedAt = Date.now();
  updatedEl.textContent = "อัปเดตเมื่อสักครู่";
  updatedEl.classList.add("pulse");
  setTimeout(() => updatedEl.classList.remove("pulse"), 600);
}
function tickUpdatedLabel() {
  if (lastFetchedAt === 0) return;
  const sec = Math.floor((Date.now() - lastFetchedAt) / 1000);
  if (sec < 5) updatedEl.textContent = "อัปเดตเมื่อสักครู่";
  else if (sec < 60) updatedEl.textContent = \`อัปเดตเมื่อ \${sec} วินาทีที่แล้ว\`;
  else updatedEl.textContent = \`อัปเดตเมื่อ \${Math.floor(sec/60)} นาทีที่แล้ว\`;
}

async function refresh() {
  try {
    const res = await fetch("/api/queue/status");
    if (!res.ok) {
      heroEl.innerHTML = '<div class="empty err">โหลดข้อมูลไม่สำเร็จ</div>';
      historyHost.innerHTML = "";
      return;
    }
    cache = await res.json();
    const seen = new Set();
    for (const r of cache) if (r.period) seen.add(r.period);
    const periods = Array.from(seen).sort().reverse();
    renderFilters(periods);
    paint();
    flashUpdated();
  } catch {
    heroEl.innerHTML = '<div class="empty err">โหลดข้อมูลไม่สำเร็จ</div>';
  }
}

refresh();
setInterval(refresh, 5000);
setInterval(() => { tickUpdatedLabel(); repaintRelativeTimes(); }, 1000);
</script>
</body>
</html>`;
