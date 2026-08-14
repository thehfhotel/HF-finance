import type { OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { Card } from '../../../components/primitives';
import { CardHeader, FootNote, goldMark } from './_shared';
import { baht, thaiDate } from './format';
import type { DrillSelection, OverviewViewState } from './types';

/**
 * §8 ผลการตัดสิน — the rate, then the reasons exactly as they were typed.
 *
 * Reject reasons are free text with no category behind them, so they are never
 * bucketed and never charted: five verbatim lines, most frequent first. When
 * the window starts before audit logging did, the rate is `—` rather than a
 * number that would quietly be measured against a shorter period.
 */

interface DecisionsCardProps {
  theme: Theme;
  stats: OverviewStats;
  view: OverviewViewState;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
}

export function DecisionsCard({ theme, stats, view, onDrill, drillId }: DecisionsCardProps) {
  const decisions = stats.decisions;
  const selection = view.drill?.t === 'dec' ? view.drill : null;
  const gold = goldMark(theme);
  const approvedCount = decisions.approved.count;
  const rejectedCount = decisions.rejected.count;
  const total = approvedCount + rejectedCount;
  const approvedPct = total > 0 ? (approvedCount / total) * 100 : 100;
  const rejectedPct = total > 0 ? (rejectedCount / total) * 100 : 0;

  return (
    <Card theme={theme} padding={16}>
      <CardHeader theme={theme} title="ผลการตัดสิน" hint={`ตัดสินใน${stats.meta.window.label}`} />
      {!decisions.auditCovered ? (
        <>
          <div style={{ fontFamily: FONT_UI, fontSize: 26, letterSpacing: -0.6, color: theme.inkSofter }}>—</div>
          <FootNote theme={theme}>ไม่มีข้อมูลก่อน {thaiDate(stats.meta.auditCoverageFrom)}</FootNote>
        </>
      ) : decisions.rate === null ? (
        // The server withholds the ratio under a branch chip: rejecting frees a
        // bundle's receipts, and property lives on the receipt, so ปฏิเสธ stays
        // org-wide while อนุมัติ is sliced. No bar either — it would be the same
        // two populations drawn as one.
        <>
          <div style={{ fontFamily: FONT_UI, fontSize: 26, letterSpacing: -0.6, color: theme.inkSofter }}>—</div>
          <FootNote theme={theme}>
            การปฏิเสธนับทั้งองค์กร แยกตามสาขาไม่ได้ · เลือก “ทุกสาขา” เพื่อดูสัดส่วน
          </FootNote>
        </>
      ) : decisions.lowSample ? (
        <>
          <div style={{ fontFamily: FONT_UI, fontSize: 15, color: theme.inkSofter }}>ข้อมูลน้อยเกินไป</div>
          <FootNote theme={theme}>
            ตัดสินไป {decisions.n} คำขอในช่วงนี้ · ต้องมีอย่างน้อย {stats.meta.lowSampleThreshold}
          </FootNote>
        </>
      ) : (
        <>
          <div
            style={{
              display: 'flex',
              height: 26,
              borderRadius: 7,
              overflow: 'hidden',
              gap: 2,
              background: theme.chartTrack,
            }}
          >
            <button
              onClick={() => onDrill({ t: 'dec', k: 'approved' })}
              aria-label={`อนุมัติ ${approvedCount} คำขอ`}
              aria-expanded={selection?.k === 'approved'}
              aria-controls={selection?.k === 'approved' ? drillId : undefined}
              style={{
                width: `${approvedPct}%`,
                height: '100%',
                display: 'grid',
                placeItems: 'center',
                background: theme.chartInk,
                color: theme.onChartInk,
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT_UI,
                fontSize: 11,
                fontWeight: 600,
                opacity: selection?.k === 'rejected' ? 0.45 : 1,
                boxShadow: selection?.k === 'approved' ? `inset 0 -2px 0 ${gold}` : 'none',
              }}
            >
              {approvedPct >= 12 ? `${Math.round(approvedPct)}%` : ''}
            </button>
            {rejectedCount > 0 && (
              <button
                onClick={() => onDrill({ t: 'dec', k: 'rejected' })}
                aria-label={`ปฏิเสธ ${rejectedCount} คำขอ`}
                aria-expanded={selection?.k === 'rejected'}
                aria-controls={selection?.k === 'rejected' ? drillId : undefined}
                style={{
                  width: `${rejectedPct}%`,
                  height: '100%',
                  display: 'grid',
                  placeItems: 'center',
                  // The second step of the SAME hue, never a second colour, and
                  // a real token rather than a faded `chartInk`: fading flips
                  // the label's contrast the moment the theme does.
                  background: theme.chartInk2,
                  opacity: selection?.k === 'approved' ? 0.45 : 1,
                  color: theme.onChartInk2,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: FONT_UI,
                  fontSize: 11,
                  fontWeight: 600,
                  boxShadow: selection?.k === 'rejected' ? `inset 0 -2px 0 ${gold}` : 'none',
                }}
              >
                {rejectedPct >= 12 ? `${Math.round(rejectedPct)}%` : ''}
              </button>
            )}
          </div>
          {/* One hue in two steps needs a key, or the segments cannot be read
              without hovering — the same key the old ตามสาขา stack carried. */}
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '6px 16px',
              marginTop: 9,
              fontFamily: FONT_UI,
              fontSize: 11.5,
              color: theme.inkSoft,
            }}
          >
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
              <i style={{ width: 6, height: 6, borderRadius: 3, background: theme.chartInk }} />
              อนุมัติ {baht(decisions.approved.total)} · {approvedCount} คำขอ
            </span>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontVariantNumeric: 'tabular-nums' }}>
              <i style={{ width: 6, height: 6, borderRadius: 3, background: theme.chartInk2 }} />
              ปฏิเสธ {baht(decisions.rejected.total)} · {rejectedCount} คำขอ
            </span>
          </div>
          <div
            style={{
              marginTop: 9,
              fontFamily: FONT_UI,
              fontSize: 12.5,
              color: theme.ink,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            ปฏิเสธ {rejectedCount} จาก {decisions.n} · {Math.round(decisions.rate * 100)}%
          </div>
          {decisions.reasons.length > 0 ? (
            <>
              {decisions.reasons.slice(0, view.phone ? 2 : 3).map((reason, index) => {
                const active = selection?.reason === index;
                return (
                  <button
                    key={`${index}-${reason.text}`}
                    onClick={() => onDrill({ t: 'dec', reason: index })}
                    aria-expanded={active}
                    aria-controls={active ? drillId : undefined}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      gap: 12,
                      width: '100%',
                      minHeight: 44,
                      alignItems: 'baseline',
                      padding: active ? '9px 8px' : '9px 0',
                      margin: active ? '0 -8px' : undefined,
                      borderRadius: active ? 8 : 0,
                      background: active ? theme.surface2 : 'none',
                      // Shorthand FIRST: React writes inline properties in key
                      // order, so `border` after `borderTop` resets the rule.
                      border: 'none',
                      borderTop: `0.5px solid ${theme.hairline}`,
                      textAlign: 'left',
                      font: 'inherit',
                      cursor: 'pointer',
                    }}
                  >
                    <span
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        color: theme.inkSoft,
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {reason.text}
                    </span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, color: theme.inkSofter }}>
                      {reason.count}
                    </span>
                  </button>
                );
              })}
              <FootNote theme={theme}>เหตุผลแสดงตามที่พิมพ์จริง ไม่จัดกลุ่มให้</FootNote>
            </>
          ) : (
            <FootNote theme={theme}>ไม่มีการปฏิเสธในช่วงนี้</FootNote>
          )}
        </>
      )}
    </Card>
  );
}
