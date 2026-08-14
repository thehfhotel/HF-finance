import type { ReactNode } from 'react';
import type { OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_UI } from '../../../lib/theme';
import { Card } from '../../../components/primitives';
import {
  BarRow,
  CardHeader,
  CoverageLine,
  EmptyLine,
  FootNote,
  TailRow,
  UnderlineToggle,
  ZoneHeader,
} from './_shared';
import { baht } from './format';
import { breakdownFor, breakdownLimit, foldBreakdown } from './resolveDrill';
import type { BreakdownDim, CatMerKey, DrillOwner, DrillSelection, OverviewViewState } from './types';

/**
 * §5 เงินไปไหน — four cards, one hue, every bar drillable.
 *
 * All four are computed off the same cash-out set as the ladder tile above, so
 * the bars provably add back to it — which is what the ครอบคลุม line under each
 * card prints. Every bar is the same fill at the same tone: rank is carried by
 * length and by order, never by a colour ramp.
 */

const DIM_TITLES: Record<BreakdownDim, string> = {
  cat: 'ตามหมวดหมู่',
  mer: 'ตามร้านค้า',
  sub: 'ตามผู้เบิก',
  prop: 'ตามสาขา',
};

interface BreakdownCardBodyProps {
  theme: Theme;
  stats: OverviewStats;
  view: OverviewViewState;
  dim: BreakdownDim;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
  note?: string;
}

function BreakdownBody({ theme, stats, view, dim, onDrill, drillId, note }: BreakdownCardBodyProps) {
  const folded = foldBreakdown(breakdownFor(stats, dim), dim, breakdownLimit(dim, view.phone));
  const selection = view.drill?.t === 'break' && view.drill.dim === dim ? view.drill : null;
  const max = folded.rows.length > 0 ? folded.rows[0].amount : 1;

  return (
    <>
      {folded.rows.map((row) => (
        <BarRow
          key={row.key}
          theme={theme}
          label={row.label}
          value={row.amount}
          max={max}
          valueText={baht(row.amount)}
          sub={
            dim === 'sub'
              ? `${row.count} คำขอ`
              : dim === 'prop'
                ? `${Math.round(row.share * 100)}%`
                : undefined
          }
          avatarInitials={dim === 'sub' ? (row.initials ?? undefined) : undefined}
          selected={selection !== null && selection.key === row.key && selection.tail !== true}
          dimmed={selection !== null && (selection.key !== row.key || selection.tail === true)}
          onClick={() => onDrill({ t: 'break', dim, key: row.key })}
          controls={drillId}
        />
      ))}
      {folded.tail && (
        <TailRow
          theme={theme}
          label={folded.tail.label}
          amount={folded.tail.amount}
          selected={selection?.tail === true}
          dimmed={selection !== null && selection.tail !== true}
          onClick={() => onDrill({ t: 'break', dim, tail: true })}
          controls={drillId}
        />
      )}
      {folded.rows.length === 0 && <EmptyLine theme={theme} message="ไม่มียอดจ่ายออกในช่วงนี้" />}
      <CoverageLine theme={theme} covered={folded.coverage.covered} windowTotal={folded.coverage.windowTotal} />
      {note && <FootNote theme={theme}>{note}</FootNote>}
    </>
  );
}

interface BreakdownsProps {
  theme: Theme;
  stats: OverviewStats;
  view: OverviewViewState;
  onDrill: (sel: DrillSelection) => void;
  onCatMer: (key: CatMerKey) => void;
  renderSlot: (owner: DrillOwner) => ReactNode;
  /** Registers the node the phone's two-tap pin scrolls to. One CARD per
   *  owner: a single ref around the whole zone would scroll a ตามสาขา tap up
   *  to the เงินไปไหน header, several hundred pixels above the bar tapped. */
  setSectionRef: (...owners: DrillOwner[]) => (node: HTMLDivElement | null) => void;
  drillId?: string;
}

export function Breakdowns({
  theme,
  stats,
  view,
  onDrill,
  onCatMer,
  renderSlot,
  setSectionRef,
  drillId,
}: BreakdownsProps) {
  if (view.phone) {
    // The phone folds หมวดหมู่ and ร้านค้า into one card whose title IS the
    // control — it saves a full screen of scrolling, and the two answer the
    // same question at two grains.
    return (
      <div>
        <ZoneHeader theme={theme} title="เงินไปไหน" hint={stats.meta.window.label} />
        <div ref={setSectionRef('break-catmer', 'break-cat', 'break-mer')}>
          <Card theme={theme} padding={16}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 14 }}>
                {(['cat', 'mer'] as CatMerKey[]).map((key) => (
                  <UnderlineToggle
                    key={key}
                    theme={theme}
                    label={DIM_TITLES[key]}
                    active={view.catmer === key}
                    onClick={() => onCatMer(key)}
                  />
                ))}
              </span>
              <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>5 อันดับแรก</span>
            </div>
            <BreakdownBody
              theme={theme}
              stats={stats}
              view={view}
              dim={view.catmer}
              onDrill={onDrill}
              drillId={drillId}
              note={view.catmer === 'mer' ? 'ชื่อร้านตามที่พนักงานพิมพ์' : undefined}
            />
          </Card>
          {renderSlot('break-catmer')}
        </div>

        <div style={{ marginTop: 12 }} ref={setSectionRef('break-sub')}>
          <Card theme={theme} padding={16}>
            <CardHeader theme={theme} title={DIM_TITLES.sub} hint="5 อันดับแรก" />
            <BreakdownBody theme={theme} stats={stats} view={view} dim="sub" onDrill={onDrill} drillId={drillId} />
          </Card>
          {renderSlot('break-sub')}
        </div>

        <div style={{ marginTop: 12 }} ref={setSectionRef('break-prop')}>
          <Card theme={theme} padding={16}>
            <CardHeader theme={theme} title={DIM_TITLES.prop} hint="สัดส่วนในงวด" />
            <BreakdownBody theme={theme} stats={stats} view={view} dim="prop" onDrill={onDrill} drillId={drillId} />
          </Card>
          {renderSlot('break-prop')}
        </div>
      </div>
    );
  }

  return (
    <div>
      <ZoneHeader theme={theme} title="เงินไปไหน" hint={stats.meta.window.label} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 12 }}>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title={DIM_TITLES.cat} hint="6 อันดับแรก" />
          <BreakdownBody theme={theme} stats={stats} view={view} dim="cat" onDrill={onDrill} drillId={drillId} />
        </Card>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title={DIM_TITLES.mer} hint="6 อันดับแรก" />
          <BreakdownBody
            theme={theme}
            stats={stats}
            view={view}
            dim="mer"
            onDrill={onDrill}
            drillId={drillId}
            note="ชื่อร้านตามที่พนักงานพิมพ์"
          />
        </Card>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title={DIM_TITLES.sub} hint="5 อันดับแรก" />
          <BreakdownBody theme={theme} stats={stats} view={view} dim="sub" onDrill={onDrill} drillId={drillId} />
        </Card>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title={DIM_TITLES.prop} hint="สัดส่วนในงวด" />
          <BreakdownBody theme={theme} stats={stats} view={view} dim="prop" onDrill={onDrill} drillId={drillId} />
        </Card>
      </div>
    </div>
  );
}
