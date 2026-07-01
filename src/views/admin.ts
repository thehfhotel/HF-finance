// Admin nav + OTP-unlock modal. Injected into every page via placeholders:
//   <!--ADMIN_NAV-->     → either the two admin tabs (when unlocked) or an
//                         "Admin" button (when locked); in both cases also
//                         a small lock-out control when unlocked.
//   <!--ADMIN_MODAL-->   → modal markup + JS used to drive the unlock flow.
//                         Always rendered so JS can find the elements; when
//                         already unlocked the modal stays hidden.
//
// Server replaces these at request time — see renderHTML in src/index.ts.

export function adminNavHtml(currentPath: string, isAdmin: boolean): string {
  if (isAdmin) {
    const home = currentPath === "/" ? ' class="active"' : "";
    const approvals = currentPath === "/approvals" ? ' class="active"' : "";
    return [
      `<a href="/"${home}>สร้างไฟล์</a>`,
      `<a href="/approvals"${approvals}>คิวอนุมัติ</a>`,
      // The lock control matches nav-link styling so it sits inline with the rest.
      `<button type="button" id="adminLock" class="nav-btn" title="ออกจากโหมด admin">×</button>`,
    ].join("");
  }
  return `<button type="button" id="adminBtn" class="nav-btn">Admin</button>`;
}

export const ADMIN_MODAL_HTML = `
<style>
  /* Inline-link button style so the admin entry/lock controls sit flush
     with the nav <a>'s without giving away that they're <button>. */
  .nav-btn {
    color: var(--hf-brand-500); background: none; border: 0; padding: 0;
    margin-left: 14px; font: inherit; font-size: 15px; cursor: pointer;
  }
  .nav-btn:hover { text-decoration: underline; }
  #adminLock { font-size: 18px; line-height: 1; color: var(--hf-text-muted); }

  #adminDialog {
    border: 0; border-radius: 8px; padding: 20px; min-width: 320px;
    box-shadow: 0 8px 24px rgb(38 34 30 / 0.15);
  }
  #adminDialog::backdrop { background: rgba(38,34,30,0.4); }
  #adminDialog h3 { margin: 0 0 8px; }
  #adminDialog p { margin: 0 0 12px; color: var(--hf-text-muted); font-size: 14px; }
  #adminDialog input {
    width: 100%; padding: 8px 10px; font-size: 16px;
    border: 1px solid var(--hf-border-strong); border-radius: 4px; box-sizing: border-box;
  }
  #adminDialog .err { color: var(--hf-error); font-size: 13px; min-height: 18px; margin-top: 6px; }
  #adminDialog .actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 14px; }
  #adminDialog button {
    padding: 8px 14px; border: 1px solid var(--hf-border-strong); background: var(--hf-panel);
    border-radius: 4px; cursor: pointer; font-size: 14px;
  }
  #adminDialog button.primary { background: var(--hf-brand-500); color: #fff; border-color: var(--hf-brand-500); }
  #adminDialog button:disabled { opacity: 0.6; cursor: wait; }
</style>
<dialog id="adminDialog">
  <h3>เข้าโหมด admin</h3>
  <p id="adminStep1Text">กดปุ่มด้านล่างเพื่อส่ง OTP ไปยัง Slack</p>
  <input id="adminOtpInput" type="text" inputmode="numeric" pattern="\\d{6}" maxlength="6" autocomplete="off" placeholder="OTP 6 หลัก" hidden>
  <div class="err" id="adminErr"></div>
  <div class="actions">
    <button type="button" id="adminCancel">ยกเลิก</button>
    <button type="button" id="adminSend" class="primary">ส่ง OTP</button>
    <button type="button" id="adminVerify" class="primary" hidden>ยืนยัน</button>
  </div>
</dialog>
<script>
(() => {
  const btnOpen = document.getElementById("adminBtn");
  const btnLock = document.getElementById("adminLock");
  const dlg = document.getElementById("adminDialog");
  const txt = document.getElementById("adminStep1Text");
  const inp = document.getElementById("adminOtpInput");
  const err = document.getElementById("adminErr");
  const btnCancel = document.getElementById("adminCancel");
  const btnSend = document.getElementById("adminSend");
  const btnVerify = document.getElementById("adminVerify");
  let pendingToken = null;

  function reset() {
    pendingToken = null;
    err.textContent = "";
    inp.value = "";
    inp.hidden = true;
    txt.textContent = "กดปุ่มด้านล่างเพื่อส่ง OTP ไปยัง Slack";
    btnSend.hidden = false; btnSend.disabled = false;
    btnVerify.hidden = true; btnVerify.disabled = false;
  }

  if (btnOpen) {
    btnOpen.addEventListener("click", () => { reset(); dlg.showModal(); });
  }
  btnCancel.addEventListener("click", () => dlg.close());
  dlg.addEventListener("close", reset);

  btnSend.addEventListener("click", async () => {
    err.textContent = ""; btnSend.disabled = true;
    try {
      const res = await fetch("/api/admin/request-otp", { method: "POST" });
      if (!res.ok) { err.textContent = "ส่ง OTP ไม่สำเร็จ: " + (await res.text()); btnSend.disabled = false; return; }
      const { token } = await res.json();
      pendingToken = token;
      txt.textContent = "ระบบส่ง OTP ไปที่ Slack แล้ว ดู OTP จาก Slack แล้วกรอกที่นี่ (อายุ 5 นาที)";
      inp.hidden = false; inp.focus();
      btnSend.hidden = true;
      btnVerify.hidden = false;
    } catch (e) {
      err.textContent = String(e);
      btnSend.disabled = false;
    }
  });

  inp.addEventListener("keydown", (e) => { if (e.key === "Enter") btnVerify.click(); });
  inp.addEventListener("input", () => { err.textContent = ""; });

  btnVerify.addEventListener("click", async () => {
    const otp = inp.value.trim();
    if (!/^\\d{6}$/.test(otp)) { err.textContent = "OTP ต้องเป็นตัวเลข 6 หลัก"; return; }
    if (!pendingToken) { err.textContent = "กรุณาขอ OTP ใหม่"; return; }
    err.textContent = ""; btnVerify.disabled = true;
    try {
      const res = await fetch("/api/admin/unlock", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token: pendingToken, otp }),
      });
      if (!res.ok) {
        err.textContent = await res.text();
        btnVerify.disabled = false;
        return;
      }
      window.location.reload();
    } catch (e) {
      err.textContent = String(e);
      btnVerify.disabled = false;
    }
  });

  if (btnLock) {
    btnLock.addEventListener("click", async () => {
      await fetch("/api/admin/lock", { method: "POST" });
      // After lock the current page may no longer be reachable — bounce home.
      window.location.href = "/worksheet";
    });
  }
})();
</script>
`;
