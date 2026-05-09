// Per-page text/zoom buttons. Each page persists its own zoom level in
// localStorage, keyed by pathname. Inserted after the nav in each view.
export const ZOOM_HTML = `<div class="zoom-ctl" role="group" aria-label="ขนาดตัวอักษร" style="display:inline-flex; gap:4px; align-items:center; margin-left:14px;">
  <button type="button" id="zoomOut" title="ลดขนาด" style="width:28px; height:28px; padding:0; font-size:14px; line-height:1; cursor:pointer; border:1px solid #d1d5db; background:#fff; border-radius:4px; color:#374151;">A−</button>
  <button type="button" id="zoomReset" title="ขนาดมาตรฐาน" style="width:28px; height:28px; padding:0; font-size:14px; line-height:1; cursor:pointer; border:1px solid #d1d5db; background:#fff; border-radius:4px; color:#374151;">A</button>
  <button type="button" id="zoomIn" title="เพิ่มขนาด" style="width:28px; height:28px; padding:0; font-size:14px; line-height:1; cursor:pointer; border:1px solid #d1d5db; background:#fff; border-radius:4px; color:#374151;">A+</button>
  <span id="zoomLabel" style="color:#6b7280; font-size:12px; min-width:34px; text-align:right;">100%</span>
</div>
<script>
(function(){
  var KEY = "zoom:" + location.pathname;
  var label = document.getElementById("zoomLabel");
  function get() { var v = parseFloat(localStorage.getItem(KEY) || "1"); return isFinite(v) && v > 0 ? v : 1; }
  function set(v) {
    v = Math.round(Math.max(0.7, Math.min(1.6, v)) * 100) / 100;
    localStorage.setItem(KEY, String(v));
    document.documentElement.style.zoom = String(v);
    if (label) label.textContent = Math.round(v * 100) + "%";
  }
  set(get());
  document.getElementById("zoomOut").onclick = function(){ set(get() - 0.1); };
  document.getElementById("zoomReset").onclick = function(){ set(1); };
  document.getElementById("zoomIn").onclick = function(){ set(get() + 0.1); };
})();
</script>`;
