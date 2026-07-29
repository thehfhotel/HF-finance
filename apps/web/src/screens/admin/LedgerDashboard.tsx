import { useEffect, useState } from 'react';
import type { MonthLedgerSummary } from '@reimbursement/shared';
import { PL_LINE_BY_CODE } from '@reimbursement/shared';
import type { Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { fmt } from '../../lib/format';
import { api } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { Card, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { MonthSwitcher, currentMonth, thaiMonthLabel } from './_shared';

interface LedgerDashboardProps {
  theme: Theme;
  nav: Nav;
  initialMonth?: string;
}

/**
 * เดือนนี้ — the admin's month view of the company expense ledger:
 * total, per-line amounts (admin bills + reimbursement rollup), the
 * recurring-bill completeness checklist, and the raw entries.
 */
export function LedgerDashboard({ theme, nav, initialMonth }: LedgerDashboardProps) {
  const [month, setMonth] = useState(initialMonth ?? currentMonth());
  const [summary, setSummary] = useState<MonthLedgerSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.pl
      .summary(month)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [month]);

  const missing = summary?.checklist.filter((c) => !c.done) ?? [];
  const done = summary?.checklist.filter((c) => c.done) ?? [];

  return (
    <div style={{ paddingBottom: 24 }}>
      <AppBar theme={theme} large title="รายจ่ายบริษัท" subtitle="บัญชีรายจ่าย · HF" />

      <div style={{ padding: '4px 20px 0' }}>
        <MonthSwitcher theme={theme} month={month} onChange={setMonth} max={currentMonth()} />
      </div>

      {error && (
        <div style={{ padding: '16px 20px', fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>
          {error}
        </div>
      )}

      {loading && !summary ? (
        <div style={{ padding: '40px 20px', textAlign: 'center', fontFamily: FONT_UI, color: theme.inkSoft }}>
          กำลังโหลด...
        </div>
      ) : summary ? (
        <div style={{ padding: '16px 20px 0', display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Total */}
          <Card theme={theme}>
            <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, letterSpacing: 1.4, textTransform: 'uppercase' }}>
              รวมรายจ่าย {thaiMonthLabel(month)}
            </div>
            <div style={{ fontFamily: FONT_DISPLAY, fontSize: 40, color: theme.ink, marginTop: 6, letterSpacing: -1 }}>
              {fmt(summary.expenseTotal)}
            </div>
            {summary.receiptsTotal > 0 && (
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 4 }}>
                รวมเบิกคืนพนักงาน {fmt(summary.receiptsTotal)}
              </div>
            )}
          </Card>

          {/* Recurring-bill checklist */}
          <Card theme={theme}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
              <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 600, color: theme.ink }}>
                บิลประจำเดือน
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: missing.length ? theme.warn : theme.success }}>
                {missing.length ? `ขาดอีก ${missing.length} รายการ` : 'ครบแล้ว'}
              </div>
            </div>
            {missing.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: done.length ? 10 : 0 }}>
                {missing.map((item) => (
                  <span
                    key={item.code}
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 12,
                      color: theme.warn,
                      border: `1px dashed ${theme.warn}`,
                      borderRadius: 100,
                      padding: '5px 12px',
                    }}
                  >
                    {item.label}
                  </span>
                ))}
              </div>
            )}
            {done.length > 0 && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {done.map((item) => (
                  <span
                    key={item.code}
                    style={{
                      fontFamily: FONT_UI,
                      fontSize: 12,
                      color: theme.success,
                      background: theme.surface2,
                      borderRadius: 100,
                      padding: '5px 12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    {Icon.check(theme.success)}
                    {item.label}
                  </span>
                ))}
              </div>
            )}
          </Card>

          {/* Per-line totals */}
          {summary.lines.length > 0 && (
            <Card theme={theme} padding={0}>
              <div style={{ padding: '14px 18px 6px', fontFamily: FONT_UI, fontSize: 13, fontWeight: 600, color: theme.ink }}>
                ตามหมวด
              </div>
              {summary.lines.map((line, i) => (
                <div
                  key={line.code}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'baseline',
                    gap: 12,
                    padding: '10px 18px',
                    borderTop: i === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                  }}
                >
                  <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink }}>
                    {line.label}
                    {line.fromReceipts > 0 && (
                      <span style={{ fontSize: 11, color: theme.inkSoft, marginLeft: 6 }}>
                        (เบิกคืน {fmt(line.fromReceipts)})
                      </span>
                    )}
                  </div>
                  <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 600, color: theme.ink, whiteSpace: 'nowrap' }}>
                    {fmt(line.amount)}
                  </div>
                </div>
              ))}
            </Card>
          )}

          {/* Entries */}
          <Card theme={theme} padding={0}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 18px 6px' }}>
              <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 600, color: theme.ink }}>
                บิลที่บันทึกแล้ว ({summary.expenses.length})
              </div>
            </div>
            {summary.expenses.length === 0 ? (
              <div style={{ padding: '6px 18px 16px', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
                ยังไม่มีบิลในเดือนนี้ — กด “บันทึกบิล” เพื่อเริ่ม
              </div>
            ) : (
              summary.expenses.map((expense, i) => (
                <div
                  key={expense.id}
                  onClick={() => nav({ name: 'ledger-entry', edit: expense })}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: 12,
                    padding: '12px 18px',
                    borderTop: i === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {PL_LINE_BY_CODE[expense.plLine]?.label ?? expense.plLine}
                    </div>
                    <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                      {[expense.vendor, expense.paymentMethod === 'cash' ? 'เงินสด' : 'โอน', expense.paid ? null : 'ยังไม่จ่าย']
                        .filter(Boolean)
                        .join(' · ')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, whiteSpace: 'nowrap' }}>
                    {!expense.paid && (
                      <span style={{ fontFamily: FONT_UI, fontSize: 10, color: theme.warn, border: `1px solid ${theme.warn}`, borderRadius: 100, padding: '2px 8px' }}>
                        ค้างจ่าย
                      </span>
                    )}
                    <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 600, color: theme.ink }}>
                      {fmt(expense.amount)}
                    </span>
                  </div>
                </div>
              ))
            )}
          </Card>

          <PrimaryButton theme={theme} onClick={() => nav({ name: 'ledger-report', month })}>
            ดูงบกำไรขาดทุน · {thaiMonthLabel(month)}
          </PrimaryButton>
        </div>
      ) : null}
    </div>
  );
}
