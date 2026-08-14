import type { ReactNode } from 'react';
import type { OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_DISPLAY, FONT_UI } from '../../../lib/theme';
import { ZoneHeader, goldMark } from './_shared';
import { baht, thaiTime } from './format';
import type { DrillSelection } from './types';

/**
 * §2 ต้องจัดการตอนนี้ — the live queue.
 *
 * Deliberately outside the period AND outside the branch filter: what is
 * waiting is waiting, whichever window or property the rest of the page is
 * showing. That is what the ตอนนี้ chip means, and why the tiles visibly do
 * not move when a branch chip is pressed.
 */

interface StripSegment {
  key: string;
  label: string;
  count: number;
  total: number;
  /** Index into `theme.chartSeq`. Fixed by the band, not by position in the
   *  drawn strip — an empty band is dropped, and a ramp keyed on the drawn
   *  index would repaint every band beside it. */
  tone: number;
  selected: boolean;
  sel: DrillSelection;
}

interface TileProps {
  theme: Theme;
  label: string;
  dot: string;
  value: number;
  sub: string;
  tone?: 'warn' | 'danger';
  selected: boolean;
  onClick: () => void;
  controls?: string;
  strip?: StripSegment[];
  stripDimmed?: boolean;
  onStrip?: (sel: DrillSelection) => void;
}

function Tile({
  theme,
  label,
  dot,
  value,
  sub,
  tone,
  selected,
  onClick,
  controls,
  strip,
  stripDimmed,
  onStrip,
}: TileProps) {
  const segments = (strip ?? []).filter((s) => s.count > 0);
  return (
    <div
      style={{
        position: 'relative',
        background: selected ? theme.surface2 : theme.surface,
        border: `0.5px solid ${theme.hairline}`,
        borderRadius: 16,
        overflow: 'hidden',
      }}
    >
      <button
        onClick={onClick}
        aria-expanded={selected}
        aria-controls={selected ? controls : undefined}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          width: '100%',
          padding: segments.length > 0 ? '14px 15px 18px' : '14px 15px',
          background: 'none',
          border: 'none',
          textAlign: 'left',
          font: 'inherit',
          cursor: 'pointer',
        }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ width: 6, height: 6, borderRadius: 3, background: dot }} />
          <span style={{ fontFamily: FONT_UI, fontSize: 11.5, color: theme.inkSoft }}>{label}</span>
        </span>
        <span
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 30,
            fontWeight: 400,
            letterSpacing: -1,
            lineHeight: 1.1,
            color: theme.ink,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {value}
        </span>
        <span
          style={{
            fontFamily: FONT_UI,
            fontSize: 11.5,
            fontWeight: tone ? 500 : 400,
            color: tone === 'danger' ? theme.danger : tone === 'warn' ? theme.warn : theme.inkSofter,
          }}
        >
          {sub}
        </span>
      </button>
      {segments.length > 0 && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, display: 'flex', gap: 2 }}>
          {segments.map((segment) => (
            <button
              key={segment.key}
              onClick={() => onStrip?.(segment.sel)}
              aria-label={`${segment.label} ${segment.count} คำขอ`}
              title={`${segment.label} · ${segment.count} คำขอ · ${baht(segment.total)}`}
              style={{
                // flex-grow rather than a width percentage, so the 2px gaps are
                // absorbed instead of pushing the strip past the tile edge.
                flex: `${segment.count} 1 0`,
                minWidth: 6,
                height: '100%',
                background: theme.chartSeq[segment.tone] ?? theme.chartInk,
                opacity: segment.selected || !stripDimmed ? 1 : 0.45,
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                boxShadow: segment.selected ? `inset 0 -2px 0 ${goldMark(theme)}` : 'none',
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface QueueTilesProps {
  theme: Theme;
  stats: OverviewStats;
  drill: DrillSelection | null;
  phone: boolean;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
  slot?: ReactNode;
}

export function QueueTiles({ theme, stats, drill, phone, onDrill, drillId, slot }: QueueTilesProps) {
  const queue = stats.queue;
  const pendingBand = drill?.t === 'queue' && drill.k === 'pending' ? (drill.band ?? null) : null;
  const payingBand = drill?.t === 'queue' && drill.k === 'paying' ? (drill.band ?? null) : null;
  const firstPaying = queue.paying.ids.length > 0 ? stats.bundles[queue.paying.ids[0]] : undefined;

  return (
    <div>
      <ZoneHeader theme={theme} title="ต้องจัดการตอนนี้" scope />
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: phone ? 'repeat(2, minmax(0, 1fr))' : 'repeat(auto-fit, minmax(150px, 1fr))',
          gap: 10,
        }}
      >
        <Tile
          theme={theme}
          label="รออนุมัติ"
          dot={theme.statusPending}
          value={queue.pending.count}
          sub={`${baht(queue.pending.total)} · รอนานสุด ${queue.pending.oldestDays} วัน`}
          tone={queue.pending.oldestDays >= 7 ? 'warn' : undefined}
          selected={drill?.t === 'queue' && drill.k === 'pending'}
          controls={drillId}
          onClick={() => onDrill({ t: 'queue', k: 'pending' })}
          stripDimmed={pendingBand !== null}
          onStrip={onDrill}
          strip={queue.pending.ageBands.map((band, i) => ({
            key: band.key,
            label: band.label,
            count: band.count,
            total: band.total,
            tone: i,
            selected: pendingBand === band.key,
            sel: { t: 'queue', k: 'pending', band: pendingBand === band.key ? null : band.key },
          }))}
        />
        <Tile
          theme={theme}
          label="พร้อมจ่าย"
          dot={theme.statusApproved}
          value={queue.approved.count}
          sub={`${baht(queue.approved.total)} พร้อมโอน`}
          selected={drill?.t === 'queue' && drill.k === 'approved'}
          controls={drillId}
          onClick={() => onDrill({ t: 'queue', k: 'approved' })}
        />
        <Tile
          theme={theme}
          label="กำลังโอน"
          dot={theme.statusPaying}
          value={queue.paying.count}
          sub={
            queue.paying.stuck.count > 0
              ? `ติดขัด ${queue.paying.stuck.oldestMinutes} นาที`
              : firstPaying
                ? `${baht(queue.paying.total)} · เริ่ม ${thaiTime(firstPaying.payingSince)}`
                : 'ไม่มีรายการโอน'
          }
          tone={queue.paying.stuck.count > 0 ? 'danger' : undefined}
          selected={drill?.t === 'queue' && drill.k === 'paying'}
          controls={drillId}
          onClick={() => onDrill({ t: 'queue', k: 'paying' })}
          stripDimmed={payingBand !== null}
          onStrip={onDrill}
          strip={
            queue.paying.count > 0
              ? [
                  {
                    key: 'fast',
                    label: 'ใน 10 นาที',
                    count: queue.paying.fast.count,
                    total: queue.paying.fast.total,
                    tone: 0,
                    selected: payingBand === 'fast',
                    sel: { t: 'queue', k: 'paying', band: payingBand === 'fast' ? null : 'fast' },
                  },
                  {
                    key: 'stuck',
                    label: 'เกิน 10 นาที',
                    count: queue.paying.stuck.count,
                    total: queue.paying.stuck.total,
                    tone: 3,
                    selected: payingBand === 'stuck',
                    sel: { t: 'queue', k: 'paying', band: payingBand === 'stuck' ? null : 'stuck' },
                  },
                ]
              : undefined
          }
        />
        <Tile
          theme={theme}
          label="ใบเสร็จลอย"
          dot={theme.inkSofter}
          value={queue.orphanReceipts.count}
          sub={`${baht(queue.orphanReceipts.total)} · เก่าสุด ${queue.orphanReceipts.oldestDays} วัน`}
          selected={drill?.t === 'queue' && drill.k === 'orphan'}
          controls={drillId}
          onClick={() => onDrill({ t: 'queue', k: 'orphan' })}
        />
      </div>
      <div style={{ marginTop: 8, fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>
        แถบสีใต้ไทล์ = ช่วงอายุคำขอ · สีอ่อน→เข้ม คือ รอสั้น→รอนาน (กดแถบเพื่อดูเฉพาะช่วงนั้น)
      </div>
      <div style={{ marginTop: 4, fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>
        ใบเสร็จลอย = ใบเสร็จที่ยังไม่ถูกรวมเป็นคำขอ นับทั้งองค์กร
      </div>
      {slot}
    </div>
  );
}
