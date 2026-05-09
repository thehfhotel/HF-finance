import { ZOOM_HTML } from "./zoom";

export const WORKSHEET_HTML = `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>คำนวณเงินเดือน</title>
<link rel="stylesheet" href="/static/flatpickr.css">
<style>
  :root { font: 16px/1.5 "Noto Sans Thai", system-ui, sans-serif; }
  body { max-width: 1900px; margin: 20px auto; padding: 0 16px; color: #1a1a1a; }
  header { display: flex; align-items: center; gap: 16px; margin-bottom: 16px; flex-wrap: wrap; }
  h1 { font-size: 22px; margin: 0; flex: 1; }
  nav a { color: #1d4ed8; text-decoration: none; margin-left: 14px; font-size: 15px; }
  nav a.active { font-weight: 600; }
  fieldset { border: 1px solid #d1d5db; padding: 14px 16px; margin: 0 0 16px; border-radius: 6px; }
  legend { padding: 4px 12px; color: #111827; background: #fff; font-size: 16px; font-weight: 700; border-radius: 4px; }
  label { font-size: 14px; color: #374151; }
  input, select, button, textarea { font: inherit; padding: 6px 9px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 4px; background: #fff; }
  textarea { width: 100%; min-height: 90px; resize: vertical; }
  button { cursor: pointer; }
  button.primary { background: #1d4ed8; color: #fff; border-color: #1d4ed8; padding: 8px 16px; }
  button.primary:disabled { background: #9ca3af; border-color: #9ca3af; cursor: not-allowed; }
  .top-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .top-row > div { display: flex; align-items: center; gap: 8px; }
  #effectiveDate { width: 200px; font-variant-numeric: tabular-nums; }
  #periodSelect { font-variant-numeric: tabular-nums; }
  .top-total { font-size: 18px; font-weight: 600; color: #111827; }
  .top-total strong { color: #1d4ed8; font-variant-numeric: tabular-nums; }
  .save-state { font-size: 13px; color: #6b7280; min-width: 120px; }
  .save-state.saving { color: #b45309; }
  .save-state.saved { color: #047857; }
  .save-state.failed { color: #b91c1c; }

  .table-zone { position: relative; }
  .table-wrap { overflow-x: auto; border: 1px solid #e5e7eb; border-radius: 6px; scroll-behavior: smooth; }
  .scroll-btn { position: absolute; top: 50%; transform: translateY(-50%); z-index: 5;
    width: 48px; height: 68px; border-radius: 6px; border: 1px solid #d1d5db;
    background: rgba(255,255,255,0.96);
    box-shadow: 0 2px 12px rgba(0,0,0,0.18); cursor: pointer;
    font-size: 28px; line-height: 1; color: #1f2937; user-select: none;
    padding: 0; transition: opacity 0.15s; }
  .scroll-btn:hover:not(:disabled) { background: #f3f4f6; }
  .scroll-btn:disabled { opacity: 0.2; cursor: default; pointer-events: none; }
  .scroll-btn .lbl { display: block; font-size: 10px; font-weight: 600; color: #6b7280; margin-top: 2px; }
  .scroll-btn.left { left: var(--pinned-w, 220px); }
  .scroll-btn.right { right: 6px; }

  /* Sticky left columns (roster info: idx, name, account, nickname, position).
     The actual left offset is set per-cell by JS after measuring header widths. */
  table.sheet th.sticky-l, table.sheet td.sticky-l {
    position: sticky; z-index: 1;
  }
  table.sheet thead th.sticky-l { z-index: 3; background: #f3f4f6; }
  table.sheet tbody td.sticky-l { background: #fff; }
  table.sheet tfoot td.sticky-l { background: #f9fafb; }
  table.sheet tbody tr:hover td.sticky-l { background: #fafafa; }
  /* Visual separator on the last pinned column */
  table.sheet th.sticky-l-last, table.sheet td.sticky-l-last {
    box-shadow: 4px 0 6px -3px rgba(0,0,0,0.12);
  }

  /* Account-cell badges. Verified shows inline at the end (green ✓);
     warn shows absolute at the top-right (amber pill for non-KBANK). */
  .row-badge {
    position: absolute; top: 2px; right: 4px;
    font-size: 9px; line-height: 1;
    padding: 2px 5px; border-radius: 3px;
    pointer-events: none; white-space: nowrap;
    font-weight: 600;
  }
  .row-badge.warn { background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; }
  .acct-check { color: #047857; font-weight: 700; font-size: 14px; margin-left: 6px; }
  .acct-edit-wrap { display: flex; align-items: center; gap: 4px; }
  .acct-edit-wrap input { flex: 1; min-width: 0; }
  .acct-edit-wrap input.bank-input { flex: 0 0 70px; text-transform: uppercase; }

  /* Inline delete button + drag handle in the idx cell (unlocked mode only) */
  .idx-del { width: 22px; height: 22px; padding: 0; font-size: 12px; line-height: 1;
    margin-left: 4px; border: 1px solid #fca5a5; background: #fff; color: #b91c1c;
    border-radius: 3px; cursor: pointer; vertical-align: middle; }
  .idx-del:hover { background: #fee2e2; }
  .drag-handle { display: inline-block; cursor: grab; color: #9ca3af; padding: 0 3px; user-select: none; vertical-align: middle; font-size: 14px; }
  .drag-handle:hover { color: #1f2937; }
  .drag-handle:active { cursor: grabbing; }
  table.sheet tbody tr.dragging > td { opacity: 0.4; }
  table.sheet tbody tr.drop-above > td { box-shadow: inset 0 2px 0 #1d4ed8; }
  table.sheet tbody tr.drop-below > td { box-shadow: inset 0 -2px 0 #1d4ed8; }
  table.sheet { border-collapse: separate; border-spacing: 0; min-width: 2200px; font-size: 14px; }
  table.sheet th, table.sheet td { padding: 4px 6px; border-bottom: 1px solid #e5e7eb; border-right: 1px solid #e5e7eb; vertical-align: middle; white-space: nowrap; }
  table.sheet thead th { background: #f3f4f6; font-weight: 600; border-bottom: 1px solid #d1d5db; position: sticky; top: 0; z-index: 2; font-size: 12px; }
  table.sheet thead th .hint { display: block; color: #9ca3af; font-weight: 400; font-size: 11px; }
  table.sheet th.deduct, table.sheet td.deduct { background: #fff7ed; }
  table.sheet th.add, table.sheet td.add { background: #ecfdf5; }
  table.sheet th.calc, table.sheet td.calc { background: #eff6ff; font-weight: 600; }
  table.sheet td input.num { width: 100px; text-align: right; font-variant-numeric: tabular-nums; padding: 4px 6px; }
  table.sheet td input[type="text"].note { width: 220px; }
  table.sheet td input.sm-text { width: 100%; padding: 4px 6px; min-width: 50px; }
  /* Blend inputs into the table background; only reveal borders on focus. */
  table.sheet td input.num,
  table.sheet td input.sm-text,
  table.sheet td input.note {
    border: 1px solid transparent;
    background: transparent;
    border-radius: 3px;
    transition: background-color 80ms, border-color 80ms;
  }
  table.sheet td input.num:hover,
  table.sheet td input.sm-text:hover,
  table.sheet td input.note:hover { background: rgba(255,255,255,0.6); border-color: #e5e7eb; }
  table.sheet td input.num:focus,
  table.sheet td input.sm-text:focus,
  table.sheet td input.note:focus {
    border-color: #93c5fd;
    background: #fff;
    outline: none;
    box-shadow: 0 0 0 2px rgba(147,197,253,0.45);
  }
  table.sheet td.calc { font-variant-numeric: tabular-nums; text-align: right; padding-right: 10px; }
  table.sheet td.idx { text-align: center; color: #6b7280; }
  table.sheet td.name { font-weight: 500; min-width: 180px; }
  table.sheet td.acct { font-variant-numeric: tabular-nums; color: #6b7280; font-size: 12px; }
  table.sheet tbody tr:hover td:not(.calc) { background: #fafafa; }
  table.sheet tbody tr:hover td.deduct { background: #fff1e0; }
  table.sheet tbody tr:hover td.add { background: #defcef; }
  table.sheet tfoot td { background: #f9fafb; font-weight: 700; border-top: 2px solid #d1d5db; padding-top: 8px; padding-bottom: 8px; text-align: right; font-variant-numeric: tabular-nums; }
  table.sheet tfoot td.label { text-align: right; color: #374151; }

  /* Hide number spinners */
  input[type="number"]::-webkit-outer-spin-button,
  input[type="number"]::-webkit-inner-spin-button { -webkit-appearance: none; appearance: none; margin: 0; }
  input[type="number"] { -moz-appearance: textfield; appearance: textfield; }

  .err { color: #b91c1c; margin-top: 8px; white-space: pre-wrap; }
  .ok { color: #047857; margin-top: 8px; }
  .actions { margin-top: 14px; display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .flatpickr-current-month .cur-year { font-weight: 600; }

  /* Lock-mode controls */
  #lockToggle { font-size: 13px; padding: 6px 12px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; white-space: nowrap; }
  #lockToggle.unlocked { background: #fef3c7; border-color: #f59e0b; color: #92400e; }
  #lockToggle:hover { background: #f3f4f6; }
  #lockToggle.unlocked:hover { background: #fde68a; }

  /* Add-row button (visible only when unlocked) */
  #addRowBox { margin-top: 10px; }

  /* Hidden frozen columns */
  table.sheet th.hidden-col, table.sheet td.hidden-col { display: none; }

  /* Column-visibility menu */
  #colsBox { position: relative; display: inline-block; }
  #colsBtn { font-size: 13px; padding: 6px 10px; border: 1px solid #d1d5db; border-radius: 4px; background: #fff; cursor: pointer; white-space: nowrap; }
  #colsBtn:hover { background: #f3f4f6; }
  #colsMenu { position: absolute; top: calc(100% + 4px); right: 0; min-width: 200px; background: #fff; border: 1px solid #d1d5db; border-radius: 6px; box-shadow: 0 4px 12px rgba(0,0,0,0.12); padding: 8px 4px; z-index: 20; }
  #colsMenu label { display: flex; align-items: center; gap: 8px; padding: 6px 10px; cursor: pointer; font-size: 14px; border-radius: 3px; }
  #colsMenu label:hover { background: #f3f4f6; }
  #colsMenu input[type="checkbox"] { margin: 0; }
  #colsMenu .menu-title { font-size: 11px; color: #6b7280; padding: 2px 10px 6px; border-bottom: 1px solid #e5e7eb; margin-bottom: 4px; }
  #addRow { padding: 8px 14px; border: 1px dashed #9ca3af; background: #fff; border-radius: 4px; cursor: pointer; color: #374151; font-size: 14px; }
  #addRow:hover { background: #f3f4f6; border-color: #6b7280; }

  /* History panel — small one-liner above the worksheet showing how many
     queue submissions exist for the currently-selected period. */
  #historyPanel {
    display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px;
    background: #fef3c7; border: 1px solid #f59e0b; border-radius: 4px;
    font-size: 13px; color: #78350f;
  }
  #historyPanel a { color: #1d4ed8; text-decoration: none; font-weight: 600; }
  #historyPanel a:hover { text-decoration: underline; }

  /* Report (PDF) view. Built on demand into #reportRoot, hidden on screen,
     swapped for the editable view in @media print. Two modes:
       - cards    → per-employee compact cards, A4 portrait (default)
       - table    → single-page summary table, A4 landscape
     The mode is selected by the body class set at print time. */
  /* Report styling lives OUTSIDE @media print so off-screen measurements
     in JS (display:block + visibility:hidden) get the same layout the
     print engine will use. The screen render is hidden via #reportRoot
     { display:none }; @media print flips that on plus adds @page rules. */
  #reportRoot { display: none; font: 9pt/1.4 "Noto Sans Thai", sans-serif; color: #0a0a0a; }

  #reportRoot .report-header {
    margin-bottom: 5mm; padding-bottom: 2.5mm;
    border-bottom: 0.5pt solid #404040;
  }
  #reportRoot .report-header h1 { font-size: 14pt; font-weight: 600; margin: 0 0 1mm; color: #0a0a0a; }
  #reportRoot .report-meta { font-size: 8.5pt; color: #404040; }
  #reportRoot .report-meta strong { color: #0a0a0a; font-weight: 500; margin-right: 1.5mm; }

  /* ── Pay-slip mode (A4 portrait, bilingual TH/EN) ───────────────────── */
  /* Mirrors the company's official สลิปเงินเดือน / Pay Slip Excel layout:
     header band → employee info → two-column earnings/deductions table →
     net-pay strip → signature lines. Each slip is page-break-inside:avoid
     and has a tuned min-height so two slips fit per A4 portrait page. */
  #reportRoot.mode-cards { font: 9pt/1.35 "Noto Sans Thai", sans-serif; color: #0a0a0a; }
  #reportRoot .pay-slip {
    border: 0.6pt solid #404040;
    padding: 4mm 5mm 3mm;
    margin-bottom: 4mm;
    page-break-inside: avoid; break-inside: avoid;
    min-height: 128mm;
    display: flex; flex-direction: column;
  }
  #reportRoot .pay-slip + .pay-slip { margin-top: 0; }
  #reportRoot .slip-header {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 6mm; padding-bottom: 2mm; margin-bottom: 2.5mm;
    border-bottom: 0.4pt solid #404040;
  }
  #reportRoot .slip-company .name-th { font-size: 12pt; font-weight: 700; color: #0a0a0a; }
  #reportRoot .slip-company .name-en { font-size: 9pt; font-weight: 600; color: #404040; letter-spacing: 0.03em; }
  #reportRoot .slip-company .addr { font-size: 8pt; color: #525252; margin-top: 0.5mm; }
  #reportRoot .slip-company .tax { font-size: 8pt; color: #525252; }
  #reportRoot .slip-title { text-align: right; flex-shrink: 0; }
  #reportRoot .slip-title .th { font-size: 13pt; font-weight: 700; color: #0a0a0a; letter-spacing: 0.04em; }
  #reportRoot .slip-title .en { font-size: 9.5pt; font-weight: 600; color: #404040; letter-spacing: 0.06em; }

  #reportRoot .slip-emp {
    display: grid; grid-template-columns: 1fr 1fr;
    gap: 0.8mm 6mm; margin-bottom: 2.5mm;
  }
  #reportRoot .slip-emp .field { display: flex; gap: 2mm; font-size: 8.5pt; align-items: baseline; }
  #reportRoot .slip-emp .lbl { color: #525252; min-width: 26mm; }
  #reportRoot .slip-emp .lbl .en { color: #737373; font-size: 7.5pt; }
  #reportRoot .slip-emp .val { color: #0a0a0a; font-weight: 500; flex: 1;
    border-bottom: 0.25pt solid #d4d4d4; padding-bottom: 0.3mm;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  #reportRoot .slip-emp .val.acct { font-variant-numeric: tabular-nums; }

  #reportRoot .slip-table { width: 100%; border-collapse: collapse; margin-bottom: 2mm; }
  #reportRoot .slip-table th, #reportRoot .slip-table td {
    border: 0.3pt solid #a3a3a3; padding: 0.8mm 2mm;
    font-size: 8.5pt; vertical-align: middle;
  }
  #reportRoot .slip-table thead th {
    background: #f3f4f6; font-weight: 700; color: #0a0a0a; text-align: left;
    font-size: 8.7pt;
  }
  #reportRoot .slip-table thead th .en { color: #525252; font-weight: 500; font-size: 7.5pt; margin-left: 1.5mm; }
  #reportRoot .slip-table thead th.amt-col { width: 22mm; text-align: right; }
  #reportRoot .slip-table td.lbl { color: #404040; }
  #reportRoot .slip-table td.lbl .en { color: #737373; font-size: 7.5pt; margin-left: 1mm; }
  #reportRoot .slip-table td.amt {
    text-align: right; font-variant-numeric: tabular-nums; color: #0a0a0a;
    width: 22mm;
  }
  #reportRoot .slip-table td.amt.zero { color: #cbd5e1; }
  #reportRoot .slip-table tfoot td {
    background: #f9fafb; font-weight: 700; color: #0a0a0a;
    border-top: 0.6pt solid #404040;
  }

  #reportRoot .slip-net {
    display: flex; justify-content: space-between; align-items: baseline;
    padding: 1.5mm 3mm; margin: 1mm 0 2.5mm;
    background: #1d4ed8; color: #fff;
    border-radius: 0.5mm;
  }
  #reportRoot .slip-net .label { font-size: 10pt; font-weight: 700; letter-spacing: 0.04em; }
  #reportRoot .slip-net .label .en { font-weight: 500; opacity: 0.85; margin-left: 1.5mm; font-size: 8.5pt; }
  #reportRoot .slip-net .amt { font-size: 14pt; font-weight: 700; font-variant-numeric: tabular-nums; }
  #reportRoot .slip-net .amt .baht { font-size: 9pt; font-weight: 500; opacity: 0.85; margin-left: 1mm; }

  #reportRoot .slip-note {
    font-size: 7.8pt; color: #525252; padding: 1mm 1mm 1.5mm;
    border-bottom: 0.2pt dashed #d4d4d4; margin-bottom: 2mm;
    white-space: pre-wrap; word-break: break-word;
  }
  #reportRoot .slip-note strong { color: #0a0a0a; font-weight: 600; }

  #reportRoot .slip-sigs {
    display: flex; gap: 8mm; margin-top: auto; padding-top: 4mm;
    justify-content: space-around;
  }
  #reportRoot .slip-sigs .sig { flex: 1; max-width: 60mm; text-align: center; }
  #reportRoot .slip-sigs .sig .line {
    border-top: 0.3pt solid #404040;
    padding-top: 1mm; margin-top: 6mm;
    font-size: 8.5pt; color: #404040; font-weight: 600;
  }
  #reportRoot .slip-sigs .sig .line .en { color: #737373; font-weight: 500; font-size: 7.5pt; margin-left: 1.5mm; }
  #reportRoot .slip-sigs .sig .name { font-size: 8pt; color: #525252; margin-top: 0.5mm; }

  /* ── Table mode (A4 landscape, fit-on-one-page summary) ─────────────── */
  /* Visual structure mirrors the editable worksheet — 3-row header with
     grouped columns and the same color-coded backgrounds. */
  #reportRoot.mode-table { font: 7.5pt/1.2 "Noto Sans Thai", sans-serif; }
  #reportRoot.mode-table .report-header { margin-bottom: 2mm; padding-bottom: 1.5mm; border-bottom: 0.5pt solid #404040; }
  #reportRoot.mode-table .report-header h1 { font-size: 11pt; margin: 0 0 0.5mm; font-weight: 600; }
  #reportRoot.mode-table .report-meta { font-size: 7pt; color: #404040; }
  #reportRoot.mode-table .report-meta strong { color: #0a0a0a; font-weight: 500; margin-right: 1mm; }
  #reportRoot.mode-table table { width: 100%; border-collapse: collapse; table-layout: fixed; font-variant-numeric: tabular-nums; }
  #reportRoot.mode-table th,
  #reportRoot.mode-table td {
    border: 0.25pt solid #d4d4d4;
    padding: 0.6mm 1mm; text-align: right;
    vertical-align: middle;
  }
  #reportRoot.mode-table thead th {
    background: #f3f4f6; font-weight: 600; color: #1f2937;
    font-size: 6.4pt; line-height: 1.1; text-align: center;
  }
  #reportRoot.mode-table thead th .hint { display: block; color: #9ca3af; font-weight: 400; font-size: 5.8pt; }
  /* Column-group backgrounds — match the worksheet palette. */
  #reportRoot.mode-table th.deduct, #reportRoot.mode-table td.deduct { background: #fff7ed; }
  #reportRoot.mode-table th.add,    #reportRoot.mode-table td.add    { background: #ecfdf5; }
  #reportRoot.mode-table th.calc,   #reportRoot.mode-table td.calc   { background: #eff6ff; font-weight: 600; }
  #reportRoot.mode-table thead th.frozen { background: #f3f4f6; }
  #reportRoot.mode-table tbody td.frozen { background: #ffffff; }
  #reportRoot.mode-table tfoot td.frozen { background: #f9fafb; }
  #reportRoot.mode-table td.text { text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  #reportRoot.mode-table td.idx { text-align: center; color: #737373; font-size: 6.5pt; }
  #reportRoot.mode-table td.acct {
    text-align: left; font-family: ui-monospace, SFMono-Regular, monospace;
    font-size: 6.6pt; color: #404040;
  }
  #reportRoot.mode-table td.zero { color: #cbd5e1; }
  #reportRoot.mode-table tfoot td { font-weight: 700; border-top: 0.6pt solid #404040; }
  #reportRoot.mode-table .table-summary {
    margin-top: 3mm; padding-top: 2mm; border-top: 0.5pt solid #d4d4d4;
    display: flex; gap: 8mm; font-size: 8pt; color: #404040; align-items: baseline;
  }
  #reportRoot.mode-table .table-summary strong { color: #0a0a0a; font-weight: 600; margin-right: 1mm; }
  #reportRoot.mode-table .table-summary .grand { margin-left: auto; font-size: 12pt; font-weight: 700; color: #0a0a0a; }
  #reportRoot.mode-table .table-notes { margin-top: 2mm; font-size: 7.5pt; color: #404040; white-space: pre-wrap; }
  #reportRoot.mode-table .table-notes strong { font-weight: 600; color: #0a0a0a; }

  @media print {
    /* Print backgrounds + tints regardless of "Background graphics" toggle. */
    body, #reportRoot, #reportRoot * {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
      color-adjust: exact !important;
    }

    @page portrait-page { size: A4 portrait; margin: 14mm 14mm 16mm 14mm; @bottom-right { content: counter(page) " / " counter(pages); font: 8pt "Noto Sans Thai", sans-serif; color: #737373; } }
    /* Landscape: minimal CSS margin — let the printer's own non-printable
       area act as the white border. This buys back ~10mm of vertical
       space which keeps the summary band from spilling onto a 2nd page. */
    @page landscape-page { size: A4 landscape; margin: 3mm; }
    body.print-cards { page: portrait-page; }
    body.print-table { page: landscape-page; }
    body { page: portrait-page; max-width: none; margin: 0; padding: 0; color: #0a0a0a; background: #fff; }
    body > * { display: none !important; }
    body > #reportRoot { display: block !important; }

    /* Optional uniform shrink for overflow case (table mode). JS sets
       --print-scale; default 1. Width matches the new usable area
       (297mm - 2×3mm @page margin = 291mm). */
    body.print-table #reportRoot {
      transform: scale(var(--print-scale, 1));
      transform-origin: top left;
      width: calc(291mm / var(--print-scale, 1));
    }
  }

  /* Past-month banner — appears when the selected period is older than
     the cutoff (4th of the following month). Two states: "locked"
     (read-only by default) and "unlocked" (operator override active). */
  .past-banner {
    display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
    padding: 10px 14px; margin-bottom: 12px; border-radius: 6px;
    font-size: 14px;
  }
  .past-banner[hidden] { display: none; }
  .past-banner.locked { background: #f3f4f6; border: 1px solid #d1d5db; color: #374151; }
  .past-banner.unlocked { background: #fef3c7; border: 1px solid #f59e0b; color: #78350f; }
  .past-banner .hint { color: #6b7280; font-size: 12px; }
  .past-banner button {
    margin-left: auto; padding: 6px 14px; border: 1px solid #1d4ed8;
    background: #1d4ed8; color: #fff; border-radius: 4px; cursor: pointer; font: inherit;
  }
  .past-banner button:hover { background: #1e40af; }

  /* When past-month is locked: inputs read-only, write-side controls hidden.
     #periodSelect is excluded so the operator can still navigate periods. */
  body.past-locked input,
  body.past-locked textarea,
  body.past-locked select:not(#periodSelect) {
    pointer-events: none; background: #f9fafb !important; color: #374151;
  }
  body.past-locked #submit,
  body.past-locked #lockToggle,
  body.past-locked #addRow,
  body.past-locked #addRowBox,
  body.past-locked #restoreAll,
  body.past-locked .delete-row,
  body.past-locked .row-handle {
    display: none !important;
  }

  /* Snapshot (read-only) mode: shown when /worksheet?snapshot=:requestId. */
  body.snap input, body.snap textarea, body.snap select {
    pointer-events: none; background: #f9fafb !important; color: #374151;
  }
  body.snap #periodSelect { pointer-events: none; opacity: 0.7; }
  body.snap #submit, body.snap #lockToggle, body.snap #addRowBox, body.snap #addRow,
  body.snap #restoreAll, body.snap .delete-row, body.snap #saveState,
  body.snap #historyPanel, body.snap .row-handle { display: none !important; }
  body.snap .snap-banner {
    display: flex; align-items: center; gap: 12px; padding: 8px 14px;
    background: #dbeafe; border: 1px solid #1d4ed8; border-radius: 6px;
    margin-bottom: 12px; color: #1e3a8a; font-size: 14px;
  }
  body.snap .snap-banner strong { color: #1d4ed8; }
  body.snap .snap-banner a { color: #1d4ed8; margin-left: auto; }
  .snap-banner { display: none; }
</style>
</head>
<body>
<header>
  <h1>คำนวณเงินเดือน</h1>
  <nav>
    <a href="/worksheet" class="active">คำนวณเงินเดือน</a>
    <a href="/accounts">จัดการบัญชี</a>
    <a href="/status">สถานะคำขอ</a>
    <!--ADMIN_NAV-->
  </nav>
  ${ZOOM_HTML}
</header>
<!--ADMIN_MODAL-->

<div class="snap-banner" id="snapBanner">
  <span>📜 กำลังดูประวัติคำขอ <code id="snapId"></code> · <span id="snapStatus"></span></span>
  <a href="/worksheet">← กลับสู่หน้าคำนวณ</a>
</div>

<div class="past-banner locked" id="pastBannerLocked" hidden>
  <span>📅 <strong>เดือน<span id="pastMonthName"></span></strong> เป็นเดือนเก่า — <strong>ดูได้อย่างเดียว</strong></span>
  <span class="hint">(ตัดยอดทุกวันที่ 4 ของเดือนถัดไป)</span>
  <button type="button" id="unlockPast">🔓 ปลดล็อคเพื่อแก้ไข</button>
</div>
<div class="past-banner unlocked" id="pastBannerUnlocked" hidden>
  <span>⚠️ <strong>กำลังแก้ไขเดือน<span id="pastMonthName2"></span></strong> (ย้อนหลัง) — บันทึกอัตโนมัติเปิดอยู่ การเปลี่ยนแปลงจะไม่กระทบคำขอที่ส่งไปแล้ว</span>
</div>

<div id="reportRoot"></div>

<fieldset>
  <legend>ข้อมูลทั่วไป &middot; สรุป</legend>
  <div class="top-row">
    <div>
      <label for="periodSelect">เดือน</label>
      <select id="periodSelect"></select>
    </div>
    <div id="historyPanel" hidden>
      <span id="historyText"></span>
      <a id="historyLink" href="">→ ดูสถานะคำขอเดือนนี้</a>
    </div>
    <div>
      <label for="effectiveDate">วันที่เงินเข้าบัญชี</label>
      <input id="effectiveDate" type="text" placeholder="วว/ดด/ปปปป" autocomplete="off">
    </div>
    <div class="top-total">
      ยอดรวมเงินเดือน: <strong id="totalAmount">0.00</strong> บาท &middot;
      <span id="rowCount">0</span> คน
    </div>
    <div class="save-state" id="saveState">&nbsp;</div>
    <div style="margin-left:auto; display:flex; gap:8px; align-items:center;">
      <div id="colsBox">
        <button type="button" id="colsBtn" title="ซ่อน/แสดงคอลัมน์ที่ค้าง">⚙ คอลัมน์</button>
        <div id="colsMenu" hidden></div>
      </div>
      <button type="button" id="lockToggle" title="สลับโหมดแก้ไขข้อมูลพื้นฐาน">🔓 ปลดล็อคข้อมูลพื้นฐาน</button>
      <button type="button" id="printBtn" title="พิมพ์สลิปเงินเดือนรายคน (A4 portrait)">🖨 สลิปเงินเดือน</button>
      <button type="button" id="saveCardsBtn" title="บันทึกสลิปเงินเดือนเป็นรูป (.jpg)">🖼 สลิปเงินเดือน</button>
      <button type="button" id="printTableBtn" title="พิมพ์ตารางสรุปทั้งหน้า (A4 landscape)">🖨 ตาราง</button>
      <button type="button" id="saveTableBtn" title="บันทึกตารางสรุปเป็นรูป (.jpg)">🖼 ตาราง</button>
      <button type="button" id="submit" class="primary">ส่งให้อนุมัติ</button>
    </div>
  </div>
  <div class="hint" style="font-size:13px; color:#6b7280; margin-top:6px;">บันทึกอัตโนมัติทุกครั้งที่แก้ไข &middot; รหัสธนาคาร 004 (กสิกรไทย)</div>
</fieldset>

<div class="table-zone">
<button type="button" class="scroll-btn left" id="scrollLeft" title="เลื่อนซ้าย" aria-label="เลื่อนซ้าย">‹</button>
<button type="button" class="scroll-btn right" id="scrollRight" title="เลื่อนขวา" aria-label="เลื่อนขวา">›</button>
<div class="table-wrap" id="tableWrap">
<table class="sheet" id="sheetTable">
  <thead>
    <tr>
      <th rowspan="3" class="sticky-l" data-col="idx" style="width:42px">ลำดับ</th>
      <th rowspan="3" class="sticky-l" data-col="name" style="min-width:180px">ชื่อ - สกุล</th>
      <th rowspan="3" class="sticky-l" data-col="account" style="min-width:240px">เลขที่บัญชีธนาคาร</th>
      <th rowspan="3" class="sticky-l" data-col="nickname" style="min-width:70px">ชื่อเล่น</th>
      <th rowspan="3" class="sticky-l" data-col="position" style="min-width:90px">ตำแหน่ง</th>
      <th rowspan="3" class="sticky-l" data-col="salary" style="min-width:110px">เงินเดือน</th>
      <th colspan="8" class="deduct" id="anchor-deduct">รายการหัก</th>
      <th rowspan="3" class="calc">รวมรายการหัก</th>
      <th colspan="2" class="add" id="anchor-add">รับอื่นๆ</th>
      <th rowspan="3" class="add">ค่าโอที</th>
      <th rowspan="3" class="add">รวมรับอื่นๆ</th>
      <th rowspan="3" class="calc" id="anchor-total">รวมเงินเดือน</th>
      <th rowspan="3">หมายเหตุ</th>
    </tr>
    <tr>
      <th rowspan="2" class="deduct">ประกันสังคม<span class="hint">3%</span></th>
      <th rowspan="2" class="deduct">เงินสะสม<span class="hint">5%</span></th>
      <th rowspan="2" class="deduct">เบิกล่วงหน้า</th>
      <th colspan="4" class="deduct">อื่นๆ</th>
      <th rowspan="2" class="deduct">หักคอมมิชชั่น</th>
      <th rowspan="2" class="add">คอมมิชชั่น</th>
      <th rowspan="2" class="add">ทำอาหารเช้า<span class="hint">7%</span></th>
    </tr>
    <tr>
      <th class="deduct">เงินยืม</th>
      <th class="deduct">ดอกเบี้ย<span class="hint">1.50%</span></th>
      <th class="deduct">ค่าห้องพัก</th>
      <th class="deduct">ลากิจ / ลาชม / ลาป่วย</th>
    </tr>
  </thead>
  <tbody id="rows"></tbody>
  <tfoot>
    <tr id="totals"></tr>
  </tfoot>
</table>
</div>
</div>

<div id="addRowBox" hidden>
  <button type="button" id="addRow">+ เพิ่มแถวใหม่ (กรอกชื่อ/บัญชี/เงินเดือน เอง)</button>
  <button type="button" id="restoreAll" hidden style="margin-left:10px; padding:8px 14px; border:1px dashed #9ca3af; background:#fff; border-radius:4px; cursor:pointer; color:#374151; font-size:14px;">ดึงพนักงานจากระบบเงินเดือน KBANK (<span id="restoreCount">0</span>)</button>
</div>

<fieldset style="margin-top:18px">
  <legend>หมายเหตุท้ายตาราง</legend>
  <textarea id="generalNotes" placeholder="เช่น สรุปยอดคอมฯ, รายการเฉพาะกิจ, พนักงานที่ลา ฯลฯ"></textarea>
</fieldset>

<div id="msg"></div>

<script src="/static/flatpickr.js"></script>
<script src="/static/flatpickr-th.js"></script>
<script src="/static/html2canvas.js"></script>
<script>
const FIELDS = [
  "salary",
  "socialSecurity","savings","advance","loan","interest","roomCost","leave","otherDeduction",
  "commission","breakfast","ot","otherAddition",
];
const DEDUCT_FIELDS = ["socialSecurity","savings","advance","loan","interest","roomCost","leave","otherDeduction"];
const ADD_FIELDS = ["commission","breakfast","ot","otherAddition"];
const THAI_MONTHS = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน","กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];

const rowsTbody = document.getElementById("rows");
const totalsRow = document.getElementById("totals");
const totalEl = document.getElementById("totalAmount");
const countEl = document.getElementById("rowCount");
const periodSelect = document.getElementById("periodSelect");
const generalNotesEl = document.getElementById("generalNotes");
const saveStateEl = document.getElementById("saveState");
const msgEl = document.getElementById("msg");

let currentPeriod = null;
let currentSheet = null;
let saveTimer = null;
let saveSeq = 0;
let selectedDate = null;
let locked = (localStorage.getItem("worksheet:locked") || "1") === "1";

// Click anywhere in a cell focuses its input — closes the small "dead zone"
// gap between the input and the cell border.
rowsTbody.addEventListener("click", (e) => {
  if (e.target.matches("input, button, textarea, select")) return;
  const td = e.target.closest("td");
  if (!td) return;
  const inp = td.querySelector("input");
  if (inp) inp.focus();
});

function showError(text) { msgEl.className = "err"; msgEl.textContent = text; }
function showOk(html) { msgEl.className = "ok"; msgEl.innerHTML = html; }
function clearMsg() { msgEl.className = ""; msgEl.textContent = ""; }
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
}
function formatAccount(n) {
  const s = String(n).replace(/[^0-9]/g, "");
  if (s.length === 10) return s.slice(0, 3) + "-" + s.slice(3, 4) + "-" + s.slice(4, 9) + "-" + s.slice(9);
  return s;
}
function num(v) {
  if (typeof v === "string") v = v.replace(/,/g, "").trim();
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}
function fmt(n) {
  if (Math.abs(n) < 0.005) return "";
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pad(n) { return String(n).padStart(2, "0"); }
function formatBE(date) { return \`\${pad(date.getDate())}/\${pad(date.getMonth() + 1)}/\${date.getFullYear() + 543}\`; }
function formatGregorian(date) { return \`\${pad(date.getDate())}/\${pad(date.getMonth() + 1)}/\${date.getFullYear()}\`; }
function parseGregorian(str) {
  if (!str) return null;
  const [d, m, y] = str.split("/").map(Number);
  if (!d || !m || !y) return null;
  return new Date(y, m - 1, d);
}

function listPeriods() {
  // Last 12 months + next 1, newest first
  const now = new Date();
  const months = [];
  for (let i = 1; i >= -12; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() + i, 1);
    const y = d.getFullYear();
    const m = pad(d.getMonth() + 1);
    months.push({ value: \`\${y}-\${m}\`, label: \`\${THAI_MONTHS[d.getMonth()]} \${y + 543}\` });
  }
  return months;
}

function defaultPeriod() {
  const now = new Date();
  return \`\${now.getFullYear()}-\${pad(now.getMonth() + 1)}\`;
}

function rowTakeHome(r) {
  const ded = DEDUCT_FIELDS.reduce((s, k) => s + num(r[k]), 0);
  const add = ADD_FIELDS.reduce((s, k) => s + num(r[k]), 0);
  return Math.round((num(r.salary) - ded + add) * 100) / 100;
}
function rowDeductTotal(r) { return DEDUCT_FIELDS.reduce((s, k) => s + num(r[k]), 0); }

function displayAccount(r) {
  const num = String(r.accountNumber || "");
  if (!num) return "";
  const bank = (r.bank || "KBANK").toUpperCase();
  return bank + " - " + formatAccount(num);
}

// Verified = (accountName, accountNumber) matches an entry in /api/accounts.
// Warning = accountNumber contains letters (non-KBANK formatted by the user).
let accountsIndex = new Set();
let accountsById = new Map();
function normalizeAcct(s) { return String(s || "").replace(/[\\s-]/g, "").toLowerCase(); }
function normalizeName(s) { return String(s || "").trim().toLowerCase(); }
async function refreshAccountsIndex() {
  try {
    const res = await fetch("/api/accounts");
    if (!res.ok) return;
    const accs = await res.json();
    accountsIndex = new Set(accs.map((a) => normalizeName(a.accountName) + "|||" + normalizeAcct(a.accountNumber)));
    accountsById = new Map(accs.map((a) => [a.id, a]));
  } catch {}
}
function isVerified(r) {
  if (!r.accountName || !r.accountNumber) return false;
  return accountsIndex.has(normalizeName(r.accountName) + "|||" + normalizeAcct(r.accountNumber));
}
function isNonKbank(r) {
  if (typeof r === "string") return /[A-Za-z]/.test(r); // legacy callsite
  const bank = (r.bank || "KBANK").toUpperCase();
  return bank !== "KBANK";
}

function frontCells(r, locked) {
  const checkInline = isVerified(r)
    ? '<span class="acct-check" title="ตรงกับฐาน /accounts">✓</span>' : "";
  const warnBadge = isNonKbank(r)
    ? '<span class="row-badge warn" title="ไม่ใช่บัญชี KBANK — ตรวจสอบก่อนโอน">⚠ ไม่ใช่ KBANK</span>' : "";
  if (locked) {
    return \`<td class="name sticky-l" data-col="name">\${escapeHtml(r.accountName || "")}</td>\` +
      \`<td class="acct sticky-l" data-col="account">\${escapeHtml(displayAccount(r))}\${checkInline}\${warnBadge}</td>\` +
      \`<td class="sticky-l" data-col="nickname">\${escapeHtml(r.nickname || "")}</td>\` +
      \`<td class="sticky-l" data-col="position">\${escapeHtml(r.position || "")}</td>\`;
  }
  return \`<td class="sticky-l" data-col="name"><input type="text" class="sm-text" data-field="accountName" value="\${escapeHtml(r.accountName || "")}" placeholder="ชื่อ - สกุล"></td>\` +
    \`<td class="sticky-l" data-col="account"><div class="acct-edit-wrap"><input type="text" class="sm-text bank-input" data-field="bank" value="\${escapeHtml(r.bank || "KBANK")}" placeholder="ธนาคาร"><span style="color:#9ca3af; padding:0 2px;">-</span><input type="text" class="sm-text" data-field="accountNumber" value="\${escapeHtml(r.accountNumber || "")}" placeholder="เลขบัญชี">\${checkInline}</div>\${warnBadge}</td>\` +
    \`<td class="sticky-l" data-col="nickname"><input type="text" class="sm-text" data-field="nickname" value="\${escapeHtml(r.nickname || "")}" placeholder="ชื่อเล่น"></td>\` +
    \`<td class="sticky-l" data-col="position"><input type="text" class="sm-text" data-field="position" value="\${escapeHtml(r.position || "")}" placeholder="ตำแหน่ง"></td>\`;
}

function salaryCell(r, locked) {
  if (locked) return \`<td class="sticky-l" data-col="salary" style="text-align:right; font-variant-numeric:tabular-nums; padding-right:10px;">\${fmt(r.salary)}</td>\`;
  return \`<td class="sticky-l" data-col="salary"><input type="text" inputmode="decimal" class="num" data-field="salary" value="\${fmt(r.salary)}" placeholder="—"></td>\`;
}

function renderRows(sheet) {
  rowsTbody.innerHTML = "";
  const sheetTable = document.getElementById("sheetTable");
  sheetTable.classList.toggle("unlocked", !locked);
  sheet.rows.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.dataset.idx = String(i);
    const numCell = (field, klass) => \`
      <td class="\${klass}"><input type="text" inputmode="decimal" class="num" data-field="\${field}" value="\${fmt(r[field])}" placeholder="—"></td>\`;
    const handle = locked ? "" : '<span class="drag-handle" title="ลากเพื่อจัดเรียง">⋮⋮</span> ';
    const delBtn = locked ? "" : \` <button type="button" class="idx-del" data-idx="\${i}" title="ลบแถวนี้">✕</button>\`;
    tr.innerHTML =
      \`<td class="idx sticky-l" data-col="idx">\${handle}\${i + 1}\${delBtn}</td>\` +
      frontCells(r, locked) +
      salaryCell(r, locked) +
      numCell("socialSecurity","deduct") +
      numCell("savings","deduct") +
      numCell("advance","deduct") +
      numCell("loan","deduct") +
      numCell("interest","deduct") +
      numCell("roomCost","deduct") +
      numCell("leave","deduct") +
      numCell("otherDeduction","deduct") +
      \`<td class="calc deduct-total">—</td>\` +
      numCell("commission","add") +
      numCell("breakfast","add") +
      numCell("ot","add") +
      numCell("otherAddition","add") +
      \`<td class="calc takehome">—</td>\` +
      \`<td><input type="text" class="note" data-field="note" value="\${escapeHtml(r.note || "")}" placeholder="—"></td>\`;
    rowsTbody.appendChild(tr);
  });
  // Wire input listeners
  rowsTbody.querySelectorAll("input").forEach((inp) => {
    inp.addEventListener("input", onInput);
    inp.addEventListener("blur", onBlur);
    inp.addEventListener("keydown", onKeyDown);
  });
  rowsTbody.querySelectorAll(".idx-del").forEach((b) => {
    b.addEventListener("click", onDeleteRow);
  });
  recalcAll();
  setupStickyAndScroll();
  if (typeof applyColumnVisibility === "function") applyColumnVisibility();
  if (typeof updateRestoreUI === "function") updateRestoreUI();
}

// Measure pinned column widths from the thead row and assign each pinned
// cell (in thead, tbody, tfoot) a matching left style. Hidden cols are
// skipped (display:none → offsetWidth 0). The last *visible* sticky cell
// in each row gets sticky-l-last (right-edge shadow).
function setupStickyAndScroll() {
  const headerStickyTh = document.querySelectorAll("thead .sticky-l");
  if (headerStickyTh.length === 0) return;
  const widths = [];
  headerStickyTh.forEach((th) => widths.push(th.offsetWidth));
  document.querySelectorAll("table.sheet tr").forEach((tr) => {
    const cells = tr.querySelectorAll(".sticky-l");
    if (cells.length === 0) return;
    let acc = 0;
    let lastVisibleIdx = -1;
    cells.forEach((c, i) => {
      c.style.left = acc + "px";
      acc += widths[i] || 0;
      if (!c.classList.contains("hidden-col")) lastVisibleIdx = i;
    });
    cells.forEach((c, i) => {
      c.classList.toggle("sticky-l-last", i === lastVisibleIdx);
    });
  });
  const total = widths.reduce((s, w) => s + w, 0);
  document.documentElement.style.setProperty("--pinned-w", (total + 6) + "px");
  updateScrollBtns();
}

function pinnedWidth() {
  const ths = document.querySelectorAll("thead .sticky-l");
  let w = 0;
  ths.forEach((th) => { w += th.offsetWidth; });
  return w;
}

function sectionTargets() {
  const wrap = document.getElementById("tableWrap");
  const pinW = pinnedWidth();
  const maxScroll = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
  const ids = ["anchor-deduct", "anchor-add", "anchor-total"];
  const targets = [{ name: "เริ่มต้น", left: 0 }];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    // Clamp each anchor target to a reachable scroll position; otherwise
    // scrollTo gets clamped silently and the button appears not to move.
    const left = Math.min(maxScroll, Math.max(0, el.offsetLeft - pinW));
    targets.push({ name: el.textContent.trim(), left });
  }
  targets.push({ name: "ท้าย", left: maxScroll });
  // Dedupe positions that resolve within 8px of each other (e.g. an anchor
  // clamped to maxScroll collapses with "ท้าย").
  return targets.filter((t, i, a) => i === 0 || Math.abs(t.left - a[i-1].left) > 8);
}

function currentSectionIdx() {
  const wrap = document.getElementById("tableWrap");
  const t = sectionTargets();
  const sl = wrap.scrollLeft;
  let i = 0;
  for (let k = 0; k < t.length; k++) if (sl >= t[k].left - 6) i = k;
  return i;
}

function updateScrollBtns() {
  const wrap = document.getElementById("tableWrap");
  const left = document.getElementById("scrollLeft");
  const right = document.getElementById("scrollRight");
  if (!wrap || !left || !right) return;
  left.disabled = wrap.scrollLeft <= 2;
  right.disabled = wrap.scrollLeft >= wrap.scrollWidth - wrap.clientWidth - 2;
}

// Linked-fields rule: ประกันสังคม=3% and เงินสะสม=5% of salary auto-fill
// only while their current value matches the OLD salary's 3%/5%. Once the
// user manually overrides, the link breaks and salary changes no longer
// touch that field.
const LINKED_RATES = { socialSecurity: 0.03, savings: 0.05 };

// Backfill helper: rows saved before linked-rate logic existed (or rows
// where salary was entered without triggering an edit event) still need
// their ประกันสังคม/เงินสะสม populated. Only fills cells that are exactly 0.
function applyLinkedRateFillRow(r) {
  const sal = num(r.salary);
  if (sal <= 0) return false;
  let changed = false;
  for (const k of Object.keys(LINKED_RATES)) {
    if (num(r[k]) === 0) {
      r[k] = Math.round(sal * LINKED_RATES[k] * 100) / 100;
      changed = true;
    }
  }
  return changed;
}
function setRowField(tr, row, field, value) {
  row[field] = value;
  const inp = tr.querySelector('input[data-field="' + field + '"]');
  if (inp && document.activeElement !== inp) inp.value = fmt(value);
}

function onInput(e) {
  const tr = e.target.closest("tr");
  const idx = parseInt(tr.dataset.idx, 10);
  const field = e.target.dataset.field;
  const row = currentSheet.rows[idx];
  if (e.target.classList.contains("num")) {
    if (field === "salary") {
      const newSalary = num(e.target.value);
      row.salary = newSalary;
      // Always recompute linked rates whenever salary is edited; manual
      // overrides are expected to be entered AFTER setting the salary.
      for (const k of Object.keys(LINKED_RATES)) {
        const v = Math.round(newSalary * LINKED_RATES[k] * 100) / 100;
        setRowField(tr, row, k, v);
      }
    } else {
      row[field] = num(e.target.value);
    }
  } else {
    row[field] = e.target.value;
  }
  if (FIELDS.includes(field)) recalcRow(tr, row);
  if (field === "accountName" || field === "accountNumber" || field === "bank") updateBadges(tr, row);
  recalcGrand();
  scheduleSave();
}

function updateBadges(tr, r) {
  tr.querySelectorAll(".row-badge").forEach((el) => el.remove());
  if (isVerified(r)) {
    const nameCell = tr.children[1];
    if (nameCell) nameCell.insertAdjacentHTML("beforeend",
      '<span class="row-badge verified" title="ตรงกับฐาน /accounts">✓ ตรงกับฐาน</span>');
  }
  if (isNonKbank(r)) {
    const acctCell = tr.children[2];
    if (acctCell) acctCell.insertAdjacentHTML("beforeend",
      '<span class="row-badge warn" title="ไม่ใช่บัญชี KBANK — ตรวจสอบก่อนโอน">⚠ ไม่ใช่ KBANK</span>');
  }
}

function onBlur(e) {
  if (e.target.classList.contains("num")) {
    e.target.value = fmt(num(e.target.value));
  }
}

function siblingRowField(inp, dir) {
  const tr = inp.closest("tr");
  const field = inp.dataset.field;
  if (!tr || !field) return null;
  let row = dir > 0 ? tr.nextElementSibling : tr.previousElementSibling;
  while (row) {
    const target = row.querySelector('input[data-field="' + field + '"]');
    if (target) return target;
    row = dir > 0 ? row.nextElementSibling : row.previousElementSibling;
  }
  return null;
}

function siblingColField(inp, dir) {
  const td = inp.closest("td");
  if (!td) return null;
  let next = dir > 0 ? td.nextElementSibling : td.previousElementSibling;
  while (next) {
    if (!next.classList.contains("hidden-col")) {
      const target = next.querySelector("input");
      if (target) return target;
    }
    next = dir > 0 ? next.nextElementSibling : next.previousElementSibling;
  }
  return null;
}

function onKeyDown(e) {
  // Enter / Shift+Enter → move down / up in the same column. If no row is
  // available, blur (commits the value and blends the input back into the
  // table background).
  if (e.key === "Enter") {
    e.preventDefault();
    const next = siblingRowField(e.target, e.shiftKey ? -1 : 1);
    if (next) { next.focus(); if (next.select) next.select(); }
    else e.target.blur();
    return;
  }
  // Arrow up/down → move between rows in the same column. Note: this
  // overrides cursor-movement-in-text, but the inputs are short and that's
  // the standard spreadsheet behavior.
  if (e.key === "ArrowUp" || e.key === "ArrowDown") {
    const next = siblingRowField(e.target, e.key === "ArrowDown" ? 1 : -1);
    if (next) { e.preventDefault(); next.focus(); if (next.select) next.select(); }
    return;
  }
  // Arrow left/right → move between cells, but only when the text caret is
  // already at the edge — otherwise the user is navigating within the value.
  if (e.key === "ArrowLeft") {
    if (e.target.selectionStart === 0 && e.target.selectionEnd === 0) {
      const prev = siblingColField(e.target, -1);
      if (prev) { e.preventDefault(); prev.focus(); if (prev.select) prev.select(); }
    }
    return;
  }
  if (e.key === "ArrowRight") {
    const len = (e.target.value || "").length;
    if (e.target.selectionStart === len && e.target.selectionEnd === len) {
      const next = siblingColField(e.target, 1);
      if (next) { e.preventDefault(); next.focus(); if (next.select) next.select(); }
    }
    return;
  }
}

function recalcRow(tr, r) {
  tr.querySelector(".deduct-total").textContent = fmt(rowDeductTotal(r));
  tr.querySelector(".takehome").textContent = fmt(rowTakeHome(r));
}

function recalcAll() {
  rowsTbody.querySelectorAll("tr").forEach((tr) => {
    const idx = parseInt(tr.dataset.idx, 10);
    recalcRow(tr, currentSheet.rows[idx]);
  });
  recalcGrand();
}

function recalcGrand() {
  let total = 0, n = 0;
  for (const r of currentSheet.rows) {
    const t = rowTakeHome(r);
    if (t > 0) { total += t; n++; }
  }
  totalEl.textContent = fmt(total) || "0.00";
  countEl.textContent = String(n);
  // Build totals footer (column sums)
  const sums = {};
  for (const f of FIELDS) sums[f] = 0;
  for (const r of currentSheet.rows) for (const f of FIELDS) sums[f] += num(r[f]);
  const sumDeduct = DEDUCT_FIELDS.reduce((s, k) => s + sums[k], 0);
  const cells = [
    \`<td class="sticky-l" data-col="idx"></td>\`,
    \`<td class="sticky-l label" data-col="name">รวม</td>\`,
    \`<td class="sticky-l" data-col="account"></td>\`,
    \`<td class="sticky-l" data-col="nickname"></td>\`,
    \`<td class="sticky-l" data-col="position"></td>\`,
    \`<td class="sticky-l" data-col="salary">\${fmt(sums.salary)}</td>\`,
    ...DEDUCT_FIELDS.map((f) => \`<td class="deduct">\${fmt(sums[f])}</td>\`),
    \`<td class="calc">\${fmt(sumDeduct)}</td>\`,
    ...ADD_FIELDS.map((f) => \`<td class="add">\${fmt(sums[f])}</td>\`),
    \`<td class="calc">\${fmt(total)}</td>\`,
    \`<td></td>\`,
  ];
  totalsRow.innerHTML = cells.join("");
}

// Past-month lock state — set per-period in applyPastLockState().
// Defense in depth: scheduleSave() short-circuits if locked, even though
// the inputs themselves are pointer-events:none in this state.
let pastLocked = false;

// "Past" = period older than the 4th of the following month at 00:00
// local time. e.g. for period 2026-04, the cutoff is 2026-05-04 00:00.
function isPastPeriod(period) {
  const m = /^(\\d{4})-(\\d{2})$/.exec(period || "");
  if (!m) return false;
  const y = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10); // 1-12; Date constructor wants 0-11 so passing mo lands on the next month.
  const cutoff = new Date(y, mo, 4, 0, 0, 0);
  return new Date() >= cutoff;
}

function periodMonthLabelTH(period) {
  const m = /^(\\d{4})-(\\d{2})$/.exec(period || "");
  if (!m) return period;
  const TH = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
              "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  return TH[parseInt(m[2], 10) - 1] + " " + (parseInt(m[1], 10) + 543);
}

function applyPastLockState(period) {
  // Snapshot mode handles its own readonly via body.snap; don't double-apply.
  if (readonly) return;
  const lockedBanner = document.getElementById("pastBannerLocked");
  const unlockedBanner = document.getElementById("pastBannerUnlocked");
  if (isPastPeriod(period)) {
    pastLocked = true;
    document.body.classList.add("past-locked");
    document.getElementById("pastMonthName").textContent = periodMonthLabelTH(period);
    lockedBanner.hidden = false;
    unlockedBanner.hidden = true;
  } else {
    pastLocked = false;
    document.body.classList.remove("past-locked");
    lockedBanner.hidden = true;
    unlockedBanner.hidden = true;
  }
}

function scheduleSave() {
  if (readonly) return;
  if (pastLocked) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveStateEl.className = "save-state saving";
  saveStateEl.textContent = "กำลังบันทึก…";
  saveTimer = setTimeout(save, 600);
}

async function save() {
  if (!currentSheet || !currentPeriod) return;
  const seq = ++saveSeq;
  const body = {
    effectiveDate: currentSheet.effectiveDate || "",
    rows: currentSheet.rows,
    generalNotes: currentSheet.generalNotes || "",
    dismissed: Array.isArray(currentSheet.dismissed) ? currentSheet.dismissed : [],
  };
  try {
    const res = await fetch(\`/api/sheets/\${currentPeriod}\`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (seq !== saveSeq) return; // a newer save started; ignore this result
    if (!res.ok) throw new Error(await res.text());
    const updated = await res.json();
    saveStateEl.className = "save-state saved";
    const t = new Date(updated.updatedAt);
    saveStateEl.textContent = \`บันทึก \${pad(t.getHours())}:\${pad(t.getMinutes())}\`;
  } catch (e) {
    if (seq !== saveSeq) return;
    saveStateEl.className = "save-state failed";
    saveStateEl.textContent = "บันทึกล้มเหลว";
  }
}

async function loadPeriod(period) {
  clearMsg();
  saveStateEl.className = "save-state";
  saveStateEl.textContent = "กำลังโหลด…";
  const res = await fetch(\`/api/sheets/\${period}\`);
  if (!res.ok) { showError("โหลดไม่สำเร็จ: " + res.status); return; }
  const sheet = await res.json();
  currentPeriod = period;
  currentSheet = sheet;
  // Apply past-month lock state BEFORE the linked-rate backfill so a
  // backfill on a past sheet doesn't accidentally trigger autosave.
  applyPastLockState(period);
  // Backfill ส.ส./สะสม only on the current/grace period — past periods
  // stay as-was to preserve the historical record.
  let filledAny = false;
  if (!pastLocked) {
    for (const r of sheet.rows) if (applyLinkedRateFillRow(r)) filledAny = true;
  }
  generalNotesEl.value = sheet.generalNotes || "";
  selectedDate = parseGregorian(sheet.effectiveDate);
  if (selectedDate) fp.setDate(selectedDate, true);
  else fp.clear();
  renderRows(sheet);
  if (filledAny) scheduleSave();
  saveStateEl.className = "save-state saved";
  if (sheet.updatedAt) {
    const t = new Date(sheet.updatedAt);
    saveStateEl.textContent = \`บันทึกล่าสุด \${pad(t.getHours())}:\${pad(t.getMinutes())}\`;
  } else {
    saveStateEl.textContent = "ยังไม่มีข้อมูล";
  }
}

// Snapshot mode: /worksheet?snapshot=<request-id> renders the queue item's
// embedded sheet snapshot read-only (admin-only — relies on /api/queue/:id
// being admin-gated to enforce). Picked up before period-select wiring so
// the period dropdown is populated for context but disabled.
const snapshotId = new URLSearchParams(window.location.search).get("snapshot");
const readonly = !!snapshotId;
if (readonly) document.body.classList.add("snap");

// Wire period selector
const periods = listPeriods();
for (const p of periods) {
  const opt = document.createElement("option");
  opt.value = p.value;
  opt.textContent = p.label;
  periodSelect.appendChild(opt);
}
periodSelect.value = defaultPeriod();
periodSelect.addEventListener("change", () => loadPeriod(periodSelect.value).then(() => refreshHistory()));

// History panel: shows count of past transfer-payroll submissions for the
// currently-loaded period, with a link to /status?period=YYYY-MM. Hidden in
// snapshot mode (where the period is fixed and history is moot).
const historyPanel = document.getElementById("historyPanel");
const historyText = document.getElementById("historyText");
const historyLink = document.getElementById("historyLink");

// Mirror the labels used on /status and /approvals so status counts
// in the history panel read in Thai instead of pending/rejected/etc.
const HISTORY_STATUS_TH = {
  pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธ", running: "กำลังประมวลผล",
  done: "สำเร็จ", failed: "ไม่สำเร็จ",
};

async function refreshHistory() {
  if (readonly || !currentPeriod) { historyPanel.hidden = true; return; }
  try {
    const res = await fetch("/api/queue/status");
    if (!res.ok) { historyPanel.hidden = true; return; }
    const all = await res.json();
    const matching = all.filter((r) => r.type === "transfer-payroll" && r.period === currentPeriod);
    if (matching.length === 0) { historyPanel.hidden = true; return; }
    const counts = matching.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
    const bits = Object.entries(counts)
      .map(([k, v]) => \`\${HISTORY_STATUS_TH[k] || k}: \${v}\`)
      .join(" · ");
    historyText.textContent = \`คำขอเดือนนี้: \${matching.length} ราย (\${bits})\`;
    historyLink.href = \`/status?period=\${currentPeriod}\`;
    historyPanel.hidden = false;
  } catch { historyPanel.hidden = true; }
}

// Derive a YYYY-MM period from a "DD/MM/YYYY" effectiveDate string.
// Used as a last-resort hint for queue items that predate summary.period.
function periodFromEffective(eff) {
  const m = /^(\\d{2})\\/(\\d{2})\\/(\\d{4})$/.exec(eff || "");
  return m ? \`\${m[3]}-\${m[2]}\` : null;
}

async function loadSnapshot(id) {
  saveStateEl.className = "save-state";
  const res = await fetch(\`/api/queue/\${id}\`);
  if (!res.ok) {
    showError(\`โหลดคำขอไม่สำเร็จ (\${res.status}). คำขอนี้อาจไม่มีอยู่ หรือคุณไม่มีสิทธิ์ดู — \` +
      \`<a href="/worksheet">กลับหน้าคำนวณ</a>\`);
    return;
  }
  const req = await res.json();
  const STATUS_TH = {
    pending: "รออนุมัติ", approved: "อนุมัติแล้ว",
    rejected: "ปฏิเสธ", running: "กำลังประมวลผล",
    done: "สำเร็จ", failed: "ไม่สำเร็จ",
  };
  document.getElementById("snapId").textContent = id;
  document.getElementById("snapStatus").innerHTML =
    "สถานะ: <strong>" + escapeHtml(STATUS_TH[req.status] || req.status) + "</strong>" +
    (req.summary && req.summary.effectiveDate ? " · เงินเข้า " + escapeHtml(req.summary.effectiveDate) : "");

  if (!req.summary || req.type !== "transfer-payroll") {
    showError("คำขอนี้ไม่ใช่ payroll transfer — ไม่มีรายละเอียดเงินเดือนให้ดู");
    return;
  }

  // Two paths: (1) snapshot embedded in the queue item — exact state at
  // submit time (preferred); (2) no snapshot (older items) — derive the
  // period and load the current worksheet for that month, with a warning
  // that the data may have been edited since.
  let sheet = req.summary.sheet;
  let isLiveFallback = false;

  if (!sheet) {
    const period = req.summary.period || periodFromEffective(req.summary.effectiveDate);
    if (!period) {
      showError(
        "คำขอนี้ไม่มีข้อมูลเดือนที่อ้างอิง — ดูเฉพาะ xlsx ได้ที่ " +
        '<a href="/api/queue/' + encodeURIComponent(id) + '/xlsx">ดาวน์โหลด xlsx</a>'
      );
      return;
    }
    const sheetRes = await fetch(\`/api/sheets/\${period}\`);
    if (!sheetRes.ok) {
      showError(\`โหลด worksheet ของเดือน \${period} ไม่สำเร็จ\`);
      return;
    }
    sheet = await sheetRes.json();
    isLiveFallback = true;
  }

  if (isLiveFallback) {
    const banner = document.querySelector(".snap-banner");
    if (banner) {
      const warn = document.createElement("div");
      warn.style.cssText = "margin-top:6px;color:#92400e;font-size:13px;";
      warn.textContent =
        "⚠️ ไม่มี snapshot ของช่วงที่ส่งคำขอ — กำลังแสดง worksheet ปัจจุบัน (อาจถูกแก้ไขหลังส่งคำขอ)";
      banner.appendChild(warn);
    }
  }

  currentPeriod = sheet.period || (req.summary.period || periodFromEffective(req.summary.effectiveDate) || "");
  if (currentPeriod) periodSelect.value = currentPeriod;
  currentSheet = sheet;
  generalNotesEl.value = sheet.generalNotes || "";
  selectedDate = parseGregorian(sheet.effectiveDate);
  if (selectedDate) fp.setDate(selectedDate, true); else fp.clear();
  renderRows(sheet);
}

// Wire effective date (flatpickr with BE display, like main page)
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
  onChange: (dates) => {
    selectedDate = dates[0] || null;
    if (currentSheet) {
      currentSheet.effectiveDate = selectedDate ? formatGregorian(selectedDate) : "";
      scheduleSave();
    }
  },
  onReady: (sel, str, fp) => setupYearDisplay(fp),
  onYearChange: (sel, str, fp) => fp._beSync && fp._beSync(),
  onMonthChange: (sel, str, fp) => fp._beSync && fp._beSync(),
  onOpen: (sel, str, fp) => fp._beSync && fp._beSync(),
});

// Wire general notes textarea
generalNotesEl.addEventListener("input", () => {
  if (!currentSheet) return;
  currentSheet.generalNotes = generalNotesEl.value;
  scheduleSave();
});

// Wire submit
document.getElementById("submit").addEventListener("click", async () => {
  clearMsg();
  if (!currentSheet) return;
  if (!currentSheet.effectiveDate) { showError("กรุณาระบุวันที่เงินเข้าบัญชี"); return; }
  // Force a final save before queueing so the server has the latest sheet.
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  await save();

  const rows = [];
  for (const r of currentSheet.rows) {
    const t = rowTakeHome(r);
    if (t > 0) rows.push({ accountNumber: r.accountNumber, accountName: r.accountName, amount: t });
  }
  if (rows.length === 0) { showError("ไม่มีรายการที่มียอดสุทธิมากกว่า 0"); return; }

  const btn = document.getElementById("submit");
  btn.disabled = true;
  const prev = btn.textContent;
  btn.textContent = "กำลังส่ง…";
  try {
    const res = await fetch("/api/queue/transfer", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ effectiveDate: currentSheet.effectiveDate, period: currentPeriod, rows }),
    });
    if (!res.ok) { showError("ส่งคำขอไม่สำเร็จ: " + res.status + " " + (await res.text())); return; }
    const req = await res.json();
    showOk("✓ ส่งคำขออนุมัติแล้ว · ID: <code>" + req.id + "</code> · " +
      '<a href="/status">ดูสถานะคำขอ</a>');
  } finally {
    btn.disabled = false;
    btn.textContent = prev;
  }
});

// Lock-mode toggle: re-renders rows so the 6 "roster info" cells switch
// between read-only display and editable inputs.
function applyLockUI() {
  const btn = document.getElementById("lockToggle");
  const addBox = document.getElementById("addRowBox");
  if (locked) {
    btn.textContent = "🔓 ปลดล็อคข้อมูลพื้นฐาน";
    btn.classList.remove("unlocked");
    if (addBox) addBox.hidden = true;
  } else {
    btn.textContent = "🔒 ล็อคข้อมูลพื้นฐาน";
    btn.classList.add("unlocked");
    if (addBox) addBox.hidden = false;
  }
}
document.getElementById("lockToggle").addEventListener("click", () => {
  locked = !locked;
  localStorage.setItem("worksheet:locked", locked ? "1" : "0");
  applyLockUI();
  if (currentSheet) renderRows(currentSheet);
});

function updateRestoreUI() {
  const btn = document.getElementById("restoreAll");
  const cnt = document.getElementById("restoreCount");
  if (!btn || !cnt) return;
  const dismissed = (currentSheet && Array.isArray(currentSheet.dismissed)) ? currentSheet.dismissed : [];
  const count = dismissed.filter((id) => accountsById.has(id)).length;
  if (count > 0) { btn.hidden = false; cnt.textContent = String(count); }
  else { btn.hidden = true; }
}

document.getElementById("restoreAll").addEventListener("click", () => {
  if (!currentSheet || locked) return;
  const dismissed = (Array.isArray(currentSheet.dismissed) ? currentSheet.dismissed : []).slice();
  const remaining = [];
  for (const id of dismissed) {
    const a = accountsById.get(id);
    if (!a) { remaining.push(id); continue; }
    if (currentSheet.rows.some((r) => r.accountId === id)) continue;
    currentSheet.rows.push({
      accountId: a.id, accountNumber: a.accountNumber, accountName: a.accountName,
      bank: "KBANK", nickname: "", position: "",
      salary: 0, socialSecurity: 0, savings: 0, advance: 0, loan: 0,
      interest: 0, roomCost: 0, leave: 0, otherDeduction: 0,
      commission: 0, breakfast: 0, ot: 0, otherAddition: 0,
      note: "",
    });
  }
  currentSheet.dismissed = remaining;
  renderRows(currentSheet);
  scheduleSave();
});

document.getElementById("addRow").addEventListener("click", () => {
  if (!currentSheet || locked) return;
  const id = "m-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
  currentSheet.rows.push({
    accountId: id,
    accountNumber: "", accountName: "", bank: "KBANK", nickname: "", position: "",
    salary: 0, socialSecurity: 0, savings: 0, advance: 0, loan: 0,
    interest: 0, roomCost: 0, leave: 0, otherDeduction: 0,
    commission: 0, breakfast: 0, ot: 0, otherAddition: 0,
    note: "",
  });
  renderRows(currentSheet);
  scheduleSave();
  // Focus the name input on the newly added row
  const lastTr = rowsTbody.lastElementChild;
  if (lastTr) {
    const nameInp = lastTr.querySelector('input[data-field="accountName"]');
    if (nameInp) nameInp.focus();
  }
});

function onDeleteRow(e) {
  if (!currentSheet || locked) return;
  const idx = parseInt(e.currentTarget.dataset.idx, 10);
  const row = currentSheet.rows[idx];
  if (!row) return;
  const label = row.accountName || row.accountNumber || ("แถวที่ " + (idx + 1));
  if (!confirm("ลบ \\"" + label + "\\" ?")) return;
  // Track the dismissal so reconcile-on-load doesn't re-add this account.
  if (!Array.isArray(currentSheet.dismissed)) currentSheet.dismissed = [];
  if (!currentSheet.dismissed.includes(row.accountId)) {
    currentSheet.dismissed.push(row.accountId);
  }
  currentSheet.rows.splice(idx, 1);
  renderRows(currentSheet);
  scheduleSave();
}

// Drag-and-drop row reorder. The handle (⋮⋮) toggles tr.draggable on
// mousedown so dragging from elsewhere in the row (e.g. text inside an
// input) doesn't accidentally start a row-drag.
let dragSrcIdx = null;
rowsTbody.addEventListener("mousedown", (e) => {
  if (locked) return;
  const handle = e.target.closest(".drag-handle");
  if (!handle) return;
  const tr = handle.closest("tr");
  if (tr) tr.draggable = true;
});
function clearDragState() {
  rowsTbody.querySelectorAll('tr[draggable="true"]').forEach((t) => { t.draggable = false; });
  rowsTbody.querySelectorAll(".dragging,.drop-above,.drop-below")
    .forEach((t) => t.classList.remove("dragging", "drop-above", "drop-below"));
  dragSrcIdx = null;
}
rowsTbody.addEventListener("mouseup", () => {
  // If user pressed the handle but didn't drag, just clear the draggable flag.
  if (dragSrcIdx === null) {
    rowsTbody.querySelectorAll('tr[draggable="true"]').forEach((t) => { t.draggable = false; });
  }
});
rowsTbody.addEventListener("dragstart", (e) => {
  if (locked) { e.preventDefault(); return; }
  const tr = e.target.closest("tr");
  if (!tr || !tr.draggable) { e.preventDefault(); return; }
  dragSrcIdx = parseInt(tr.dataset.idx, 10);
  e.dataTransfer.effectAllowed = "move";
  try { e.dataTransfer.setData("text/plain", String(dragSrcIdx)); } catch {}
  tr.classList.add("dragging");
});
rowsTbody.addEventListener("dragover", (e) => {
  if (dragSrcIdx === null) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = "move";
  const tr = e.target.closest("tr");
  if (!tr || tr.classList.contains("dragging")) return;
  const rect = tr.getBoundingClientRect();
  const above = e.clientY < rect.top + rect.height / 2;
  rowsTbody.querySelectorAll(".drop-above,.drop-below")
    .forEach((t) => t.classList.remove("drop-above", "drop-below"));
  tr.classList.add(above ? "drop-above" : "drop-below");
});
rowsTbody.addEventListener("dragleave", (e) => {
  // Only clear when leaving the tbody entirely, not when crossing rows.
  if (e.target === rowsTbody) {
    rowsTbody.querySelectorAll(".drop-above,.drop-below")
      .forEach((t) => t.classList.remove("drop-above", "drop-below"));
  }
});
rowsTbody.addEventListener("drop", (e) => {
  e.preventDefault();
  if (dragSrcIdx === null) return;
  const tr = e.target.closest("tr");
  if (!tr) { clearDragState(); return; }
  let dstIdx = parseInt(tr.dataset.idx, 10);
  const rect = tr.getBoundingClientRect();
  const above = e.clientY < rect.top + rect.height / 2;
  if (!above) dstIdx += 1;
  if (dstIdx > dragSrcIdx) dstIdx -= 1; // shift after removal
  if (dstIdx !== dragSrcIdx) {
    const [moved] = currentSheet.rows.splice(dragSrcIdx, 1);
    currentSheet.rows.splice(dstIdx, 0, moved);
    renderRows(currentSheet);
    scheduleSave();
  }
  clearDragState();
});
rowsTbody.addEventListener("dragend", clearDragState);

// Wire section-jump scroll buttons. Click handler is position-relative
// (find the next/prev target strictly past current scrollLeft), not
// anchor-index-relative — otherwise when the user has scrolled with the
// wheel into the gap between anchor 0 and anchor 1, the button looks
// enabled (scrollLeft > 2) but currentSectionIdx() returns 0 and the
// click is silently a no-op.
(function() {
  const wrap = document.getElementById("tableWrap");
  const leftBtn = document.getElementById("scrollLeft");
  const rightBtn = document.getElementById("scrollRight");
  const EPS = 4;

  leftBtn.addEventListener("click", () => {
    const t = sectionTargets();
    const sl = wrap.scrollLeft;
    let target = 0;
    for (const tg of t) if (tg.left < sl - EPS) target = tg.left;
    console.log("[scroll-left]", { from: sl, to: target, targets: t.map(x => x.left) });
    wrap.scrollTo({ left: target, behavior: "smooth" });
  });
  rightBtn.addEventListener("click", () => {
    const t = sectionTargets();
    const sl = wrap.scrollLeft;
    const max = Math.max(0, wrap.scrollWidth - wrap.clientWidth);
    let target = max;
    for (let i = t.length - 1; i >= 0; i--) if (t[i].left > sl + EPS) target = t[i].left;
    console.log("[scroll-right]", { from: sl, to: target, max, targets: t.map(x => x.left) });
    wrap.scrollTo({ left: target, behavior: "smooth" });
  });
  wrap.addEventListener("scroll", updateScrollBtns);
  window.addEventListener("resize", () => { setupStickyAndScroll(); });
})();

applyLockUI();

// Column-visibility menu for frozen columns.
const FROZEN_COLS = [
  { key: "idx", label: "ลำดับ" },
  { key: "name", label: "ชื่อ - สกุล" },
  { key: "account", label: "เลขที่บัญชีธนาคาร" },
  { key: "nickname", label: "ชื่อเล่น" },
  { key: "position", label: "ตำแหน่ง" },
  { key: "salary", label: "เงินเดือน" },
];
let hiddenCols = new Set();
try { hiddenCols = new Set(JSON.parse(localStorage.getItem("worksheet:hiddenCols") || "[]")); } catch {}

function applyColumnVisibility() {
  document.querySelectorAll("[data-col]").forEach((el) => {
    el.classList.toggle("hidden-col", hiddenCols.has(el.dataset.col));
  });
  setupStickyAndScroll();
}

(function buildColsMenu() {
  const menu = document.getElementById("colsMenu");
  menu.innerHTML = '<div class="menu-title">ซ่อน/แสดงคอลัมน์ค้าง</div>' +
    FROZEN_COLS.map((c) =>
      '<label><input type="checkbox" data-col-toggle="' + c.key + '"' +
      (hiddenCols.has(c.key) ? "" : " checked") + '> ' + c.label + '</label>'
    ).join("");
  menu.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener("change", () => {
      const k = cb.dataset.colToggle;
      if (cb.checked) hiddenCols.delete(k); else hiddenCols.add(k);
      localStorage.setItem("worksheet:hiddenCols", JSON.stringify([...hiddenCols]));
      applyColumnVisibility();
    });
  });
  const btn = document.getElementById("colsBtn");
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    menu.hidden = !menu.hidden;
  });
  document.addEventListener("click", (e) => {
    if (!document.getElementById("colsBox").contains(e.target)) menu.hidden = true;
  });
})();

// Apply visibility once the menu is wired (also re-applied at end of every
// renderRows via the call inserted there).
applyColumnVisibility();

// Fetch the canonical roster index in parallel with the sheet load; if it
// arrives after the first render, re-render so badges appear.
refreshAccountsIndex().then(() => {
  if (currentSheet) renderRows(currentSheet);
  updateRestoreUI();
});

// Print: build a per-employee A4 portrait report on demand. CSS hides
// the editable view and shows #reportRoot only in print media. Auto-
// triggered by ?print=1 (used from /status's 🖨 links).

const REPORT_DEDUCT_ORDER = ["socialSecurity","savings","advance","loan","interest","roomCost","leave","otherDeduction"];
const REPORT_ADD_ORDER = ["commission","breakfast","ot","otherAddition"];
const REPORT_FIELD_LABEL = {
  socialSecurity: "ประกันสังคม 3%",
  savings: "เงินสะสม 5%",
  advance: "เบิกล่วงหน้า",
  loan: "เงินยืม",
  interest: "ดอกเบี้ย 1.50%",
  roomCost: "ค่าห้องพัก",
  leave: "ลากิจ / ลาชม / ลาป่วย",
  otherDeduction: "อื่นๆ",
  commission: "คอมมิชชั่น",
  breakfast: "ทำอาหารเช้า 7%",
  ot: "ค่าโอที",
  otherAddition: "รับอื่นๆ",
};

// Bilingual TH/EN labels for the formal Pay Slip layout. Order mirrors
// the company's Excel template (สลิปเงินเดือน / Pay Slip).
const SLIP_EARNINGS = [
  { key: "salary",         th: "เงินเดือน/ค่าจ้าง",   en: "Salary / Wage" },
  { key: "ot",             th: "ค่าล่วงเวลา/โอที",   en: "Overtime" },
  { key: "commission",     th: "ค่านายหน้า",         en: "Commission" },
  { key: "breakfast",      th: "ค่าเบี้ยเลี้ยง",      en: "Allowance" },
  { key: "otherAddition",  th: "เงินได้อื่นๆ",       en: "Others" },
];
const SLIP_DEDUCTIONS = [
  { key: "socialSecurity", th: "ประกันสังคม",         en: "Social Security" },
  { key: "savings",        th: "เงินสะสมทรัพย์",      en: "Provident Fund" },
  { key: "leave",          th: "ขาด/ลา/มาสาย",       en: "Absence / Leave" },
  { key: "advance",        th: "เบิกล่วงหน้า",        en: "Advance" },
  { key: "loan",           th: "เงินยืม",             en: "Loan" },
  { key: "interest",       th: "ดอกเบี้ย",            en: "Interest" },
  { key: "roomCost",       th: "ค่าห้องพัก",          en: "Room Cost" },
  { key: "otherDeduction", th: "รายการหักอื่นๆ",      en: "Other Deductions" },
];

function slipCells(item, value) {
  const n = num(value);
  const isZero = n <= 0;
  const cls = isZero ? "amt zero" : "amt";
  return \`<td class="lbl">\${escapeHtml(item.th)}<span class="en">\${escapeHtml(item.en)}</span></td>\` +
    \`<td class="\${cls}">\${isZero ? "—" : fmt(n)}</td>\`;
}
function emptyCells() {
  return '<td class="lbl">&nbsp;</td><td class="amt zero">—</td>';
}

function buildPaySlip(r, idx, periodLabel, effectiveDate) {
  // Pair earnings ↔ deductions into a single 4-column table. When the
  // arrays are uneven, the shorter side gets blank cells.
  const rowCount = Math.max(SLIP_EARNINGS.length, SLIP_DEDUCTIONS.length);
  const tableRows = [];
  for (let i = 0; i < rowCount; i++) {
    const e = SLIP_EARNINGS[i];
    const d = SLIP_DEDUCTIONS[i];
    tableRows.push(\`<tr>\${e ? slipCells(e, r[e.key]) : emptyCells()}\${d ? slipCells(d, r[d.key]) : emptyCells()}</tr>\`);
  }

  const totalEarn = SLIP_EARNINGS.reduce((s, it) => s + num(r[it.key]), 0);
  const totalDed = SLIP_DEDUCTIONS.reduce((s, it) => s + num(r[it.key]), 0);
  const net = Math.round((totalEarn - totalDed) * 100) / 100;

  const account = displayAccount(r) || "—";
  const noteHtml = (r.note && r.note.trim())
    ? \`<div class="slip-note"><strong>หมายเหตุ / Remarks:</strong> \${escapeHtml(r.note.trim())}</div>\`
    : "";

  const empName = r.accountName || "—";
  const position = r.position
    ? r.position + (r.nickname ? \` (\${r.nickname})\` : "")
    : (r.nickname || "—");

  return \`<div class="pay-slip">
    <div class="slip-header">
      <div class="slip-company">
        <div class="name-th">บริษัท สายชล เฮอริเทจ จำกัด</div>
        <div class="name-en">SAICHON HERITAGE CO., LTD.</div>
        <div class="addr">33 ถ.ชนเกษม ต.ตลาด อ.เมือง จ.สุราษฎร์ธานี</div>
        <div class="tax">เลขผู้เสียภาษี 0845557003413</div>
      </div>
      <div class="slip-title">
        <div class="th">สลิปเงินเดือน</div>
        <div class="en">PAY SLIP</div>
      </div>
    </div>

    <div class="slip-emp">
      <div class="field">
        <span class="lbl">ชื่อพนักงาน <span class="en">/ Emp. Name</span></span>
        <span class="val">\${escapeHtml(empName)}</span>
      </div>
      <div class="field">
        <span class="lbl">รอบเงินเดือน <span class="en">/ Payroll Period</span></span>
        <span class="val">\${escapeHtml(periodLabel || "—")}</span>
      </div>
      <div class="field">
        <span class="lbl">ตำแหน่ง <span class="en">/ Position</span></span>
        <span class="val">\${escapeHtml(position)}</span>
      </div>
      <div class="field">
        <span class="lbl">วันที่ชำระ <span class="en">/ Payment Date</span></span>
        <span class="val">\${escapeHtml(effectiveDate || "—")}</span>
      </div>
      <div class="field" style="grid-column: 1 / -1">
        <span class="lbl">เลขที่บัญชี <span class="en">/ Bank Account</span></span>
        <span class="val acct">\${escapeHtml(account)}</span>
      </div>
    </div>

    <table class="slip-table">
      <thead>
        <tr>
          <th>รายการเงินได้<span class="en">Earnings</span></th>
          <th class="amt-col">จำนวน</th>
          <th>รายการหัก<span class="en">Deduction</span></th>
          <th class="amt-col">จำนวน</th>
        </tr>
      </thead>
      <tbody>
        \${tableRows.join("")}
      </tbody>
      <tfoot>
        <tr>
          <td class="lbl">รวมเงินได้<span class="en">Total Earnings</span></td>
          <td class="amt">\${fmt(totalEarn)}</td>
          <td class="lbl">รวมรายการหัก<span class="en">Total Deductions</span></td>
          <td class="amt">\${fmt(totalDed)}</td>
        </tr>
      </tfoot>
    </table>

    <div class="slip-net">
      <div class="label">เงินได้สุทธิ <span class="en">/ Net Pay</span></div>
      <div class="amt">\${fmt(net)}<span class="baht">บาท / THB</span></div>
    </div>

    \${noteHtml}

    <div class="slip-sigs">
      <div class="sig">
        <div class="line">ผู้รับเงิน <span class="en">/ Recipient</span></div>
        <div class="name">( \${escapeHtml(empName)} )</div>
      </div>
      <div class="sig">
        <div class="line">ผู้จ่ายเงิน <span class="en">/ Payer</span></div>
        <div class="name">(.....................................)</div>
      </div>
    </div>
  </div>\`;
}

function buildReport(sheet) {
  const period = sheet.period || currentPeriod || "";
  const periodLabel = periodMonthLabelTH(period);
  // One slip per row, including zero-pay rows (slip doubles as proof of
  // employment for the period). Skip rows with no name/account number —
  // those are placeholder entries that haven't been filled in yet.
  const rows = sheet.rows.filter((r) => (r.accountName && r.accountName.trim()) || num(r.salary) > 0);
  const slips = rows.map((r, i) => buildPaySlip(r, i, periodLabel, sheet.effectiveDate || "")).join("");
  return slips || \`<div style="padding:20mm;text-align:center;color:#737373;font-size:10pt">ยังไม่มีข้อมูลพนักงานสำหรับเดือน\${escapeHtml(periodLabel)}</div>\`;
}

// Cell helper for the table report. cls is the column-group class
// (deduct / add / calc / frozen / "") which sets the background tint.
function tableCell(v, cls) {
  const n = num(v);
  const klass = cls ? cls + " " : "";
  if (n <= 0) return \`<td class="\${klass}zero">—</td>\`;
  return \`<td class="\${klass.trim()}">\${fmt(n)}</td>\`;
}

function buildTableReport(sheet) {
  const period = sheet.period || currentPeriod || "";
  const periodLabel = periodMonthLabelTH(period);
  // Keep all rows (matches buildReport — see comment there). recipientCount
  // counts only rows that actually get paid this round.
  const allRows = sheet.rows;
  const totalAll = allRows.reduce((s, r) => s + rowTakeHome(r), 0);
  const recipientCount = allRows.filter((r) => rowTakeHome(r) > 0).length;
  const snapId = readonly ? (new URLSearchParams(window.location.search).get("snapshot") || "") : "";
  const title = readonly ? "ตารางสรุปคำขอโอนเงินเดือน (snapshot)" : "ตารางสรุปเงินเดือน";

  const metaParts = [];
  if (periodLabel) metaParts.push(\`<strong>เดือน</strong>\${escapeHtml(periodLabel)}\`);
  if (sheet.effectiveDate) metaParts.push(\`<strong>วันที่เงินเข้าบัญชี</strong>\${escapeHtml(sheet.effectiveDate)}\`);
  if (snapId) metaParts.push(\`<strong>คำขอ</strong><code>\${escapeHtml(snapId)}</code>\`);
  metaParts.push(\`<strong>พิมพ์เมื่อ</strong>\${new Date().toLocaleString("th-TH-u-ca-buddhist")}\`);

  const sums = {};
  const allKeys = ["salary", ...REPORT_DEDUCT_ORDER, ...REPORT_ADD_ORDER];
  for (const k of allKeys) sums[k] = 0;
  let sumDeduct = 0, sumAdd = 0, sumTake = 0;

  // Per-row cells follow the worksheet's data layout exactly:
  // [idx][name][account][nickname][position][salary]                       ← frozen-left
  // [socialSecurity][savings][advance][loan][interest][roomCost][leave]    ← deduct
  // [otherDeduction]                                                        ← deduct (under "หักคอมมิชชั่น" header)
  // [sumDeduct]                                                             ← calc
  // [commission][breakfast][ot][otherAddition]                              ← add
  // [takeHome]                                                              ← calc
  // [note]
  const rows = allRows.map((r, i) => {
    for (const k of allKeys) sums[k] += num(r[k]);
    const ded = REPORT_DEDUCT_ORDER.reduce((s, k) => s + num(r[k]), 0);
    const add = REPORT_ADD_ORDER.reduce((s, k) => s + num(r[k]), 0);
    const take = rowTakeHome(r);
    sumDeduct += ded; sumAdd += add; sumTake += take;
    return \`<tr>
      <td class="idx frozen">\${i + 1}</td>
      <td class="text frozen">\${escapeHtml(r.accountName || "")}</td>
      <td class="acct frozen">\${escapeHtml(displayAccount(r))}</td>
      <td class="text frozen">\${escapeHtml(r.nickname || "")}</td>
      <td class="text frozen">\${escapeHtml(r.position || "")}</td>
      \${tableCell(r.salary, "frozen")}
      \${REPORT_DEDUCT_ORDER.map((k) => tableCell(r[k], "deduct")).join("")}
      \${ded > 0 ? \`<td class="calc">\${fmt(ded)}</td>\` : '<td class="calc zero">—</td>'}
      \${REPORT_ADD_ORDER.map((k) => tableCell(r[k], "add")).join("")}
      <td class="calc">\${fmt(take)}</td>
      <td class="text" title="\${escapeHtml(r.note || "")}">\${escapeHtml(r.note || "")}</td>
    </tr>\`;
  }).join("");

  // Width allocation across 21 columns on A4 landscape (~277mm usable).
  // Frozen identity cols take ~30%, deductions ~32%, additions ~16%,
  // calc + note ~22%. Tweak here if a column regularly truncates.
  const colgroup = \`<colgroup>
    <col style="width:3.2%"><col style="width:11%"><col style="width:7.5%"><col style="width:4.5%"><col style="width:5%"><col style="width:5.3%">
    <col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%">
    <col style="width:4.7%">
    <col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%"><col style="width:4.4%">
    <col style="width:5.5%">
    <col style="width:6.6%">
  </colgroup>\`;

  const generalNotesHtml = (sheet.generalNotes && sheet.generalNotes.trim())
    ? \`<div class="table-notes"><strong>หมายเหตุทั่วไป:</strong> \${escapeHtml(sheet.generalNotes)}</div>\`
    : "";

  // Three-row header mirroring the worksheet exactly: top-level groups
  // "รายการหัก" (8 cols) and "รับอื่นๆ" (2 cols) span their sub-cells;
  // "อื่นๆ" inside the deduct group further splits into 4 leaf cells.
  return \`
    <div class="report-header">
      <h1>\${title}</h1>
      <div class="report-meta">\${metaParts.join(" · ")}</div>
    </div>
    <table>
      \${colgroup}
      <thead>
        <tr>
          <th rowspan="3" class="frozen">ลำดับ</th>
          <th rowspan="3" class="frozen">ชื่อ - สกุล</th>
          <th rowspan="3" class="frozen">เลขที่บัญชี</th>
          <th rowspan="3" class="frozen">ชื่อเล่น</th>
          <th rowspan="3" class="frozen">ตำแหน่ง</th>
          <th rowspan="3" class="frozen">เงินเดือน</th>
          <th colspan="8" class="deduct">รายการหัก</th>
          <th rowspan="3" class="calc">รวม<br>รายการหัก</th>
          <th colspan="2" class="add">รับอื่นๆ</th>
          <th rowspan="3" class="add">ค่าโอที</th>
          <th rowspan="3" class="add">รวมรับอื่นๆ</th>
          <th rowspan="3" class="calc">รวม<br>เงินเดือน</th>
          <th rowspan="3">หมายเหตุ</th>
        </tr>
        <tr>
          <th rowspan="2" class="deduct">ประกันสังคม<span class="hint">3%</span></th>
          <th rowspan="2" class="deduct">เงินสะสม<span class="hint">5%</span></th>
          <th rowspan="2" class="deduct">เบิก<br>ล่วงหน้า</th>
          <th colspan="4" class="deduct">อื่นๆ</th>
          <th rowspan="2" class="deduct">หัก<br>คอมมิชชั่น</th>
          <th rowspan="2" class="add">คอมมิชชั่น</th>
          <th rowspan="2" class="add">ทำอาหาร<br>เช้า<span class="hint">7%</span></th>
        </tr>
        <tr>
          <th class="deduct">เงินยืม</th>
          <th class="deduct">ดอกเบี้ย<span class="hint">1.50%</span></th>
          <th class="deduct">ค่า<br>ห้องพัก</th>
          <th class="deduct">ลากิจ /<br>ลาชม /<br>ลาป่วย</th>
        </tr>
      </thead>
      <tbody>\${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="5" class="text frozen" style="text-align:right">รวม</td>
          <td class="frozen">\${fmt(sums.salary)}</td>
          \${REPORT_DEDUCT_ORDER.map((k) => \`<td class="deduct">\${sums[k] > 0 ? fmt(sums[k]) : '<span class="zero">—</span>'}</td>\`).join("")}
          <td class="calc">\${fmt(sumDeduct)}</td>
          \${REPORT_ADD_ORDER.map((k) => \`<td class="add">\${sums[k] > 0 ? fmt(sums[k]) : '<span class="zero">—</span>'}</td>\`).join("")}
          <td class="calc">\${fmt(sumTake)}</td>
          <td></td>
        </tr>
      </tfoot>
    </table>
    <div class="table-summary">
      <span><strong>จำนวนผู้รับโอน</strong>\${recipientCount} คน</span>
      <span class="grand">รวมยอดโอน \${fmt(totalAll)}</span>
    </div>
    \${generalNotesHtml}
  \`;
}

function setPrintMode(mode) {
  document.body.classList.remove("print-cards", "print-table");
  document.body.classList.add(\`print-\${mode}\`);
  const root = document.getElementById("reportRoot");
  root.classList.remove("mode-cards", "mode-table");
  root.classList.add(\`mode-\${mode}\`);
}

// Fit the table-mode report to one A4 landscape page. Two regimes:
//   • Content taller than page → uniform shrink via transform (--print-scale).
//   • Content shorter than page → distribute remaining height into each
//     <tr> via inline style so the table reaches the bottom margin.
//
// Measurement happens off-screen at the exact print width with the same
// CSS in effect (the report styles live outside @media print so they
// apply during the measurement reveal).
function fitTableToOnePage() {
  const root = document.getElementById("reportRoot");
  // Match the @page landscape-page rule: 3mm margin all sides.
  const PAGE_W_MM = 291; // 297mm A4 landscape − 3mm × 2
  const PAGE_H_MM = 204; // 210mm                − 3mm × 2
  const MM_PER_PX = 25.4 / 96;

  // Reset previous measurements + inline row heights so a re-print starts clean.
  root.style.removeProperty("--print-scale");
  root.querySelectorAll("tbody tr").forEach((tr) => { tr.style.height = ""; });

  // Reveal off-screen at the print width so layout matches the page.
  const prev = root.getAttribute("style") || "";
  root.setAttribute(
    "style",
    \`display:block!important;position:fixed;left:0;top:0;width:\${PAGE_W_MM}mm;visibility:hidden;transform:none;\`
  );
  void root.offsetHeight; // force layout

  const totalH = root.scrollHeight * MM_PER_PX;
  const headerH = (root.querySelector(".report-header")?.offsetHeight || 0) * MM_PER_PX;
  const summaryH = (root.querySelector(".table-summary")?.offsetHeight || 0) * MM_PER_PX;
  const notesH = (root.querySelector(".table-notes")?.offsetHeight || 0) * MM_PER_PX;
  const theadH = (root.querySelector("thead")?.offsetHeight || 0) * MM_PER_PX;
  const tfootH = (root.querySelector("tfoot")?.offsetHeight || 0) * MM_PER_PX;
  const trList = root.querySelectorAll("tbody tr");
  const dataRows = trList.length || 1;

  root.setAttribute("style", prev);

  if (totalH > PAGE_H_MM) {
    // Overflow: shrink uniformly. Floor at 0.45 to keep glyphs legible.
    const scale = Math.max(0.45, PAGE_H_MM / totalH);
    root.style.setProperty("--print-scale", String(scale));
    console.log("[print fit-table] shrink", { totalH: totalH.toFixed(1), scale: scale.toFixed(3) });
  } else {
    // Underfill: distribute remaining vertical space across data rows
    // via inline tr.style.height. 6mm safety against rounding + Chrome's
    // print-dialog options inserting their own header/footer chrome.
    const availForBody = PAGE_H_MM - headerH - summaryH - notesH - theadH - tfootH - 6;
    const targetRowH = Math.max(4, availForBody / dataRows);
    trList.forEach((tr) => { tr.style.height = \`\${targetRowH.toFixed(2)}mm\`; });
    console.log("[print fit-table] expand", {
      totalH: totalH.toFixed(1), dataRows, targetRowH: targetRowH.toFixed(2),
    });
  }
}

document.getElementById("printBtn").addEventListener("click", () => {
  if (!currentSheet) return;
  setPrintMode("cards");
  document.getElementById("reportRoot").innerHTML = buildReport(currentSheet);
  window.print();
});

document.getElementById("printTableBtn").addEventListener("click", () => {
  if (!currentSheet) return;
  setPrintMode("table");
  document.getElementById("reportRoot").innerHTML = buildTableReport(currentSheet);
  fitTableToOnePage();
  window.print();
});

// Capture canvas → JPEG Blob. Tries the native toBlob first (cheapest);
// falls back to toDataURL + fetch when toBlob returns null (happens when
// html2canvas taints the canvas with cross-origin font/resource hits).
async function canvasToJpegBlob(canvas, quality = 0.92) {
  const native = await new Promise((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", quality),
  );
  if (native) return native;
  const dataUrl = canvas.toDataURL("image/jpeg", quality);
  const res = await fetch(dataUrl);
  return await res.blob();
}

// Render the report at the print width into a TEMPORARY in-flow node
// (briefly visible at the top of the page — html2canvas captures
// position:fixed/absolute elements unreliably). Result is one JPG with
// the entire report at native size: 291mm wide for tables, 180mm for
// cards. scale: 2 for crisp text on retina screens.
async function saveAsImage(mode) {
  if (!currentSheet) return;
  const buttonId = mode === "table" ? "saveTableBtn" : "saveCardsBtn";
  const btn = document.getElementById(buttonId);
  const prevText = btn.textContent;
  btn.disabled = true;
  btn.textContent = "กำลังบันทึก…";

  // Build the report into a SEPARATE detached div so we don't fight with
  // #reportRoot's screen visibility. Once we're done, we just remove it.
  const widthMM = mode === "table" ? 291 : 180;
  const host = document.createElement("div");
  host.id = "reportRoot";
  host.classList.add(\`mode-\${mode}\`);
  host.style.cssText =
    \`display:block!important;position:absolute;left:0;top:0;width:\${widthMM}mm;background:#fff;z-index:99999;\`;
  host.innerHTML = mode === "table" ? buildTableReport(currentSheet) : buildReport(currentSheet);
  document.body.appendChild(host);

  // Force layout + yield a frame so the browser computes the table layout.
  void host.offsetHeight;
  await new Promise((r) => requestAnimationFrame(r));

  try {
    const canvas = await html2canvas(host, {
      backgroundColor: "#ffffff",
      scale: 2,
      useCORS: true,
    });
    const blob = await canvasToJpegBlob(canvas, 0.92);
    if (!blob || blob.size < 1024) throw new Error("output too small");

    // Filename: payroll-{mode}-{period}-{YYYYMMDD-HHmm}.jpg
    const period = currentPeriod || "no-period";
    const now = new Date();
    const stamp = \`\${now.getFullYear()}\${pad(now.getMonth()+1)}\${pad(now.getDate())}-\${pad(now.getHours())}\${pad(now.getMinutes())}\`;
    const filename = \`payroll-\${mode}-\${period}-\${stamp}.jpg\`;

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 200);
  } catch (e) {
    showError("บันทึกรูปไม่สำเร็จ: " + (e && e.message ? e.message : e));
  } finally {
    if (host.parentNode) host.parentNode.removeChild(host);
    btn.disabled = false;
    btn.textContent = prevText;
  }
}

document.getElementById("saveCardsBtn").addEventListener("click", () => saveAsImage("cards"));
document.getElementById("saveTableBtn").addEventListener("click", () => saveAsImage("table"));

// Auto-print on ?print=1 — call after the sheet finishes rendering. We
// hook a one-shot below in the bootstrap section after loadPeriod /
// loadSnapshot resolves.
const autoPrint = new URLSearchParams(window.location.search).get("print") === "1";

// Wire unlock-past button. One-shot per period: clicking flips the body
// class + banner; navigating to another period (or reloading) re-applies
// the lock automatically via applyPastLockState() in loadPeriod().
document.getElementById("unlockPast").addEventListener("click", () => {
  pastLocked = false;
  document.body.classList.remove("past-locked");
  document.getElementById("pastBannerLocked").hidden = true;
  document.getElementById("pastMonthName2").textContent =
    document.getElementById("pastMonthName").textContent;
  document.getElementById("pastBannerUnlocked").hidden = false;
});

function maybeAutoPrint() {
  if (!autoPrint || !currentSheet) return;
  // Defer one tick so the layout settles after renderRows().
  // Mode is picked from ?print=cards|table; defaults to cards.
  const mode = new URLSearchParams(window.location.search).get("print") === "table" ? "table" : "cards";
  setTimeout(() => {
    setPrintMode(mode);
    const root = document.getElementById("reportRoot");
    root.innerHTML = mode === "table" ? buildTableReport(currentSheet) : buildReport(currentSheet);
    if (mode === "table") fitTableToOnePage();
    window.print();
  }, 250);
}

if (readonly) {
  loadSnapshot(snapshotId).then(maybeAutoPrint);
} else {
  loadPeriod(periodSelect.value).then(() => { refreshHistory(); maybeAutoPrint(); });
}
</script>
</body>
</html>`;
