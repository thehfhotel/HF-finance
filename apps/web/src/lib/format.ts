export const CURRENCY = '฿';

export function fmt(n: number, opts: { sign?: boolean; currency?: string } = {}): string {
  const { sign = false, currency = CURRENCY } = opts;
  const abs = Math.abs(n).toFixed(2);
  const [whole, frac] = abs.split('.');
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign && n < 0 ? '−' : ''}${currency}${w}.${frac}`;
}

export function fmt0(n: number): string {
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function fmtN(n: number): string {
  const [whole, frac] = Math.abs(n).toFixed(2).split('.');
  return whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + '.' + frac;
}

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export function formatThaiDate(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return s ?? '';
  // Accepts both YYYY-MM-DD and ISO datetimes like 2026-04-23T12:34:56.000Z.
  const datePart = s.includes('T') ? s.slice(0, s.indexOf('T')) : s;
  const parts = datePart.split('-');
  if (parts.length !== 3) return s;
  const day = parseInt(parts[2], 10);
  const monthIdx = parseInt(parts[1], 10) - 1;
  if (Number.isNaN(day) || Number.isNaN(monthIdx) || !THAI_MONTHS[monthIdx]) return s;
  return `${day} ${THAI_MONTHS[monthIdx]}`;
}

/**
 * Thai relative time — "5 นาทีที่แล้ว", "2 ชั่วโมงที่แล้ว", "3 วันที่แล้ว" — for
 * timestamps someone glances at right after the fact (a sync, a submit). Past
 * a week it falls back to the absolute Thai date, since "12 วันที่แล้ว" reads
 * worse than a date once it's that stale.
 */
export function formatThaiRelative(s: string | null | undefined): string {
  if (!s || typeof s !== 'string') return '';
  const then = new Date(s).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) return 'เมื่อสักครู่';
  if (diffMs < hour) return `${Math.floor(diffMs / minute)} นาทีที่แล้ว`;
  if (diffMs < day) return `${Math.floor(diffMs / hour)} ชั่วโมงที่แล้ว`;
  if (diffMs < 7 * day) return `${Math.floor(diffMs / day)} วันที่แล้ว`;
  return formatThaiDate(s);
}
