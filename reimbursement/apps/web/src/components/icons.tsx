type IconFn = (color?: string) => React.ReactElement;

export const Icon: Record<string, IconFn> = {
  back: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M12 4l-6 6 6 6" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  plus: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M10 4v12M4 10h12" stroke={c} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  ),
  camera: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 6.5h2.5l1.2-2h6.6l1.2 2H17v9H3v-9z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <circle cx="10" cy="11" r="3" stroke={c} strokeWidth="1.4" />
    </svg>
  ),
  more: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="4" cy="10" r="1.4" fill={c} />
      <circle cx="10" cy="10" r="1.4" fill={c} />
      <circle cx="16" cy="10" r="1.4" fill={c} />
    </svg>
  ),
  check: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 10.5l4 4 8-9" stroke={c} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  chevron: (c = 'currentColor') => (
    <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
      <path d="M7 4l6 6-6 6" stroke={c} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  bell: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 14h10l-1.5-2v-3a3.5 3.5 0 00-7 0v3L5 14z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8.5 16.5a1.5 1.5 0 003 0" stroke={c} strokeWidth="1.4" />
    </svg>
  ),
  receipt: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 3h10v14l-2-1.2-2 1.2-2-1.2-2 1.2L5 17V3z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M8 7h4M8 10h4" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  inbox: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 11.5V15a2 2 0 002 2h10a2 2 0 002-2v-3.5h-3.6l-1 2h-4.8l-1-2H3z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M10 3v6m0 0l-2.2-2.2M10 9l2.2-2.2" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  phone: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <rect x="6" y="2.5" width="8" height="15" rx="2" stroke={c} strokeWidth="1.4" />
      <path d="M9 15h2" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  document: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 3h6l4 4v10H5V3z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 3v4h4" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  trash: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M4 6h12M8 6V4h4v2m-6 0v10h8V6" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  user: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="7" r="3" stroke={c} strokeWidth="1.4" />
      <path d="M3.5 17a6.5 6.5 0 0113 0" stroke={c} strokeWidth="1.4" />
    </svg>
  ),
  bundle: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M3 6.5l7-3 7 3-7 3-7-3z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M3 10l7 3 7-3M3 13.5l7 3 7-3" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  close: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  search: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="9" cy="9" r="5" stroke={c} strokeWidth="1.4" />
      <path d="M13 13l3 3" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  bank: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path d="M2 8L10 3l8 5M3 8h14M5 8v8M9 8v8M11 8v8M15 8v8M2 17h16" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  ),
  attach: (c = 'currentColor') => (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      <path
        d="M14 6l-6 6a2.5 2.5 0 003.5 3.5l7-7a4 4 0 00-5.7-5.7l-7 7a5.5 5.5 0 007.8 7.8l5-5"
        stroke={c}
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  ),
  filter: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M3 5h14M5 10h10M8 15h4" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  // ── Sidebar set ────────────────────────────────────────────────────────────
  /** ภาพรวม — bars, the overview page's own shape. */
  chart: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M3 17h14" stroke={c} strokeWidth="1.4" strokeLinecap="round" />
      <path d="M6 17V9M10 17V4M14 17v-5" stroke={c} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  ),
  /** รออนุมัติ — a clock: something waiting on someone. */
  clock: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke={c} strokeWidth="1.4" />
      <path d="M10 6v4.2l2.6 1.6" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** อนุมัติแล้ว — a ticked circle. */
  checkCircle: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke={c} strokeWidth="1.4" />
      <path d="M6.8 10.2l2.1 2.1 4.3-4.4" stroke={c} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  /** ปฏิเสธ — a crossed circle, deliberately not a bare X. */
  xCircle: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <circle cx="10" cy="10" r="7" stroke={c} strokeWidth="1.4" />
      <path d="M7.6 7.6l4.8 4.8M12.4 7.6l-4.8 4.8" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  ),
  /** รายการใหม่ — a sheet with a folded corner. */
  draft: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M5 3h6l4 4v10H5V3z" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M11 3v4h4" stroke={c} strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  ),
  /** ออกจากระบบ — door with an arrow leaving it. */
  logout: (c = 'currentColor') => (
    <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M8 3H4.5v14H8" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 6.5L15.5 10 12 13.5M15 10H7.5" stroke={c} strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
};
