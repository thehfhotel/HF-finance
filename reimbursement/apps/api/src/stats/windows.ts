import type { OverviewWindowKey } from '@reimbursement/shared';
import { prisma } from '../db';
import type { BkkDate } from './thai-dates';

/**
 * Window boundaries for the ภาพรวม page, resolved by Postgres in Asia/Bangkok.
 *
 * THE CORRECTNESS ITEM THAT OUTRANKS EVERYTHING ELSE: every `DateTime` column
 * in this schema is `TIMESTAMP(3)` WITHOUT time zone, stamped by a UTC
 * container clock. A naive `date_trunc('day', b."paidAt")` therefore files
 * every event between 00:00 and 06:59 Bangkok into the previous day. The fix is
 * the double cast, applied here and in every query that reads these bounds:
 *
 *   naive-UTC column  →  Bangkok wall clock:  x AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Bangkok'
 *   Bangkok wall clock → naive-UTC, comparable to the columns:
 *                                             x AT TIME ZONE 'Asia/Bangkok' AT TIME ZONE 'UTC'
 *
 * `now()` is already `timestamptz`, so `now() AT TIME ZONE 'Asia/Bangkok'` is
 * the Bangkok wall clock in ONE cast, not two.
 *
 * `date_trunc('week', …)` is ISO — Monday-start — which is the week rule; do
 * not hand-roll a day-of-week offset.
 *
 * The one query below is issued through `$queryRawUnsafe` because a `to_char`
 * format string is a literal, not a value, and there are thirty of them. It
 * takes NO arguments and interpolates nothing but the two module constants
 * directly beneath this comment — no caller input reaches it.
 */

/** One end of a range, in the three shapes the rest of the code needs. */
export interface Boundary {
  /** `YYYY-MM-DD HH:MM:SS.mmm`, naive UTC — bind this into SQL as `::timestamp`. */
  sql: string;
  /** ISO-8601 UTC instant, for the wire. */
  iso: string;
  /** Epoch milliseconds, for TS-side bucketing. */
  ms: number;
  /** Bangkok wall-clock calendar parts, for caption composition. */
  bkk: BkkDate;
}

export interface WindowBounds {
  key: OverviewWindowKey;
  start: Boundary;
  end: Boundary;
  prev: {
    start: Boundary;
    end: Boundary;
    /** Seconds the CLAMPED comparison covers — identical for both ranges. */
    elapsedSec: number;
  };
}

export interface OverviewBounds {
  now: Boundary;
  day: WindowBounds;
  week: WindowBounds;
  month: WindowBounds;
  /** Earliest instant any ladder figure needs: LEAST(month_start, prev_month_start). */
  ladderFloor: Boundary;
  /** Earliest audit_events.createdAt in the DB, ISO, or null when empty. */
  auditCoverageFrom: string | null;
}

interface BoundsRow {
  [key: string]: string | null;
}

/** `YYYY-MM-DD HH:MM:SS.mmm` (naive UTC) + `YYYY-MM-DD HH:MM` (Bangkok). */
function boundary(sqlText: string, bkkText: string): Boundary {
  const iso = `${sqlText.replace(' ', 'T')}Z`;
  return {
    sql: sqlText,
    iso,
    ms: Date.parse(iso),
    bkk: parseBkk(bkkText),
  };
}

function parseBkk(text: string): BkkDate {
  const [datePart, timePart = '00:00'] = text.split(' ');
  const [y, m, d] = datePart.split('-').map(Number);
  const [hh, mi] = timePart.split(':').map(Number);
  return { y, m, d, hh, mi };
}

const UTC_TEXT = `'YYYY-MM-DD HH24:MI:SS.MS'`;
const BKK_TEXT = `'YYYY-MM-DD HH24:MI'`;

/**
 * One round trip that resolves all three windows, all three prior windows and
 * the audit-coverage floor.
 *
 * PREV IS CLAMPED, and the clamp is load-bearing: month-to-date on 31 March
 * would otherwise compare against `prev_start + 30 days`, spilling into March
 * itself and double-counting. `LEAST(prev_start + elapsed, window_start - 1µs)`
 * keeps `prev` strictly disjoint from the current window for all three keys,
 * and `elapsedSec` reports the CLAMPED span so the caption and the arithmetic
 * agree.
 */
export async function loadOverviewBounds(): Promise<OverviewBounds> {
  const rows = await prisma.$queryRawUnsafe<BoundsRow[]>(`
    WITH b AS (
      SELECT now() AT TIME ZONE 'Asia/Bangkok' AS bkk_now
    ),
    w AS (
      SELECT bkk_now,
             date_trunc('day',   bkk_now) AS day_bkk,
             date_trunc('week',  bkk_now) AS week_bkk,
             date_trunc('month', bkk_now) AS month_bkk
      FROM b
    ),
    p AS (
      SELECT w.*,
             (day_bkk  - interval '1 day')  AS prev_day_bkk,
             (week_bkk - interval '7 days') AS prev_week_bkk,
             date_trunc('month', month_bkk - interval '1 day') AS prev_month_bkk,
             (bkk_now - day_bkk)   AS day_elapsed,
             (bkk_now - week_bkk)  AS week_elapsed,
             (bkk_now - month_bkk) AS month_elapsed
      FROM w
    ),
    c AS (
      SELECT p.*,
             LEAST(prev_day_bkk   + day_elapsed,   day_bkk   - interval '1 microsecond') AS prev_day_end_bkk,
             LEAST(prev_week_bkk  + week_elapsed,  week_bkk  - interval '1 microsecond') AS prev_week_end_bkk,
             LEAST(prev_month_bkk + month_elapsed, month_bkk - interval '1 microsecond') AS prev_month_end_bkk
      FROM p
    ),
    f AS (
      SELECT c.*, LEAST(month_bkk, prev_month_bkk) AS ladder_floor_bkk FROM c
    )
    SELECT
      to_char((bkk_now AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS now_utc,
      to_char(bkk_now, ${BKK_TEXT}) AS now_bkk,

      to_char((day_bkk   AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS day_start_utc,
      to_char(day_bkk,   ${BKK_TEXT}) AS day_start_bkk,
      to_char((week_bkk  AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS week_start_utc,
      to_char(week_bkk,  ${BKK_TEXT}) AS week_start_bkk,
      to_char((month_bkk AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS month_start_utc,
      to_char(month_bkk, ${BKK_TEXT}) AS month_start_bkk,

      to_char((prev_day_bkk   AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_day_start_utc,
      to_char(prev_day_bkk,   ${BKK_TEXT}) AS prev_day_start_bkk,
      to_char((prev_week_bkk  AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_week_start_utc,
      to_char(prev_week_bkk,  ${BKK_TEXT}) AS prev_week_start_bkk,
      to_char((prev_month_bkk AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_month_start_utc,
      to_char(prev_month_bkk, ${BKK_TEXT}) AS prev_month_start_bkk,

      to_char((prev_day_end_bkk   AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_day_end_utc,
      to_char(prev_day_end_bkk,   ${BKK_TEXT}) AS prev_day_end_bkk,
      to_char((prev_week_end_bkk  AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_week_end_utc,
      to_char(prev_week_end_bkk,  ${BKK_TEXT}) AS prev_week_end_bkk,
      to_char((prev_month_end_bkk AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS prev_month_end_utc,
      to_char(prev_month_end_bkk, ${BKK_TEXT}) AS prev_month_end_bkk,

      to_char((ladder_floor_bkk AT TIME ZONE 'Asia/Bangkok') AT TIME ZONE 'UTC', ${UTC_TEXT}) AS ladder_floor_utc,
      to_char(ladder_floor_bkk, ${BKK_TEXT}) AS ladder_floor_bkk,

      EXTRACT(EPOCH FROM (prev_day_end_bkk   - prev_day_bkk))::int   AS day_elapsed_sec,
      EXTRACT(EPOCH FROM (prev_week_end_bkk  - prev_week_bkk))::int  AS week_elapsed_sec,
      EXTRACT(EPOCH FROM (prev_month_end_bkk - prev_month_bkk))::int AS month_elapsed_sec,

      -- No AT TIME ZONE here: "createdAt" is TIMESTAMP without time zone and
      -- the cast would promote it to timestamptz, which to_char then renders in
      -- the session TimeZone before the literal Z is appended. Every other read
      -- of these naive columns formats them directly; a server with timezone=
      -- set would otherwise shift only this one and flip decisions.auditCovered.
      (SELECT to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
       FROM audit_events ORDER BY "createdAt" ASC LIMIT 1) AS audit_coverage_from
    FROM f
  `);

  const row = rows[0];
  if (!row) throw new Error('Failed to resolve overview window bounds');

  const text = (key: string): string => {
    const value = row[key];
    if (value === null || value === undefined) {
      throw new Error(`Missing window bound: ${key}`);
    }
    return String(value);
  };

  const now = boundary(text('now_utc'), text('now_bkk'));

  const build = (key: OverviewWindowKey, prefix: string, elapsedKey: string): WindowBounds => ({
    key,
    start: boundary(text(`${prefix}_start_utc`), text(`${prefix}_start_bkk`)),
    end: now,
    prev: {
      start: boundary(text(`prev_${prefix}_start_utc`), text(`prev_${prefix}_start_bkk`)),
      end: boundary(text(`prev_${prefix}_end_utc`), text(`prev_${prefix}_end_bkk`)),
      elapsedSec: Number(row[elapsedKey] ?? 0),
    },
  });

  return {
    now,
    day: build('day', 'day', 'day_elapsed_sec'),
    week: build('week', 'week', 'week_elapsed_sec'),
    month: build('month', 'month', 'month_elapsed_sec'),
    ladderFloor: boundary(text('ladder_floor_utc'), text('ladder_floor_bkk')),
    auditCoverageFrom: row.audit_coverage_from ? String(row.audit_coverage_from) : null,
  };
}
