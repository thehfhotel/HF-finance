import { fmt0 } from '../../../lib/format';

/**
 * Bangkok is the only clock this page reads.
 *
 * Server instants are ISO UTC; shifting by +07:00 and reading the UTC parts is
 * the client-side twin of `AT TIME ZONE 'Asia/Bangkok'`. `lib/format`'s
 * `formatThaiDate` slices the raw ISO date instead, which is a different day
 * for anything stamped after 17:00 UTC — fine for a `YYYY-MM-DD` receipt date,
 * wrong for an instant.
 *
 * Every elapsed figure is measured against `meta.now` (the server clock at
 * query time), never `Date.now()`, so two people looking at the same payload
 * read the same "ค้าง 12 นาที".
 */

const BKK_OFFSET_MS = 7 * 3_600_000;
const DAY_MS = 86_400_000;

const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

/** A Date whose UTC parts are the Bangkok wall clock. */
function bkk(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return new Date(t + BKK_OFFSET_MS);
}

/** Epoch ms, or 0 for a missing/invalid instant — sort keys only. */
export function ms(iso: string | null | undefined): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  return Number.isFinite(t) ? t : 0;
}

/** `14 ส.ค.` */
export function thaiDate(iso: string | null | undefined): string {
  const d = bkk(iso);
  if (!d) return '';
  return `${d.getUTCDate()} ${THAI_MONTHS[d.getUTCMonth()]}`;
}

/** `11:05`, Bangkok. */
export function thaiTime(iso: string | null | undefined): string {
  const d = bkk(iso);
  if (!d) return '';
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

/** Compact baht for aggregates — chart labels, tiles, chips. Drill rows use
 *  the `Money` primitive instead, satang and all. */
export function baht(value: number): string {
  return `฿${fmt0(value)}`;
}

/** `45 นาที` · `6.5 ชม.` · `1.4 วัน`. Null (a suppressed median) prints `—`. */
export function thaiDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const hours = seconds / 3600;
  if (hours < 1) return `${Math.round(seconds / 60)} นาที`;
  if (hours < 24) return `${hours < 10 ? hours.toFixed(1) : String(Math.round(hours))} ชม.`;
  return `${(hours / 24).toFixed(1)} วัน`;
}

/** Whole days between an instant and the server clock, floored at 0. */
export function daysSince(iso: string | null | undefined, nowIso: string): number {
  const from = ms(iso);
  if (from === 0) return 0;
  return Math.max(0, Math.floor((ms(nowIso) - from) / DAY_MS));
}
