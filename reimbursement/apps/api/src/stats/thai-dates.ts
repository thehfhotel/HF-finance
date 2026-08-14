import type {
  OverviewActivityEvent,
  OverviewDelta,
  OverviewWindowKey,
} from '@reimbursement/shared';

/**
 * Thai calendar rendering for the ภาพรวม payload.
 *
 * Every caption is composed here rather than with `to_char()` because Thai
 * month abbreviations and the Monday-anchored `จ อ พ พฤ ศ ส อา` weekday letters
 * are in no Postgres locale. The input is always a BANGKOK wall-clock date —
 * the SQL side has already done the timezone shift, so nothing here may touch
 * the process clock or `Date.now()`.
 */

/** A Bangkok wall-clock calendar date. `m` is 1-12. */
export interface BkkDate {
  y: number;
  m: number;
  d: number;
  hh: number;
  mi: number;
}

const THAI_MONTH_ABBR = [
  'ม.ค.',
  'ก.พ.',
  'มี.ค.',
  'เม.ย.',
  'พ.ค.',
  'มิ.ย.',
  'ก.ค.',
  'ส.ค.',
  'ก.ย.',
  'ต.ค.',
  'พ.ย.',
  'ธ.ค.',
] as const;

/** Indexed by `Date.getUTCDay()`, i.e. 0 = Sunday. */
const THAI_WEEKDAY_LETTER = ['อา', 'จ', 'อ', 'พ', 'พฤ', 'ศ', 'ส'] as const;

const WINDOW_LABEL: Record<OverviewWindowKey, string> = {
  day: 'วันนี้',
  week: 'สัปดาห์นี้',
  month: 'เดือนนี้',
};

const PREV_LABEL: Record<OverviewWindowKey, string> = {
  day: 'เทียบเมื่อวาน',
  week: 'เทียบสัปดาห์ก่อน',
  month: 'เทียบเดือนก่อน',
};

const ACTIVITY_LABEL: Record<OverviewActivityEvent, string> = {
  submit: 'ส่งคำขอ',
  approve: 'อนุมัติแล้ว',
  reject: 'ปฏิเสธ',
  pay: 'จ่ายแล้ว',
  // KBIZ is the bank's own product name, used verbatim across this app.
  'pay-via-kbiz': 'สั่งโอนผ่าน KBIZ',
  withdraw: 'ดึงคำขอกลับ',
  'payment-failed': 'โอนไม่สำเร็จ',
};

export function windowLabel(key: OverviewWindowKey): string {
  return WINDOW_LABEL[key];
}

export function prevWindowLabel(key: OverviewWindowKey): string {
  return PREV_LABEL[key];
}

export function thaiMonthAbbr(month: number): string {
  return THAI_MONTH_ABBR[month - 1] ?? '';
}

/**
 * Weekday letter for a Bangkok calendar date. Thailand has no DST, so treating
 * the date as a UTC calendar day is exact — and keeps the host's own timezone
 * out of the answer entirely.
 */
export function thaiWeekday(date: BkkDate): string {
  const dow = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  return THAI_WEEKDAY_LETTER[dow] ?? '';
}

export function sameDay(a: BkkDate, b: BkkDate): boolean {
  return a.y === b.y && a.m === b.m && a.d === b.d;
}

/** `ศ 14 ส.ค.` */
export function dayCaption(date: BkkDate): string {
  return `${thaiWeekday(date)} ${date.d} ${thaiMonthAbbr(date.m)}`;
}

/** `14 ส.ค.` — the same date without its weekday letter. */
export function dateCaption(date: BkkDate): string {
  return `${date.d} ${thaiMonthAbbr(date.m)}`;
}

/** `จ 10 – ศ 14 ส.ค.`, or `จ 28 ก.ค. – ศ 3 ส.ค.` across a month boundary. */
export function weekCaption(start: BkkDate, end: BkkDate): string {
  if (sameDay(start, end)) return dayCaption(start);
  if (start.m === end.m && start.y === end.y) {
    return `${thaiWeekday(start)} ${start.d} – ${thaiWeekday(end)} ${end.d} ${thaiMonthAbbr(end.m)}`;
  }
  return `${thaiWeekday(start)} ${dateCaption(start)} – ${thaiWeekday(end)} ${dateCaption(end)}`;
}

/** `จ–ศ 3 – 7 ส.ค.` — the prior week folds its weekday letters into a prefix. */
export function prevWeekCaption(start: BkkDate, end: BkkDate): string {
  if (sameDay(start, end)) return dayCaption(start);
  const days = `${thaiWeekday(start)}–${thaiWeekday(end)}`;
  if (start.m === end.m && start.y === end.y) {
    return `${days} ${start.d} – ${end.d} ${thaiMonthAbbr(end.m)}`;
  }
  return `${days} ${dateCaption(start)} – ${dateCaption(end)}`;
}

/** `1 – 14 ส.ค.` — month-to-date carries no weekday letters. */
export function monthCaption(start: BkkDate, end: BkkDate): string {
  if (sameDay(start, end)) return dateCaption(start);
  if (start.m === end.m && start.y === end.y) {
    return `${start.d} – ${end.d} ${thaiMonthAbbr(end.m)}`;
  }
  return `${dateCaption(start)} – ${dateCaption(end)}`;
}

export function windowCaption(
  key: OverviewWindowKey,
  start: BkkDate,
  end: BkkDate,
): string {
  if (key === 'day') return dayCaption(start);
  if (key === 'week') return weekCaption(start, end);
  return monthCaption(start, end);
}

export function prevWindowCaption(
  key: OverviewWindowKey,
  start: BkkDate,
  end: BkkDate,
): string {
  if (key === 'day') return dayCaption(start);
  if (key === 'week') return prevWeekCaption(start, end);
  return monthCaption(start, end);
}

/** `8–14 ส.ค.` — a weekly series bucket's drill header. */
export function weeklyBucketCaption(startDay: number, endDay: number, month: number): string {
  return `${startDay}–${endDay} ${thaiMonthAbbr(month)}`;
}

/** `จ่ายแล้ว · 14 ส.ค. 11:05` */
export function activityLabel(event: OverviewActivityEvent, at: BkkDate): string {
  const time = `${String(at.hh).padStart(2, '0')}:${String(at.mi).padStart(2, '0')}`;
  return `${ACTIVITY_LABEL[event]} · ${dateCaption(at)} ${time}`;
}

/** The threshold at which a ratio stops being a percentage and becomes "×". */
const MULTIPLE_THRESHOLD = 5;

/**
 * The comparison chip under a ladder tile.
 *
 * Both strings are composed here so the desktop and phone chips can never word
 * the same comparison differently: `text` names the literal prior range,
 * `shortText` names it by relation. The four non-`pct` modes exist because a
 * percentage against zero, or a 40× jump, is noise rather than information.
 */
export function buildDelta(
  current: number,
  previous: number,
  prevLabel: string,
  prevCaption: string,
): OverviewDelta {
  const compose = (suffix: string): Pick<OverviewDelta, 'text' | 'shortText'> => ({
    text: `เทียบ ${prevCaption} ${suffix}`,
    shortText: `${prevLabel} ${suffix}`,
  });

  if (previous <= 0) {
    return {
      mode: 'no-prev',
      pct: null,
      direction: 'flat',
      ...compose('· ไม่มียอดเทียบ'),
    };
  }
  if (current <= 0) {
    return {
      mode: 'no-current',
      pct: null,
      direction: 'flat',
      ...compose('· ไม่มีการจ่ายออกในช่วงนี้'),
    };
  }
  if (current / previous >= MULTIPLE_THRESHOLD) {
    return {
      mode: 'multiple-up',
      pct: null,
      direction: 'up',
      ...compose('▲ มากกว่า 5 เท่า'),
    };
  }
  if (previous / current >= MULTIPLE_THRESHOLD) {
    return {
      mode: 'multiple-down',
      pct: null,
      direction: 'down',
      ...compose('▼ น้อยกว่า 1 ใน 5'),
    };
  }

  const pct = Math.round((Math.abs(current - previous) / previous) * 100);
  const direction = current > previous ? 'up' : current < previous ? 'down' : 'flat';
  const arrow = current < previous ? '▼' : '▲';
  return { mode: 'pct', pct, direction, ...compose(`${arrow} ${pct}%`) };
}
