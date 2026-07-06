import { useEffect, useState } from 'react';
import type { PlReport, RevenueFigures } from '@reimbursement/shared';
import { PL_HISTORY } from '@reimbursement/shared';
import type { Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { fmtN } from '../../lib/format';
import { api } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { IconBtn, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { MonthSwitcher, currentMonth, thaiMonthLabel } from './_shared';

interface PlReportScreenProps {
  theme: Theme;
  nav: Nav;
  initialMonth?: string;
}

const FIRST_MONTH = PL_HISTORY[0]?.month ?? '2024-01';

/**
 * งบกำไรขาดทุน — the monthly P&L in the accountant's paper-sheet layout.
 * Historic months render the static transcription (read-only); live months
 * are computed from the ledger, with editable revenue figures.
 */
export function PlReportScreen({ theme, nav, initialMonth }: PlReportScreenProps) {
  const [month, setMonth] = useState(initialMonth ?? currentMonth());
  const [report, setReport] = useState<PlReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editingRevenue, setEditingRevenue] = useState(false);
  const [revenueDraft, setRevenueDraft] = useState<Record<keyof RevenueFigures, string>>({
    rooms: '',
    waterBar: '',
    other: '',
  });
  const [savingRevenue, setSavingRevenue] = useState(false);

  const load = (m: string) => {
    setError(null);
    api.pl
      .report(m)
      .then((r) => {
        setReport(r);
        setRevenueDraft({
          rooms: String(r.revenue.rooms || ''),
          waterBar: String(r.revenue.waterBar || ''),
          other: String(r.revenue.other || ''),
        });
        setEditingRevenue(false);
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด'));
  };

  useEffect(() => {
    load(month);
  }, [month]);

  const saveRevenue = async () => {
    setSavingRevenue(true);
    setError(null);
    try {
      await api.pl.saveRevenue(month, {
        rooms: parseFloat(revenueDraft.rooms) || 0,
        waterBar: parseFloat(revenueDraft.waterBar) || 0,
        other: parseFloat(revenueDraft.other) || 0,
      });
      load(month);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSavingRevenue(false);
    }
  };

  const amountCell = (value: number) => (
    <span style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink, whiteSpace: 'nowrap' }}>
      {value > 0 ? fmtN(value) : '-'}
    </span>
  );

  const revenueRow = (label: string, key: keyof RevenueFigures, value: number) => (
    <div key={key} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0' }}>
      <span style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink }}>{label}</span>
      {editingRevenue ? (
        <input
          type="text"
          inputMode="decimal"
          value={revenueDraft[key]}
          onChange={(e) => setRevenueDraft((d) => ({ ...d, [key]: e.target.value.replace(/[^0-9.]/g, '') }))}
          style={{
            width: 140,
            padding: '6px 10px',
            borderRadius: 8,
            border: `0.5px solid ${theme.hairlineStrong}`,
            background: theme.surface,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: theme.ink,
            textAlign: 'right',
            outline: 'none',
          }}
        />
      ) : (
        amountCell(value)
      )}
    </div>
  );

  return (
    <div style={{ paddingBottom: 24 }}>
      <div className="pl-chrome">
        <AppBar
          theme={theme}
          leading={<IconBtn theme={theme} onClick={() => nav({ name: 'ledger', month })}>{Icon.back(theme.ink)}</IconBtn>}
          title="งบกำไรขาดทุน"
        />
        <div style={{ padding: '4px 20px 14px' }}>
          <MonthSwitcher theme={theme} month={month} onChange={setMonth} min={FIRST_MONTH} max={currentMonth()} />
        </div>
      </div>

      {error && (
        <div style={{ padding: '4px 20px 12px', fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>{error}</div>
      )}

      {report && (
        <div id="pl-sheet" style={{ padding: '0 20px' }}>
          <div
            style={{
              background: theme.surface,
              border: `0.5px solid ${theme.hairline}`,
              borderRadius: 18,
              padding: '26px 22px',
            }}
          >
            {/* Sheet header — mirrors the paper layout */}
            <div style={{ textAlign: 'center', marginBottom: 18 }}>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 20, color: theme.ink }}>งบกำไรขาดทุน HF</div>
              <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink, marginTop: 4 }}>
                ประจำเดือน {thaiMonthLabel(report.month)}
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, marginTop: 6 }}>
                {report.source === 'accountant-sheet' ? 'จากงบของสำนักงานบัญชี' : 'จากบัญชีรายจ่ายในระบบ (ยังไม่ปิดงวด)'}
              </div>
            </div>

            {/* Revenue */}
            <div style={{ borderBottom: `1px solid ${theme.hairlineStrong}`, paddingBottom: 8, marginBottom: 12 }}>
              {revenueRow('รายรับโรงแรม', 'rooms', report.revenue.rooms)}
              {revenueRow('รายได้บาร์น้ำ', 'waterBar', report.revenue.waterBar)}
              {revenueRow('รายได้อื่นๆ', 'other', report.revenue.other)}
              <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: 8 }}>
                <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 700, color: theme.ink }}>รวมรายรับ</span>
                <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 700, color: theme.ink }}>
                  {editingRevenue
                    ? fmtN(
                        (parseFloat(revenueDraft.rooms) || 0) +
                          (parseFloat(revenueDraft.waterBar) || 0) +
                          (parseFloat(revenueDraft.other) || 0),
                      )
                    : fmtN(report.revenueTotal)}
                </span>
              </div>
              {report.source === 'ledger' && (
                <div className="pl-chrome" style={{ marginTop: 8 }}>
                  {editingRevenue ? (
                    <div style={{ display: 'flex', gap: 10 }}>
                      <button
                        onClick={saveRevenue}
                        disabled={savingRevenue}
                        style={{
                          flex: 1,
                          padding: '10px 0',
                          borderRadius: 10,
                          border: 'none',
                          background: theme.accent,
                          color: '#fff',
                          fontFamily: FONT_UI,
                          fontSize: 13,
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        {savingRevenue ? 'กำลังบันทึก...' : 'บันทึกรายรับ'}
                      </button>
                      <button
                        onClick={() => {
                          setEditingRevenue(false);
                          load(month);
                        }}
                        style={{
                          padding: '10px 16px',
                          borderRadius: 10,
                          border: `0.5px solid ${theme.hairlineStrong}`,
                          background: 'transparent',
                          color: theme.ink,
                          fontFamily: FONT_UI,
                          fontSize: 13,
                          cursor: 'pointer',
                        }}
                      >
                        ยกเลิก
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setEditingRevenue(true)}
                      style={{
                        width: '100%',
                        padding: '9px 0',
                        borderRadius: 10,
                        border: `0.5px dashed ${theme.hairlineStrong}`,
                        background: 'transparent',
                        color: theme.inkSoft,
                        fontFamily: FONT_UI,
                        fontSize: 13,
                        cursor: 'pointer',
                      }}
                    >
                      กรอก/แก้ไขรายรับเดือนนี้
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Expenses */}
            <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 700, color: theme.danger, marginBottom: 6 }}>
              หัก ค่าใช้จ่าย:-
            </div>
            {report.lines.map((line) => (
              <div
                key={line.code}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  gap: 12,
                  padding: '5px 0 5px 14px',
                }}
              >
                <span style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink }}>{line.label}</span>
                {amountCell(line.amount)}
              </div>
            ))}
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderTop: `1px solid ${theme.hairlineStrong}`,
                marginTop: 8,
                paddingTop: 10,
              }}
            >
              <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 700, color: theme.ink }}>รวมค่าใช้จ่าย</span>
              <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 700, color: theme.ink }}>
                {fmtN(report.expenseTotal)}
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: 12,
                paddingTop: 12,
                borderTop: `3px double ${theme.ink}`,
              }}
            >
              <span style={{ fontFamily: FONT_UI, fontSize: 16, fontWeight: 700, color: theme.ink }}>กำไรสุทธิ</span>
              <span
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 22,
                  fontWeight: 400,
                  color: report.netProfit >= 0 ? theme.success : theme.danger,
                }}
              >
                {report.netProfit < 0 ? '−' : ''}
                {fmtN(Math.abs(report.netProfit))}
              </span>
            </div>
          </div>

          <div className="pl-chrome" style={{ marginTop: 16 }}>
            <PrimaryButton theme={theme} onClick={() => window.print()}>
              พิมพ์ / บันทึก PDF
            </PrimaryButton>
          </div>
        </div>
      )}

      {/* Print: show only the sheet */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #pl-sheet, #pl-sheet * { visibility: visible; }
          #pl-sheet { position: absolute; left: 0; top: 0; width: 100%; padding: 0 !important; }
          #pl-sheet .pl-chrome, .pl-chrome { display: none !important; }
        }
      `}</style>
    </div>
  );
}
