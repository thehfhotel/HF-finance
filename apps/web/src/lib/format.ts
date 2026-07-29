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
