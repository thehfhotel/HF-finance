import { ZOOM_HTML } from "./zoom";

export const MAIN_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>สร้างไฟล์โอนเงินเดือน KBIZ</title>
<link rel="stylesheet" href="/static/flatpickr.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    font: 16px/1.5 "Sarabun", "Noto Sans Thai", system-ui, sans-serif;
    --hf-brand-50: #FBEAEA;
    --hf-brand-100: #F5C9C9;
    --hf-brand-300: #C76060;
    --hf-brand-500: #8B0000;
    --hf-brand-600: #7A0000;
    --hf-brand-700: #6B1212;
    --hf-brand-800: #4F0E0E;
    --hf-gold-100: #F6EACB;
    --hf-gold-300: #E7C97F;
    --hf-gold-500: #D9A441;
    --hf-gold-600: #B98730;
    --hf-gold-700: #93691F;
    --hf-shell: #FAF9F7;
    --hf-panel: #FFFFFF;
    --hf-panel-tint: #F4F1ED;
    --hf-zebra: #FAFAFB;
    --hf-border: #E8E4DF;
    --hf-border-strong: #CFC9C1;
    --hf-text: #26221E;
    --hf-text-muted: #7A7268;
    --hf-success: #2F855A;
    --hf-warning: #B7791F;
    --hf-error: #C53030;
    --hf-info: #2C5282;
  }
  body { max-width: 1500px; margin: 20px auto; padding: 0 20px; color: var(--hf-text); }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
  h1 { font-size: 22px; margin: 0; flex: 1; }
  nav a { color: var(--hf-brand-500); text-decoration: none; margin-left: 14px; font-size: 15px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid var(--hf-border-strong); padding: 16px 18px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 4px 12px; color: var(--hf-text); background: var(--hf-panel); font-size: 16px; font-weight: 700; border-radius: 4px; }
  label { display: inline-block; min-width: 170px; }
  input, button { font: inherit; padding: 7px 10px; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 8px; text-align: left; border-bottom: 1px solid var(--hf-border); vertical-align: middle; }
  th { background: var(--hf-panel-tint); font-weight: 600; border-bottom: 1px solid var(--hf-border-strong); font-size: 14px; }
  td input { width: 100%; border: 1px solid var(--hf-border-strong); border-radius: 4px; }
  td.num input { text-align: right; }
  /* Two-column desktop layout: roster on left, skipped + ad-hoc stacked on right */
  .grid { display: grid; grid-template-columns: 1.6fr 1fr; gap: 16px; align-items: start; }
  @media (max-width: 1100px) { .grid { grid-template-columns: 1fr; } }
  .grid > div > fieldset { margin-bottom: 16px; }
  /* Hide number spinners */
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
  input[type="number"] { -moz-appearance: textfield; appearance: textfield; }
  .actions { margin-top: 12px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  button { cursor: pointer; border: 1px solid var(--hf-border-strong); background: var(--hf-panel); border-radius: 4px; white-space: nowrap; }
  button.primary { background: var(--hf-brand-500); color: var(--hf-panel); border-color: var(--hf-brand-500); padding: 8px 16px; }
  button.danger { color: var(--hf-error); border-color: var(--hf-border-strong); }
  button.warn { color: var(--hf-warning); border-color: var(--hf-border-strong); }
  .total { margin-left: auto; font-weight: 600; }
  .err { color: var(--hf-error); margin-top: 8px; white-space: pre-wrap; }
  .ok { color: var(--hf-success); margin-top: 8px; }
  .hint { color: var(--hf-text-muted); font-size: 13px; }
  .acct { font-variant-numeric: tabular-nums; color: var(--hf-text); }
  .idx { color: var(--hf-text-muted); text-align: center; font-variant-numeric: tabular-nums; width: 36px; }
  .empty { color: var(--hf-text-muted); padding: 10px; text-align: center; }
  .skipped td { color: var(--hf-text-muted); }
  .skipped .name { text-decoration: line-through; }
  #effectiveDate { width: 220px; font-variant-numeric: tabular-nums; font-size: 16px; }
  .top-row { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; margin-bottom: 8px; }
  .top-date { display: flex; align-items: center; gap: 12px; }
  .top-total { font-size: 18px; font-weight: 600; color: var(--hf-text); }
  .top-actions { margin-left: auto; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  /* Force flatpickr month/year display in calendar to be readable */
  .flatpickr-current-month .cur-year { font-weight: 600; }
  /* Defensive: the hf-bar band is a sibling of the detached report div that
     html2canvas captures, so it's already excluded from the .jpg export —
     this just also keeps it out of a real browser print (Ctrl+P). */
  @media print { #hf-bar-host { display: none; } }
</style>
</head>
<body>
<header>
  <h1>สร้างไฟล์โอนเงินเดือน KBIZ</h1>
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
  <legend>ข้อมูลทั่วไป &middot; สรุป</legend>
  <div class="top-row">
    <div class="top-date">
      <label for="effectiveDate">วันที่เงินเข้าบัญชี</label>
      <input id="effectiveDate" type="text" placeholder="วว/ดด/ปปปป" autocomplete="off" required>
    </div>
    <div class="top-total">ยอดรวม: <span id="totalAmount">0.00</span> บาท &middot; <span id="rowCount">0</span> รายการ</div>
    <div class="top-actions">
      <button type="button" id="submit" class="primary">ส่งคำขออนุมัติ</button>
      <button type="button" id="screenshot">บันทึกรายงาน (.jpg)</button>
    </div>
  </div>
  <div class="hint">รูปแบบ พ.ศ. — ระบบจะแปลงเป็น ค.ศ. ในไฟล์ &middot; รหัสธนาคาร 004 (กสิกรไทย) อัตโนมัติ</div>
</fieldset>

<div class="grid">
  <div>
    <fieldset>
      <legend>รายการประจำ (เลือกจากบัญชีที่บันทึกไว้)</legend>
      <table>
        <thead>
          <tr>
            <th style="width:48px">ลำดับ</th>
            <th style="width:38%">ชื่อบัญชี</th>
            <th style="width:22%">เลขบัญชี</th>
            <th style="width:22%">จำนวนเงิน (บาท)</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="rosterRows"></tbody>
      </table>
      <div class="hint">เว้นว่างไว้สำหรับคนที่ไม่ได้รับเงินรอบนี้ หรือกดปุ่ม "ข้ามรอบนี้"</div>
    </fieldset>
  </div>

  <div>
    <fieldset>
      <legend>ไม่จ่ายรอบนี้</legend>
      <table>
        <thead>
          <tr>
            <th style="width:48px">ลำดับ</th>
            <th>ชื่อบัญชี</th>
            <th style="width:30%">เลขบัญชี</th>
            <th></th>
          </tr>
        </thead>
        <tbody id="skippedRows"></tbody>
      </table>
      <div class="hint">หากต้องการเพิ่มผู้รับเงินใหม่ ต้องไปลงทะเบียนที่ <a href="/accounts">หน้าจัดการบัญชี</a> ก่อน</div>
    </fieldset>
  </div>
</div>


<div id="msg"></div>

<script src="/static/flatpickr.js"></script>
<script src="/static/flatpickr-th.js"></script>
<script src="/static/html2canvas.js"></script>
<script>
const rosterTbody = document.getElementById("rosterRows");
const skippedTbody = document.getElementById("skippedRows");
const totalEl = document.getElementById("totalAmount");
const countEl = document.getElementById("rowCount");
const msgEl = document.getElementById("msg");

let selectedDate = null;

function showError(text) { msgEl.className = "err"; msgEl.textContent = text; }
function clearMsg() { msgEl.className = ""; msgEl.textContent = ""; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function formatAccount(n) {
  const s = String(n).replace(/[^0-9]/g, "");
  if (s.length === 10) return s.slice(0, 3) + "-" + s.slice(3, 4) + "-" + s.slice(4, 9) + "-" + s.slice(9);
  return s;
}

function recalc() {
  let total = 0, n = 0;
  document.querySelectorAll("input.amt").forEach((el) => {
    if (el.disabled) return;
    const v = parseFloat(el.value);
    if (!Number.isNaN(v) && v > 0) { total += v; n++; }
  });
  totalEl.textContent = total.toFixed(2);
  countEl.textContent = String(n);
}

function rosterRow(account) {
  const tr = document.createElement("tr");
  tr.dataset.accountNumber = account.accountNumber;
  tr.dataset.accountName = account.accountName;
  tr.innerHTML = \`
    <td class="idx"></td>
    <td class="name">\${escapeHtml(account.accountName)}</td>
    <td class="acct">\${escapeHtml(formatAccount(account.accountNumber))}</td>
    <td class="num"><input class="amt" type="number" min="0" step="0.01" placeholder="—"></td>
    <td><button type="button" class="warn skip">ข้ามรอบนี้</button></td>\`;
  const amt = tr.querySelector(".amt");
  amt.addEventListener("input", recalc);
  amt.addEventListener("blur", () => formatAmount(amt));
  tr.querySelector(".skip").addEventListener("click", () => skip(tr));
  return tr;
}

function formatAmount(el) {
  const v = parseFloat(el.value);
  if (!Number.isNaN(v) && v > 0) el.value = v.toFixed(2);
}

function skippedRow(tr) {
  const sr = document.createElement("tr");
  sr.classList.add("skipped");
  sr.dataset.accountNumber = tr.dataset.accountNumber;
  sr.dataset.accountName = tr.dataset.accountName;
  sr.innerHTML = \`
    <td class="idx"></td>
    <td class="name">\${escapeHtml(tr.dataset.accountName)}</td>
    <td class="acct">\${escapeHtml(formatAccount(tr.dataset.accountNumber))}</td>
    <td><button type="button" class="restore">นำกลับ</button></td>\`;
  sr.querySelector(".restore").addEventListener("click", () => restore(sr));
  return sr;
}

function skip(tr) {
  tr.querySelector(".amt").value = "";
  skippedTbody.appendChild(skippedRow(tr));
  tr.remove();
  recalc();
  renumberAll();
}

function restore(sr) {
  const account = { accountNumber: sr.dataset.accountNumber, accountName: sr.dataset.accountName };
  rosterTbody.appendChild(rosterRow(account));
  sr.remove();
  recalc();
  renumberAll();
}

function renumber(tbody) {
  const rows = tbody.querySelectorAll("tr");
  rows.forEach((tr, i) => {
    const idx = tr.querySelector(".idx");
    if (idx) idx.textContent = String(i + 1);
  });
}

function renumberAll() {
  renumber(rosterTbody);
  renumber(skippedTbody);
}

async function loadRoster() {
  const res = await fetch("/api/accounts");
  if (!res.ok) { showError("โหลดรายการบัญชีไม่สำเร็จ"); return; }
  const accounts = await res.json();
  rosterTbody.innerHTML = "";
  if (accounts.length === 0) {
    rosterTbody.innerHTML = '<tr><td colspan="5" class="empty">ยังไม่มีบัญชีในระบบ — เพิ่มได้ที่หน้า "จัดการบัญชี"</td></tr>';
    return;
  }
  for (const a of accounts) rosterTbody.appendChild(rosterRow(a));
  renumberAll();
}

function pad(n) { return String(n).padStart(2, "0"); }
function formatBE(date) { return \`\${pad(date.getDate())}/\${pad(date.getMonth() + 1)}/\${date.getFullYear() + 543}\`; }
function formatGregorian(date) { return \`\${pad(date.getDate())}/\${pad(date.getMonth() + 1)}/\${date.getFullYear()}\`; }

function setupYearDisplay(fp) {
  const yi = fp.calendarContainer.querySelector(".cur-year");
  if (!yi) return;
  const sync = () => { yi.value = fp.currentYear + 543; };
  sync();
  yi.addEventListener("input", () => {
    const v = parseInt(yi.value, 10);
    if (!isNaN(v) && v > 2400 && v < 2700) fp.changeYear(v - 543);
  });
  fp._beSync = sync;
}

function currentCyclePayout() {
  // Payout date of the current cycle = the next 5th-of-month. Before the 5th
  // that's this month's 5th (paying the previous cycle, e.g. 5 Jun for May);
  // from the 5th onward it's next month's 5th.
  const now = new Date();
  const mo = now.getDate() < 5 ? now.getMonth() : now.getMonth() + 1;
  return new Date(now.getFullYear(), mo, 5);
}
const defaultEffective = currentCyclePayout();
selectedDate = defaultEffective;

const fp = flatpickr("#effectiveDate", {
  locale: "th",
  allowInput: true,
  dateFormat: "d/m/Y",
  formatDate: (date) => formatBE(date),
  parseDate: (str) => {
    const [d, m, y] = str.split("/").map(Number);
    if (!d || !m || !y) return null;
    return new Date(y - 543, m - 1, d);
  },
  onChange: (dates) => { selectedDate = dates[0] || null; clearMsg(); },
  onReady: (sel, str, fp) => setupYearDisplay(fp),
  onYearChange: (sel, str, fp) => fp._beSync && fp._beSync(),
  onMonthChange: (sel, str, fp) => fp._beSync && fp._beSync(),
  onOpen: (sel, str, fp) => fp._beSync && fp._beSync(),
});
fp.setDate(defaultEffective, true);

function fmtAmount(n) {
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function buildReportElement() {
  const paid = [];
  for (const tr of rosterTbody.querySelectorAll("tr[data-account-number]")) {
    const v = parseFloat(tr.querySelector(".amt").value);
    if (!Number.isNaN(v) && v > 0) {
      paid.push({
        accountNumber: tr.dataset.accountNumber,
        accountName: tr.dataset.accountName,
        amount: v,
      });
    }
  }
  const skipped = [];
  for (const tr of skippedTbody.querySelectorAll("tr[data-account-number]")) {
    skipped.push({ accountNumber: tr.dataset.accountNumber, accountName: tr.dataset.accountName });
  }
  const total = paid.reduce((s, r) => s + r.amount, 0);

  const now = new Date();
  const generatedAt = \`\${pad(now.getDate())}/\${pad(now.getMonth() + 1)}/\${now.getFullYear() + 543} \${pad(now.getHours())}:\${pad(now.getMinutes())}\`;
  const effective = selectedDate ? formatBE(selectedDate) : "—";

  const div = document.createElement("div");
  div.id = "report-render";
  div.style.cssText = "position:absolute; left:-10000px; top:0; width:900px; padding:32px; background:var(--hf-panel); color:var(--hf-text); font:14px/1.5 'Sarabun', 'Noto Sans Thai', system-ui, sans-serif;";

  const paidRows = paid.map((r, i) => \`
    <tr>
      <td style="text-align:center;">\${i + 1}</td>
      <td>\${escapeHtml(r.accountName)}</td>
      <td style="font-variant-numeric:tabular-nums;">\${escapeHtml(formatAccount(r.accountNumber))}</td>
      <td style="text-align:right; font-variant-numeric:tabular-nums;">\${fmtAmount(r.amount)}</td>
    </tr>\`).join("");

  const skippedSection = skipped.length === 0 ? "" : \`
    <h2 style="font-size:16px; margin:24px 0 8px; color:var(--hf-text-muted);">ไม่จ่ายรอบนี้ (\${skipped.length} รายการ)</h2>
    <table style="width:100%; border-collapse:collapse; font-size:13px; color:var(--hf-text-muted);">
      <thead>
        <tr style="background:var(--hf-zebra);">
          <th style="padding:6px 8px; text-align:center; border-bottom:1px solid var(--hf-border-strong); width:48px;">#</th>
          <th style="padding:6px 8px; text-align:left; border-bottom:1px solid var(--hf-border-strong);">ชื่อบัญชี</th>
          <th style="padding:6px 8px; text-align:left; border-bottom:1px solid var(--hf-border-strong);">เลขบัญชี</th>
        </tr>
      </thead>
      <tbody>
        \${skipped.map((r, i) => \`
          <tr>
            <td style="padding:5px 8px; text-align:center; border-bottom:1px solid var(--hf-panel-tint);">\${i + 1}</td>
            <td style="padding:5px 8px; border-bottom:1px solid var(--hf-panel-tint); text-decoration:line-through;">\${escapeHtml(r.accountName)}</td>
            <td style="padding:5px 8px; border-bottom:1px solid var(--hf-panel-tint); font-variant-numeric:tabular-nums;">\${escapeHtml(formatAccount(r.accountNumber))}</td>
          </tr>\`).join("")}
      </tbody>
    </table>\`;

  div.innerHTML = \`
    <div style="border-bottom:2px solid var(--hf-brand-500); padding-bottom:12px; margin-bottom:20px;">
      <h1 style="font-size:22px; margin:0; color:var(--hf-text);">รายงานการโอนเงินเดือน KBIZ</h1>
      <div style="font-size:13px; color:var(--hf-text-muted); margin-top:4px;">ธนาคารกสิกรไทย (รหัสธนาคาร 004)</div>
    </div>

    <table style="width:100%; margin-bottom:20px; font-size:14px;">
      <tr>
        <td style="color:var(--hf-text-muted); padding:2px 0; width:30%;">วันที่เงินเข้าบัญชี</td>
        <td style="font-weight:600;">\${effective}</td>
      </tr>
      <tr>
        <td style="color:var(--hf-text-muted); padding:2px 0;">จำนวนรายการที่จ่าย</td>
        <td style="font-weight:600;">\${paid.length} รายการ</td>
      </tr>
      <tr>
        <td style="color:var(--hf-text-muted); padding:2px 0;">ยอดรวมทั้งสิ้น</td>
        <td style="font-weight:600; font-size:18px; color:var(--hf-brand-500); font-variant-numeric:tabular-nums;">\${fmtAmount(total)} บาท</td>
      </tr>
      <tr>
        <td style="color:var(--hf-text-muted); padding:2px 0;">สร้างเมื่อ</td>
        <td>\${generatedAt}</td>
      </tr>
    </table>

    <h2 style="font-size:16px; margin:0 0 8px; color:var(--hf-text);">รายการจ่ายเงินเดือน (\${paid.length} รายการ)</h2>
    <table style="width:100%; border-collapse:collapse; font-size:14px;">
      <thead>
        <tr style="background:var(--hf-panel-tint);">
          <th style="padding:8px; text-align:center; border-bottom:2px solid var(--hf-border-strong); width:48px;">ลำดับ</th>
          <th style="padding:8px; text-align:left; border-bottom:2px solid var(--hf-border-strong);">ชื่อบัญชี</th>
          <th style="padding:8px; text-align:left; border-bottom:2px solid var(--hf-border-strong); width:170px;">เลขบัญชี</th>
          <th style="padding:8px; text-align:right; border-bottom:2px solid var(--hf-border-strong); width:140px;">จำนวนเงิน (บาท)</th>
        </tr>
      </thead>
      <tbody>\${paidRows || \`<tr><td colspan="4" style="padding:16px; text-align:center; color:var(--hf-text-muted);">ไม่มีรายการ</td></tr>\`}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:8px; text-align:right; font-weight:700; border-top:2px solid var(--hf-brand-500);">รวมทั้งสิ้น</td>
          <td style="padding:8px; text-align:right; font-weight:700; border-top:2px solid var(--hf-brand-500); font-variant-numeric:tabular-nums; color:var(--hf-brand-500);">\${fmtAmount(total)}</td>
        </tr>
      </tfoot>
    </table>

    \${skippedSection}

    <div style="margin-top:24px; padding-top:12px; border-top:1px solid var(--hf-border); font-size:11px; color:var(--hf-text-muted); text-align:center;">
      สร้างโดยระบบ payroll-form &middot; \${generatedAt}
    </div>
  \`;

  return div;
}

document.getElementById("screenshot").addEventListener("click", async () => {
  clearMsg();
  const btn = document.getElementById("screenshot");
  btn.disabled = true;
  const prevText = btn.textContent;
  btn.textContent = "กำลังบันทึก…";
  let report = null;
  try {
    report = buildReportElement();
    document.body.appendChild(report);
    const canvas = await html2canvas(report, { backgroundColor: "#ffffff", scale: 2 });
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!blob) { showError("ไม่สามารถสร้างรายงานได้"); return; }
    const stamp = selectedDate
      ? \`\${pad(selectedDate.getDate())}-\${pad(selectedDate.getMonth() + 1)}-\${selectedDate.getFullYear() + 543}\`
      : new Date().toISOString().slice(0, 10);
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = \`KBIZPayrollReport-\${stamp}.jpg\`; a.click();
    URL.revokeObjectURL(url);
  } catch (e) {
    showError("บันทึกรายงานไม่สำเร็จ: " + (e && e.message ? e.message : e));
  } finally {
    if (report && report.parentNode) report.parentNode.removeChild(report);
    btn.disabled = false;
    btn.textContent = prevText;
  }
});

document.getElementById("submit").addEventListener("click", async () => {
  clearMsg();
  if (!selectedDate) { showError("กรุณาระบุวันที่เงินเข้าบัญชี"); return; }

  const rows = [];

  for (const tr of rosterTbody.querySelectorAll("tr[data-account-number]")) {
    const raw = tr.querySelector(".amt").value.trim();
    const amount = parseFloat(raw);
    if (raw === "" || Number.isNaN(amount) || amount <= 0) continue;
    rows.push({
      accountNumber: tr.dataset.accountNumber,
      accountName: tr.dataset.accountName,
      amount,
    });
  }

  if (rows.length === 0) { showError("กรุณาระบุจำนวนเงินอย่างน้อย 1 รายการ"); return; }

  const payload = { effectiveDate: formatGregorian(selectedDate), rows };
  const res = await fetch("/api/queue/transfer", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    showError("ส่งคำขอไม่สำเร็จ: " + res.status + " " + (await res.text()));
    return;
  }
  const req = await res.json();
  msgEl.className = "ok";
  msgEl.innerHTML =
    "✓ ส่งคำขออนุมัติแล้ว · ID: <code>" + req.id + "</code> · " +
    '<a href="/approvals">ตรวจสอบที่คิวอนุมัติ</a>';
});

loadRoster();
</script>
<!--HF_BAR-->
</body>
</html>`;
