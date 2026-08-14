import type { OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { Card } from '../../../components/primitives';
import { BarRow, CardHeader, FootNote, ZoneHeader } from './_shared';
import { baht } from './format';
import type { DrillSelection, FlowKey } from './types';

/**
 * §6 เกิดอะไรขึ้นในงวดนี้ — four INDEPENDENT event counts.
 *
 * Each row is bucketed on its own timestamp over its own population, so the
 * four do not share a denominator and this is deliberately not drawn as a
 * funnel. The line under the card says so in as many words, because a stacked
 * four-step chart would imply a progression that does not exist.
 */

const ROWS: Array<{ key: FlowKey; label: string; color: (theme: Theme) => string }> = [
  { key: 'submitted', label: 'ส่งเข้ามาใหม่', color: (t) => t.statusPending },
  { key: 'approved', label: 'อนุมัติแล้ว', color: (t) => t.statusApproved },
  { key: 'paid', label: 'จ่ายออก', color: (t) => t.statusPaid },
  { key: 'rejected', label: 'ปฏิเสธ', color: (t) => t.statusRejected },
];

interface FlowCardProps {
  theme: Theme;
  stats: OverviewStats;
  drill: DrillSelection | null;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
}

export function FlowCard({ theme, stats, drill, onDrill, drillId }: FlowCardProps) {
  const selected = drill?.t === 'flow' ? drill.k : null;
  const max = Math.max(1, ...ROWS.map((row) => stats.flow[row.key].total));

  return (
    <div>
      <ZoneHeader theme={theme} title="เกิดอะไรขึ้นในงวดนี้" />
      <Card theme={theme} padding={16}>
        <CardHeader
          theme={theme}
          title={`เหตุการณ์ในช่วง ${stats.meta.window.caption}`}
          hint="นับตามวันที่เกิดเหตุการณ์"
        />
        {ROWS.map((row) => {
          const group = stats.flow[row.key];
          const color = row.color(theme);
          return (
            <BarRow
              key={row.key}
              theme={theme}
              label={row.label}
              value={group.total}
              max={max}
              valueText={baht(group.total)}
              sub={`${group.count} คำขอ`}
              dot={color}
              fill={color}
              selected={selected === row.key}
              dimmed={selected !== null && selected !== row.key}
              onClick={() => onDrill({ t: 'flow', k: row.key })}
              controls={drillId}
            />
          );
        })}
        <FootNote theme={theme}>แต่ละแถวนับคนละชุดคำขอ ไม่ใช่ขั้นตอนของชุดเดียวกัน</FootNote>
      </Card>
    </div>
  );
}
