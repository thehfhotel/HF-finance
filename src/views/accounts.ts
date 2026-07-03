import { ZOOM_HTML } from "./zoom";

export const ACCOUNTS_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>จัดการบัญชี - KBIZ Payroll</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    font: 14px/1.5 "Sarabun", "Noto Sans Thai", system-ui, sans-serif;
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
  body { max-width: 1000px; margin: 24px auto; padding: 0 16px; color: var(--hf-text); }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; flex: 1; }
  nav a { color: var(--hf-brand-500); text-decoration: none; margin-left: 12px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid var(--hf-border); padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 0 6px; color: var(--hf-text-muted); }
  input, button { font: inherit; padding: 6px 8px; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 6px; text-align: left; border-bottom: 1px solid var(--hf-border); vertical-align: middle; }
  th { background: var(--hf-panel-tint); font-weight: 600; border-bottom: 1px solid var(--hf-border); }
  td input { width: 100%; border: 1px solid var(--hf-border-strong); border-radius: 4px; }
  button { cursor: pointer; border: 1px solid var(--hf-border-strong); background: var(--hf-panel); border-radius: 4px; }
  button.primary { background: var(--hf-brand-500); color: var(--hf-panel); border-color: var(--hf-brand-500); }
  button.danger { color: var(--hf-error); border-color: var(--hf-border); }
  .err { color: var(--hf-error); margin-top: 8px; }
  .ok { color: var(--hf-success); margin-top: 8px; }
  .acct { font-variant-numeric: tabular-nums; color: var(--hf-text); }
  .row-actions { white-space: nowrap; display: flex; gap: 6px; }
  .add-form { display: flex; gap: 8px; align-items: center; }
  .add-form input { padding: 6px 8px; }
  .empty { color: var(--hf-text-muted); padding: 8px; text-align: center; }
  .actions { margin-top: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .hint { color: var(--hf-text-muted); font-size: 13px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
  .badge-ok { background: color-mix(in srgb, var(--hf-success) 15%, white); color: var(--hf-success); }
  .badge-pending { background: color-mix(in srgb, var(--hf-warning) 18%, white); color: var(--hf-warning); }
  tr.registered td { color: var(--hf-text-muted); }
  tr.registered td input.select { opacity: 0.4; }
</style>
</head>
<body>
<header>
  <h1>จัดการบัญชี</h1>
  <nav>
    <a href="/worksheet">คำนวณเงินเดือน</a>
    <a href="/accounts" class="active">จัดการบัญชี</a>
    <a href="/status">สถานะคำขอ</a>
    <!--ADMIN_NAV-->
  </nav>
  ${ZOOM_HTML}
</header>
<!--ADMIN_MODAL-->

<fieldset>
  <legend>เพิ่มบัญชีใหม่</legend>
  <div class="add-form">
    <input id="newAccountNumber" type="text" inputmode="numeric" placeholder="เลขบัญชี (10 หลัก หรือใส่ขีดได้)" style="flex:1">
    <input id="newAccountName" type="text" placeholder="ชื่อบัญชี" style="flex:2">
    <button type="button" id="addBtn" class="primary">เพิ่ม</button>
  </div>
  <div id="addMsg"></div>
</fieldset>

<fieldset>
  <legend>บัญชีทั้งหมด</legend>
  <div style="display:flex; align-items:center; gap:10px; margin-bottom:8px; flex-wrap:wrap;">
    <div class="hint" id="syncMeta"></div>
    <button type="button" id="syncBtn" style="padding:3px 10px; font-size:0.85em;">⟳ ซิงค์สถานะ KBIZ</button>
  </div>
  <table>
    <thead>
      <tr>
        <th style="width:40px"><input type="checkbox" id="selectAll"></th>
        <th style="width:48px">#</th>
        <th style="width:23%">เลขบัญชี</th>
        <th>ชื่อบัญชี</th>
        <th style="width:120px">สถานะ KBIZ</th>
        <th style="width:160px"></th>
      </tr>
    </thead>
    <tbody id="accountsBody"></tbody>
  </table>
  <div class="actions">
    <button type="button" id="submitAddPayroll" class="primary">ส่งคำขออนุมัติเพิ่มบัญชี</button>
    <span class="hint">ติ๊กเฉพาะบัญชีที่ <em>ยังไม่ได้ลงทะเบียน</em> — ผู้อนุมัติจะตรวจสอบที่ <a href="/approvals">คิวอนุมัติ</a> ก่อนส่งให้ KBIZ</span>
  </div>
  <div id="listMsg"></div>
</fieldset>

<script>
const tbody = document.getElementById("accountsBody");
const addMsg = document.getElementById("addMsg");
const listMsg = document.getElementById("listMsg");

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}

function formatAccount(n) {
  const s = String(n).replace(/[^0-9]/g, "");
  if (s.length === 10) return s.slice(0, 3) + "-" + s.slice(3, 4) + "-" + s.slice(4, 9) + "-" + s.slice(9);
  return s;
}

function setMsg(el, text, kind) {
  el.className = kind ?? "";
  el.textContent = text ?? "";
}

function normalize(n) { return n.replace(/[\\s-]/g, ""); }

function viewRow(a, idx) {
  const tr = document.createElement("tr");
  tr.dataset.id = a.id;
  tr.dataset.accountNumber = a.accountNumber;
  tr.dataset.accountName = a.accountName;
  if (a.registered) tr.classList.add("registered");
  tr.dataset.registered = a.registered ? "1" : "0";
  const statusBadge = a.registered
    ? '<span class="badge badge-ok">ลงทะเบียนแล้ว</span>'
    : '<span class="badge badge-pending">ยังไม่ลง</span>';
  tr.innerHTML = \`
    <td><input type="checkbox" class="select"\${a.registered ? "" : ""}></td>
    <td>\${idx + 1}</td>
    <td class="acct">\${escapeHtml(formatAccount(a.accountNumber))}</td>
    <td>\${escapeHtml(a.accountName)}</td>
    <td>\${statusBadge}</td>
    <td class="row-actions">
      <button type="button" class="edit">แก้ไข</button>
      <button type="button" class="danger del">ลบ</button>
    </td>\`;
  tr.querySelector(".edit").addEventListener("click", () => editRow(tr, a));
  tr.querySelector(".del").addEventListener("click", () => delRow(a));
  return tr;
}

function editRow(tr, a) {
  tr.innerHTML = \`
    <td></td>
    <td>—</td>
    <td><input class="acct-in" type="text" value="\${escapeHtml(formatAccount(a.accountNumber))}"></td>
    <td><input class="name-in" type="text" value="\${escapeHtml(a.accountName)}"></td>
    <td></td>
    <td class="row-actions">
      <button type="button" class="primary save">บันทึก</button>
      <button type="button" class="cancel">ยกเลิก</button>
    </td>\`;
  tr.querySelector(".save").addEventListener("click", async () => {
    const accountNumber = normalize(tr.querySelector(".acct-in").value);
    const accountName = tr.querySelector(".name-in").value.trim();
    if (!/^\\d{6,20}$/.test(accountNumber)) { setMsg(listMsg, "เลขบัญชีต้องเป็นตัวเลข 6-20 หลัก", "err"); return; }
    if (!accountName) { setMsg(listMsg, "กรุณากรอกชื่อบัญชี", "err"); return; }
    const res = await fetch(\`/api/accounts/\${a.id}\`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ accountNumber, accountName }),
    });
    if (!res.ok) { setMsg(listMsg, "บันทึกไม่สำเร็จ: " + (await res.text()), "err"); return; }
    setMsg(listMsg, "บันทึกแล้ว", "ok");
    await refresh();
  });
  tr.querySelector(".cancel").addEventListener("click", refresh);
}

async function delRow(a) {
  if (!confirm(\`ลบบัญชี "\${a.accountName}" ใช่ไหม?\`)) return;
  const res = await fetch(\`/api/accounts/\${a.id}\`, { method: "DELETE" });
  if (!res.ok) { setMsg(listMsg, "ลบไม่สำเร็จ: " + (await res.text()), "err"); return; }
  setMsg(listMsg, "ลบแล้ว", "ok");
  await refresh();
}

async function refresh() {
  setMsg(listMsg, "");
  const [accountsRes, regRes] = await Promise.all([fetch("/api/accounts"), fetch("/api/registered")]);
  if (!accountsRes.ok) { setMsg(listMsg, "โหลดข้อมูลไม่สำเร็จ", "err"); return; }
  const list = await accountsRes.json();
  const reg = regRes.ok ? await regRes.json() : { fetchedAt: null, count: 0 };
  const meta = document.getElementById("syncMeta");
  if (reg.fetchedAt) {
    const d = new Date(reg.fetchedAt);
    const stamp = \`\${String(d.getDate()).padStart(2,"0")}/\${String(d.getMonth()+1).padStart(2,"0")}/\${d.getFullYear()+543} \${String(d.getHours()).padStart(2,"0")}:\${String(d.getMinutes()).padStart(2,"0")}\`;
    meta.textContent = \`อัปเดตสถานะ KBIZ ล่าสุด: \${stamp} · ลงทะเบียนแล้ว \${reg.count} บัญชี\`;
  } else {
    meta.textContent = "ยังไม่เคยซิงค์สถานะ KBIZ — กดปุ่มซิงค์เพื่อดึงรายการบัญชีที่ลงทะเบียนแล้ว";
  }
  tbody.innerHTML = "";
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">ยังไม่มีบัญชี</td></tr>';
    return;
  }
  list.forEach((a, i) => tbody.appendChild(viewRow(a, i)));
}

// Sync = enqueue a read-only "list-registered" job (born approved, no OTP),
// then poll the open single-item GET until the bot finishes. The bot polls
// the queue every 30s and the scrape takes ~1min, so allow a few minutes.
const syncBtn = document.getElementById("syncBtn");
syncBtn.addEventListener("click", async () => {
  syncBtn.disabled = true;
  const orig = syncBtn.textContent;
  syncBtn.textContent = "กำลังซิงค์…";
  setMsg(listMsg, "");
  try {
    const res = await fetch("/api/queue/sync-registered", { method: "POST" });
    if (!res.ok) throw new Error(await res.text());
    const req = await res.json();
    const deadline = Date.now() + 5 * 60_000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      const qr = await fetch(\`/api/queue/\${req.id}\`);
      if (!qr.ok) continue;
      const q = await qr.json();
      if (q.status === "done") {
        setMsg(listMsg, "ซิงค์สถานะ KBIZ สำเร็จ", "ok");
        await refresh();
        return;
      }
      if (q.status === "failed") {
        setMsg(listMsg, "ซิงค์ไม่สำเร็จ: " + ((q.result && q.result.error) || "ไม่ทราบสาเหตุ"), "err");
        return;
      }
    }
    setMsg(listMsg, "ซิงค์ยังไม่เสร็จ — ดูความคืบหน้าได้ที่หน้า สถานะ", "err");
  } catch (e) {
    setMsg(listMsg, "ซิงค์ไม่สำเร็จ: " + e.message, "err");
  } finally {
    syncBtn.disabled = false;
    syncBtn.textContent = orig;
  }
});

document.getElementById("addBtn").addEventListener("click", async () => {
  setMsg(addMsg, "");
  const accountNumber = normalize(document.getElementById("newAccountNumber").value);
  const accountName = document.getElementById("newAccountName").value.trim();
  if (!/^\\d{6,20}$/.test(accountNumber)) { setMsg(addMsg, "เลขบัญชีต้องเป็นตัวเลข 6-20 หลัก", "err"); return; }
  if (!accountName) { setMsg(addMsg, "กรุณากรอกชื่อบัญชี", "err"); return; }
  const res = await fetch("/api/accounts", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountNumber, accountName }),
  });
  if (!res.ok) { setMsg(addMsg, "เพิ่มไม่สำเร็จ: " + (await res.text()), "err"); return; }
  setMsg(addMsg, "เพิ่มแล้ว", "ok");
  document.getElementById("newAccountNumber").value = "";
  document.getElementById("newAccountName").value = "";
  await refresh();
});

document.getElementById("selectAll").addEventListener("change", (e) => {
  const checked = e.target.checked;
  // Select-all only ticks unregistered accounts (skipping the already-registered ones)
  for (const tr of tbody.querySelectorAll("tr[data-id]")) {
    const cb = tr.querySelector("input.select");
    if (!cb) continue;
    if (tr.dataset.registered === "1") cb.checked = false;
    else cb.checked = checked;
  }
});

document.getElementById("submitAddPayroll").addEventListener("click", async () => {
  setMsg(listMsg, "");
  const accounts = [];
  for (const tr of tbody.querySelectorAll("tr[data-id]")) {
    const cb = tr.querySelector("input.select");
    if (!cb || !cb.checked) continue;
    accounts.push({
      accountNumber: tr.dataset.accountNumber,
      accountName: tr.dataset.accountName,
    });
  }
  if (accounts.length === 0) {
    setMsg(listMsg, "กรุณาติ๊กบัญชีอย่างน้อย 1 รายการ", "err");
    return;
  }
  const res = await fetch("/api/queue/add-payroll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ accounts }),
  });
  if (!res.ok) {
    setMsg(listMsg, "ส่งคำขอไม่สำเร็จ: " + (await res.text()), "err");
    return;
  }
  const req = await res.json();
  listMsg.className = "ok";
  listMsg.innerHTML =
    "✓ ส่งคำขออนุมัติแล้ว · ID: <code>" + req.id + "</code> · " +
    '<a href="/approvals">ตรวจสอบที่คิวอนุมัติ</a>';
});

refresh();
</script>
<script defer src="https://erp.thehfhotel.org/shell/hf-bar.js" data-app="Payroll" data-module="finance"></script>
</body>
</html>`;
