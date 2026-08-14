import type { OverviewStats, OverviewWindowKey } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { Card } from '../../../components/primitives';
import { BarRow, CardHeader, ColumnChart, EmptyLine, FootNote } from './_shared';
import { activeSeries, seriesTitle } from './resolveDrill';
import { baht } from './format';
import type { DrillSelection, OverviewViewState } from './types';

/**
 * §4 จ่ายออกรายวัน — one chart at three zoom levels.
 *
 * The granularity is a zoom, not three different charts: เดือนนี้ is one column
 * per elapsed day (five weekly bars on the phone), สัปดาห์นี้ is seven columns,
 * and วันนี้ becomes one bar per payment — because three transfers are not a
 * time series, and at that zoom a bar IS a request, so it opens in one tap.
 */

interface PayoutSeriesProps {
  theme: Theme;
  stats: OverviewStats;
  view: OverviewViewState;
  onDrill: (sel: DrillSelection) => void;
  onOpenBundle: (id: string) => void;
  onJumpWindow: (window: OverviewWindowKey) => void;
  drillId?: string;
}

export function PayoutSeries({
  theme,
  stats,
  view,
  onDrill,
  onOpenBundle,
  onJumpWindow,
  drillId,
}: PayoutSeriesProps) {
  const series = activeSeries(stats, view);
  const selectedKey = view.drill?.t === 'series' ? view.drill.key : null;
  // The hint labels the AXIS, so it spans every column drawn — ghosted future
  // days included. `meta.window.caption` is the ELAPSED range and belongs under
  // the ladder; printing it here would name จ–ศ over a จ–อา chart.
  const first = series.points[0];
  const last = series.points[series.points.length - 1];
  const span = first && last ? `${first.fullLabel} – ${last.fullLabel}` : stats.meta.window.caption;
  const hint =
    view.window === 'day'
      ? 'หนึ่งแท่ง = หนึ่งคำขอ'
      : series.granularity === 'week'
        ? `รายสัปดาห์ · ${span}`
        : span;

  return (
    <Card theme={theme} padding={16}>
      <CardHeader theme={theme} title={seriesTitle(series)} hint={hint} />
      {series.granularity === 'payment' ? (
        series.points.length === 0 ? (
          <EmptyLine
            theme={theme}
            message="วันนี้ยังไม่มีการจ่ายออก"
            jumpLabel="ดูสัปดาห์นี้แทน →"
            onJump={() => onJumpWindow('week')}
          />
        ) : (
          <>
            {series.points.map((point) => (
              <BarRow
                key={point.key}
                theme={theme}
                label={point.label}
                value={point.total}
                max={series.points[0].total}
                valueText={baht(point.total)}
                sub={point.fullLabel}
                onClick={() => onOpenBundle(point.key)}
              />
            ))}
            <FootNote theme={theme}>
              การจ่าย {series.points.length} ครั้งไม่ใช่กราฟเส้นเวลา — แสดงเป็นแท่งรายคำขอแทน แตะแท่ง = เปิดคำขอนั้นเลย
            </FootNote>
          </>
        )
      ) : (
        <>
          <ColumnChart
            theme={theme}
            points={series.points}
            selectedKey={selectedKey}
            onSelect={(key) => onDrill({ t: 'series', key })}
            height={view.phone ? 84 : 96}
            controls={drillId}
          />
          <FootNote theme={theme}>
            วันที่ยังไม่ถึงแสดงเป็นจุดประบนเส้นฐาน · วันที่ไม่มีการจ่ายแสดงเป็นเส้น 1px ไม่ใช่ช่องว่าง
          </FootNote>
        </>
      )}
    </Card>
  );
}
