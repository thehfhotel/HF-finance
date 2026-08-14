import type { OverviewSpeedMetric, OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { FootNote, ZoneHeader, goldMark } from './_shared';
import { thaiDuration } from './format';
import type { DrillSelection, OverviewViewState, SpeedMetricKey } from './types';

/**
 * §7 ความเร็วในการทำงาน — "we sat on it" against "the bank was slow".
 *
 * Three separate legs because the two failures need different fixes. A median
 * is suppressed on `lowSample` from the SERVER — the client never re-derives
 * the threshold, so the tile and the panel can never disagree about whether
 * there was enough data. Bundles with a missing timestamp are excluded from
 * `n` rather than counted as zero: a NULL read as 0 makes a growing backlog
 * look like improving speed.
 */

const DEFS: Array<{ key: SpeedMetricKey; label: string; warnAtSec: number }> = [
  { key: 'approval', label: 'รอเราอนุมัติ', warnAtSec: 3 * 86_400 },
  { key: 'payout', label: 'อนุมัติแล้วรอจ่าย', warnAtSec: 3 * 86_400 },
  { key: 'bank', label: 'โอนผ่านธนาคาร', warnAtSec: 86_400 },
];

function metricSub(key: SpeedMetricKey, metric: OverviewSpeedMetric, phone: boolean): string {
  if (phone) return `ค่ากลาง · ${metric.n} คำขอ`;
  if (key === 'bank') return `เฉพาะที่จ่ายผ่าน KBIZ · ${metric.n} คำขอ`;
  return `ช้าสุด 10% · ${thaiDuration(metric.p90Sec)} · จาก ${metric.n} คำขอ`;
}

interface SpeedCardProps {
  theme: Theme;
  stats: OverviewStats;
  view: OverviewViewState;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
}

export function SpeedCard({ theme, stats, view, onDrill, drillId }: SpeedCardProps) {
  const selection = view.drill?.t === 'speed' ? view.drill : null;
  const gold = goldMark(theme);

  return (
    <div>
      <ZoneHeader theme={theme} title="ความเร็วในการทำงาน" />
      <div
        style={{
          display: 'flex',
          border: `0.5px solid ${theme.hairline}`,
          borderRadius: 18,
          background: theme.surface,
          overflow: 'hidden',
        }}
      >
        {DEFS.map((def, index) => {
          const metric = stats.speed[def.key];
          const active = selection?.k === def.key;
          const warn = !metric.lowSample && metric.medianSec !== null && metric.medianSec > def.warnAtSec;
          return (
            <div
              key={def.key}
              style={{
                flex: 1,
                minWidth: 0,
                padding: '14px 15px',
                borderLeft: index === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
              }}
            >
              <button
                onClick={() => onDrill({ t: 'speed', k: def.key })}
                aria-expanded={active}
                aria-controls={active ? drillId : undefined}
                style={{
                  display: 'block',
                  width: '100%',
                  minHeight: 44,
                  textAlign: 'left',
                  background: active ? theme.surface2 : 'none',
                  borderRadius: active ? 10 : 0,
                  padding: active ? '6px 8px' : 0,
                  margin: active ? '-6px -8px' : undefined,
                  border: 'none',
                  font: 'inherit',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'block', fontFamily: FONT_UI, fontSize: 11.5, color: theme.inkSoft }}>
                  {def.label}
                </span>
                {metric.lowSample ? (
                  <>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontFamily: FONT_UI,
                        fontSize: 15,
                        color: theme.inkSofter,
                        lineHeight: 1.15,
                      }}
                    >
                      ข้อมูลน้อยเกินไป
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: theme.inkSofter,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {metric.n} คำขอในช่วงนี้ · ต้องมีอย่างน้อย {stats.meta.lowSampleThreshold}
                    </span>
                  </>
                ) : (
                  <>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontFamily: FONT_UI,
                        fontSize: 26,
                        fontWeight: 400,
                        letterSpacing: -0.6,
                        lineHeight: 1.15,
                        color: warn ? theme.warn : theme.ink,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {thaiDuration(metric.medianSec)}
                    </span>
                    <span
                      style={{
                        display: 'block',
                        marginTop: 3,
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: theme.inkSofter,
                        fontVariantNumeric: 'tabular-nums',
                      }}
                    >
                      {metricSub(def.key, metric, view.phone)}
                    </span>
                  </>
                )}
              </button>
              {!view.phone && def.key !== 'bank' && !metric.lowSample && (
                <div style={{ display: 'flex', gap: 2, marginTop: 12 }}>
                  {metric.buckets.map((bucket, i) => {
                    const bucketActive = active && selection?.bucket === bucket.key;
                    return (
                      <button
                        key={bucket.key}
                        onClick={() =>
                          onDrill({
                            t: 'speed',
                            k: def.key,
                            bucket: bucketActive ? null : bucket.key,
                          })
                        }
                        aria-label={`${bucket.label} ${bucket.count} คำขอ`}
                        style={{
                          flex: 1,
                          minWidth: 0,
                          background: 'none',
                          border: 'none',
                          padding: 0,
                          cursor: 'pointer',
                          textAlign: 'left',
                          opacity: active && selection?.bucket && !bucketActive ? 0.45 : 1,
                        }}
                      >
                        <span
                          style={{
                            display: 'block',
                            marginBottom: 3,
                            fontFamily: FONT_MONO,
                            fontSize: 11,
                            color: theme.inkSoft,
                            fontVariantNumeric: 'tabular-nums',
                          }}
                        >
                          {bucket.count}
                        </span>
                        <span
                          style={{
                            display: 'block',
                            height: 6,
                            borderRadius: 2,
                            background: theme.chartSeq[i] ?? theme.chartInk,
                            opacity: bucket.count > 0 ? 1 : 0.18,
                            boxShadow: bucketActive ? `inset 0 -2px 0 ${gold}` : 'none',
                          }}
                        />
                        <span
                          style={{
                            display: 'block',
                            marginTop: 4,
                            fontFamily: FONT_UI,
                            fontSize: 9.5,
                            color: theme.inkSofter,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                        >
                          {bucket.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <FootNote theme={theme}>ไม่นับคำขอที่ยังไม่อนุมัติหรือถูกปฏิเสธก่อนอนุมัติ — ค่าว่างไม่ถูกนับเป็นศูนย์</FootNote>
    </div>
  );
}
