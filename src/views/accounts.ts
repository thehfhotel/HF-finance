import { ZOOM_HTML } from "./zoom";

export const ACCOUNTS_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>จัดการบัญชี - KBIZ Payroll</title>
<style>
  :root { font: 14px/1.5 "Noto Sans Thai", system-ui, sans-serif; }
  body { max-width: 1000px; margin: 24px auto; padding: 0 16px; color: #1a1a1a; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; }
  h1 { font-size: 18px; margin: 0; flex: 1; }
  nav a { color: #1d4ed8; text-decoration: none; margin-left: 12px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid #ddd; padding: 12px 16px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 0 6px; color: #555; }
  input, button { font: inherit; padding: 6px 8px; box-sizing: border-box; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 6px 6px; text-align: left; border-bottom: 1px solid #f0f0f0; vertical-align: middle; }
  th { background: #f3f4f6; font-weight: 600; border-bottom: 1px solid #ddd; }
  td input { width: 100%; border: 1px solid #ccc; border-radius: 4px; }
  button { cursor: pointer; border: 1px solid #888; background: #fff; border-radius: 4px; }
  button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; }
  button.danger { color: #b91c1c; border-color: #ddd; }
  .err { color: #b91c1c; margin-top: 8px; }
  .ok { color: #047857; margin-top: 8px; }
  .acct { font-variant-numeric: tabular-nums; color: #374151; }
  .row-actions { white-space: nowrap; display: flex; gap: 6px; }
  .add-form { display: flex; gap: 8px; align-items: center; }
  .add-form input { padding: 6px 8px; }
  .empty { color: #9ca3af; padding: 8px; text-align: center; }
  .actions { margin-top: 12px; display: flex; gap: 12px; align-items: center; flex-wrap: wrap; }
  .hint { color: #6b7280; font-size: 13px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 12px; font-weight: 600; }
  .badge-ok { background: #d1fae5; color: #047857; }
  .badge-pending { background: #fef3c7; color: #92400e; }
  tr.registered td { color: #6b7280; }
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
  <div class="hint" id="syncMeta" style="margin-bottom:8px;"></div>
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
    meta.textContent = "ยังไม่เคยซิงค์สถานะ KBIZ — รัน 'npm run list' ใน kbiz-bot เพื่อดึงรายการบัญชีที่ลงทะเบียนแล้ว";
  }
  tbody.innerHTML = "";
  if (list.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="empty">ยังไม่มีบัญชี</td></tr>';
    return;
  }
  list.forEach((a, i) => tbody.appendChild(viewRow(a, i)));
}

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
</body>
</html>`;
