// Shared helpers for the expense-ledger (admin) screens.
import { FONT_UI } from '../../lib/theme';
import type { Theme } from '../../lib/types';
import { Icon } from '../../components/icons';

const THAI_MONTHS_FULL = [
  'มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม',
];

/** "2026-07" → "กรกฎาคม 2569" (Buddhist-era year, like the paper sheets). */
export function thaiMonthLabel(month: string): string {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10));
  const name = THAI_MONTHS_FULL[(m ?? 1) - 1] ?? month;
  return `${name} ${y + 543}`;
}

/** Current month as "YYYY-MM" (local time). */
export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** Add N months to a "YYYY-MM" string. */
export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map((v) => parseInt(v, 10));
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return `${ny}-${String(nm).padStart(2, '0')}`;
}

/** Today as "YYYY-MM-DD" (local time). */
export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

interface MonthSwitcherProps {
  theme: Theme;
  month: string;
  onChange: (month: string) => void;
  /** Disable navigating past this month (inclusive upper bound). */
  max?: string;
  /** Disable navigating before this month (inclusive lower bound). */
  min?: string;
}

/** ‹ month › pill used by the dashboard and report screens. */
export function MonthSwitcher({ theme, month, onChange, max, min }: MonthSwitcherProps) {
  const prevDisabled = min !== undefined && addMonths(month, -1) < min;
  const nextDisabled = max !== undefined && addMonths(month, 1) > max;
  const arrowStyle = (disabled: boolean): React.CSSProperties => ({
    width: 40,
    height: 40,
    borderRadius: 20,
    border: `0.5px solid ${theme.hairlineStrong}`,
    background: theme.surface,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.3 : 1,
    padding: 0,
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
      <button
        aria-label="เดือนก่อนหน้า"
        disabled={prevDisabled}
        onClick={() => !prevDisabled && onChange(addMonths(month, -1))}
        style={arrowStyle(prevDisabled)}
      >
        <span style={{ transform: 'rotate(180deg)', display: 'flex' }}>{Icon.chevron(theme.ink)}</span>
      </button>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 16,
          fontWeight: 600,
          color: theme.ink,
          textAlign: 'center',
          flex: 1,
        }}
      >
        {thaiMonthLabel(month)}
      </div>
      <button
        aria-label="เดือนถัดไป"
        disabled={nextDisabled}
        onClick={() => !nextDisabled && onChange(addMonths(month, 1))}
        style={arrowStyle(nextDisabled)}
      >
        {Icon.chevron(theme.ink)}
      </button>
    </div>
  );
}
