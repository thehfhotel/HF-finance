import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import type { ReactNode, RefObject } from 'react';
import type { OverviewPropertyKey, OverviewStats, OverviewWindowKey } from '../../../lib/api';
import type { BundleStatus, Theme } from '../../../lib/types';
import { FONT_MONO } from '../../../lib/theme';
import { ZoneHeader } from './_shared';
import { AlertRail } from './AlertRail';
import { QueueTiles } from './QueueTiles';
import { Ladder, LadderStickyBar } from './Ladder';
import { PayoutSeries } from './PayoutSeries';
import { Breakdowns } from './Breakdowns';
import { FlowCard } from './FlowCard';
import { SpeedCard } from './SpeedCard';
import { DecisionsCard } from './DecisionsCard';
import { OwedCard } from './OwedCard';
import { ActivityList } from './ActivityList';
import { DrillPanel } from './DrillPanel';
import { resolveDrill } from './resolveDrill';
import type { CatMerKey, DrillOwner, DrillSelection, OverviewViewState, SortKey } from './types';
import { sameSelection } from './types';

/**
 * The page: section order, the desktop two-column split with its 340px sticky
 * rail, and the phone's single column.
 *
 * Order is identical on both platforms — แถบเตือน → ต้องจัดการตอนนี้ →
 * เงินจ่ายออกจริง → จ่ายออกรายวัน → เงินไปไหน → เกิดอะไรขึ้นในงวดนี้ →
 * ความเร็วในการทำงาน → ผลการตัดสิน → ใครยังรอเงินอยู่ → ความเคลื่อนไหวล่าสุด —
 * so a phone conversation and a desktop conversation walk the same page.
 *
 * Exactly one panel is open at a time. On desktop it renders into the rail,
 * which is always present (recent activity when nothing is selected), so
 * opening one shifts no layout. On the phone it renders under the card that
 * owns the selection, and the page scrolls that card under the sticky bar so
 * the number and its evidence are adjacent: tap the number, tap the request.
 */

const PAGE_FOOTNOTE = 'ช่วงเวลาตามเวลาไทย · สัปดาห์เริ่มวันจันทร์ · นับตามวันที่เงินออกจริง';
/** Phone: leave the 44px bar plus a hairline of air above the pinned card. */
const PIN_OFFSET_PX = 56;
/** Past this, the AppBar has scrolled away and the ladder collapses to a bar. */
const STICKY_BAR_AT_PX = 150;

export interface OverviewBodyProps {
  theme: Theme;
  stats: OverviewStats;
  phone: boolean;
  window: OverviewWindowKey;
  property: OverviewPropertyKey;
  onSelectWindow: (key: OverviewWindowKey) => void;
  onSelectProperty: (key: OverviewPropertyKey) => void;
  drill: DrillSelection | null;
  onDrillChange: (drill: DrillSelection | null) => void;
  onOpenBundle: (id: string) => void;
  /** Desktop only: hand off to a status pane when a group outgrew its ids. */
  onOpenInbox?: (filter: Exclude<BundleStatus, 'draft' | 'paying'>) => void;
  /** Phone only: the ความเคลื่อนไหว footer's route push, supplied by the
   *  screen — nothing under `overview/` may reach for the router itself. */
  onOpenInboxRoute?: () => void;
  padding?: string;
  /** The phone's scroll container, for the two-tap pin. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function OverviewBody({
  theme,
  stats,
  phone,
  window: windowKey,
  property,
  onSelectWindow,
  onSelectProperty,
  drill,
  onDrillChange,
  onOpenBundle,
  onOpenInbox,
  onOpenInboxRoute,
  padding = '24px 28px 48px',
  scrollRef,
}: OverviewBodyProps) {
  const [sort, setSort] = useState<SortKey | null>(null);
  const [expand, setExpand] = useState(false);
  const [catmer, setCatMer] = useState<CatMerKey>('cat');
  const drillId = `overview-drill-${useId()}`;

  const view: OverviewViewState = { window: windowKey, property, drill, sort, expand, catmer, phone };
  const resolved = drill ? resolveDrill(stats, view, drill) : null;

  // Focus moves to the panel when it opens and comes back to whatever opened
  // it when it closes, so keyboard and screen-reader users are never dropped
  // at the top of the page by a ✕.
  const triggerRef = useRef<HTMLElement | null>(null);
  const setDrill = useCallback(
    (next: DrillSelection | null) => {
      if (next) {
        const active = document.activeElement;
        if (active instanceof HTMLElement) triggerRef.current = active;
      } else {
        triggerRef.current?.focus({ preventScroll: true });
        triggerRef.current = null;
      }
      setSort(null);
      setExpand(false);
      onDrillChange(next);
    },
    [onDrillChange],
  );

  const toggleDrill = useCallback(
    (next: DrillSelection) => setDrill(sameSelection(drill, next) ? null : next),
    [drill, setDrill],
  );

  /** Tapping an inactive tile switches the window AND opens its requests;
   *  tapping the active one toggles its panel. */
  const selectWindow = useCallback(
    (key: OverviewWindowKey) => {
      if (key !== windowKey) {
        onSelectWindow(key);
        setDrill({ t: 'ladder', win: key });
        return;
      }
      toggleDrill({ t: 'ladder', win: key });
    },
    [windowKey, onSelectWindow, setDrill, toggleDrill],
  );

  const jumpWindow = useCallback(
    (key: OverviewWindowKey) => {
      onSelectWindow(key);
      setDrill(null);
    },
    [onSelectWindow, setDrill],
  );

  const selectProperty = useCallback(
    (key: OverviewPropertyKey) => {
      onSelectProperty(key);
      setDrill(null);
    },
    [onSelectProperty, setDrill],
  );

  const toggleOrphan = useCallback(
    (userId: string) => {
      const open = drill?.t === 'queue' && drill.k === 'orphan' ? drill.who : null;
      onDrillChange({ t: 'queue', k: 'orphan', who: open === userId ? null : userId });
    },
    [drill, onDrillChange],
  );

  // ── phone: the collapsed ladder bar, owned HERE so a tile in it runs the
  //    same `selectWindow` as a full tile — switching the window through the
  //    bare setter left the previous window's panel pinned on screen. ────────
  const [barVisible, setBarVisible] = useState(false);
  useEffect(() => {
    const node = scrollRef?.current;
    if (!phone || !node) return;
    const onScroll = () => setBarVisible(node.scrollTop > STICKY_BAR_AT_PX);
    node.addEventListener('scroll', onScroll, { passive: true });
    return () => node.removeEventListener('scroll', onScroll);
  }, [phone, scrollRef]);

  // ── phone: pin the owning card under the sticky bar when a panel opens ──
  const sectionRefs = useRef<Partial<Record<DrillOwner, HTMLDivElement | null>>>({});
  /** One card can own several selections — เงินไปไหน holds all four breakdown
   *  dimensions — so a node registers under every owner it answers for. */
  const setSectionRef =
    (...owners: DrillOwner[]) =>
    (node: HTMLDivElement | null) => {
      owners.forEach((owner) => {
        sectionRefs.current[owner] = node;
      });
    };
  useEffect(() => {
    if (!phone || !resolved) return;
    const container = scrollRef?.current;
    const node = sectionRefs.current[resolved.owner];
    if (!container || !node) return;
    const top = node.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop;
    // Assigned, not animated: pinning is a positioning act, and an instant pin
    // is what prefers-reduced-motion wants anyway.
    container.scrollTop = Math.max(0, top - PIN_OFFSET_PX);
    // The pin belongs to the act of opening a panel, not to every repaint.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drill, phone]);

  // ── desktop: the rail sticks BELOW the sticky ladder, measured not guessed ──
  const stickyRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const [railTop, setRailTop] = useState(0);
  const [stuck, setStuck] = useState(false);

  useLayoutEffect(() => {
    if (phone) return;
    const height = stickyRef.current?.getBoundingClientRect().height ?? 0;
    const next = Math.round(height + 10);
    setRailTop((current) => (current === next ? current : next));
  });

  useEffect(() => {
    if (phone) return;
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setStuck(!entry.isIntersecting), { threshold: 1 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [phone]);

  const panel = resolved ? (
    <DrillPanel
      theme={theme}
      id={drillId}
      drill={resolved}
      sort={sort}
      expand={expand}
      phone={phone}
      onClose={() => setDrill(null)}
      onSort={setSort}
      onExpand={() => setExpand(true)}
      onDrill={toggleDrill}
      onToggleOrphan={toggleOrphan}
      onOpenBundle={onOpenBundle}
      onOpenInbox={onOpenInbox}
      onJumpWindow={jumpWindow}
    />
  ) : null;

  /** On the phone a panel renders under its own card; on desktop it lives in
   *  the rail, so every in-flow slot is empty there. */
  const renderSlot = (owner: DrillOwner): ReactNode =>
    phone && resolved?.owner === owner ? panel : null;

  const alerts = (
    <div ref={setSectionRef('alerts')}>
      <AlertRail
        theme={theme}
        alerts={stats.alerts}
        bundles={stats.bundles}
        onOpenBundle={onOpenBundle}
        onDrill={toggleDrill}
        drillId={drillId}
        overdueOpen={drill?.t === 'alertOverdue'}
      />
      {renderSlot('alerts')}
    </div>
  );

  const queue = (
    <div ref={setSectionRef('queue')}>
      <QueueTiles
        theme={theme}
        stats={stats}
        drill={drill}
        phone={phone}
        onDrill={toggleDrill}
        drillId={drillId}
        slot={renderSlot('queue')}
      />
    </div>
  );

  const ladder = (
    <Ladder
      theme={theme}
      stats={stats}
      window={windowKey}
      property={property}
      phone={phone}
      drill={drill}
      onSelectWindow={selectWindow}
      onSelectProperty={selectProperty}
      onDrill={toggleDrill}
      drillId={drillId}
    />
  );

  const series = (
    <PayoutSeries
      theme={theme}
      stats={stats}
      view={view}
      onDrill={toggleDrill}
      onOpenBundle={onOpenBundle}
      onJumpWindow={jumpWindow}
      drillId={drillId}
    />
  );

  const breakdowns = (
    <Breakdowns
      theme={theme}
      stats={stats}
      view={view}
      onDrill={toggleDrill}
      onCatMer={(key) => {
        setCatMer(key);
        setDrill(null);
      }}
      renderSlot={renderSlot}
      setSectionRef={setSectionRef}
      drillId={drillId}
    />
  );

  const flow = <FlowCard theme={theme} stats={stats} drill={drill} onDrill={toggleDrill} drillId={drillId} />;
  const speed = <SpeedCard theme={theme} stats={stats} view={view} onDrill={toggleDrill} drillId={drillId} />;
  const decisions = (
    <DecisionsCard theme={theme} stats={stats} view={view} onDrill={toggleDrill} drillId={drillId} />
  );
  const owed = <OwedCard theme={theme} stats={stats} drill={drill} onDrill={toggleDrill} drillId={drillId} />;

  const footnote = (
    <div style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: theme.inkSofter, marginTop: 26 }}>
      {PAGE_FOOTNOTE}
    </div>
  );

  if (phone) {
    return (
      <>
        {/* Zero-height sticky anchor: the bar overlays the top of the scroll
            container without ever taking a row of its own in the layout. */}
        <div style={{ position: 'sticky', top: 0, height: 0, zIndex: 8 }}>
          {barVisible && (
            <LadderStickyBar
              theme={theme}
              ladder={stats.ladder}
              window={windowKey}
              onSelectWindow={selectWindow}
            />
          )}
        </div>
        <div style={{ padding }}>
          {alerts}
          {queue}
          <div ref={setSectionRef('ladder')}>
            <ZoneHeader theme={theme} title="เงินจ่ายออกจริง" />
            {ladder}
            {renderSlot('ladder')}
          </div>
          <div ref={setSectionRef('series')} style={{ marginTop: 12 }}>
            {series}
            {renderSlot('series')}
          </div>
          {/* เงินไปไหน registers a ref per CARD from inside `Breakdowns`, so a
              tap in ตามผู้เบิก pins that card and not the zone header. */}
          {breakdowns}
          <div ref={setSectionRef('flow')}>
            {flow}
            {renderSlot('flow')}
          </div>
          <div ref={setSectionRef('speed')}>
            {speed}
            {renderSlot('speed')}
          </div>
          {/* No zone label above these two: their card titles ARE the heading,
              and a label repeating the same words reads as a stutter. */}
          <div ref={setSectionRef('dec')} style={{ marginTop: 26 }}>
            {decisions}
            {renderSlot('dec')}
          </div>
          <div ref={setSectionRef('owed')} style={{ marginTop: 12 }}>
            {owed}
            {renderSlot('owed')}
          </div>
          <ActivityList
            theme={theme}
            stats={stats}
            phone
            onOpenBundle={onOpenBundle}
            onOpenInboxRoute={onOpenInboxRoute}
          />
          {footnote}
        </div>
      </>
    );
  }

  return (
    <div style={{ padding, maxWidth: 1080 }}>
      {alerts}
      {queue}
      <ZoneHeader theme={theme} title="เงินจ่ายออกจริง" />
      <div ref={sentinelRef} style={{ height: 1 }} />
      <div
        ref={stickyRef}
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 6,
          background: theme.paper,
          padding: '2px 0 10px',
          boxShadow: stuck ? `0 0.5px 0 ${theme.hairline}` : 'none',
        }}
      >
        {ladder}
      </div>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) 340px',
          gap: 24,
          alignItems: 'start',
          marginTop: 14,
        }}
      >
        <div>
          {series}
          {breakdowns}
          {/* Sections 6 and 7 take the full column rather than a 2-up: at the
              real 660px width ความเร็ว's three tiles plus their distribution
              strips do not survive 108px apiece. */}
          {flow}
          {speed}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
              gap: 12,
              marginTop: 26,
            }}
          >
            <div>{decisions}</div>
            <div>{owed}</div>
          </div>
          {footnote}
        </div>
        <aside style={{ position: 'sticky', top: railTop }}>
          {/* The rail swaps its whole contents in place, which without a cue
              reads as a jump cut. `key` restarts the fade on every swap; the
              media query is the reduced-motion opt-out. */}
          <style>{`
            @keyframes overview-rail-fade { from { opacity: 0 } to { opacity: 1 } }
            @media (prefers-reduced-motion: reduce) {
              .overview-rail { animation: none !important }
            }
          `}</style>
          <div
            // Keyed on the OWNER, not the path: a nested chip re-scopes the
            // same panel, and remounting there would pull focus off the chip
            // the reader just pressed.
            key={resolved ? `panel-${resolved.owner}` : 'activity'}
            className="overview-rail"
            style={{ animation: 'overview-rail-fade 120ms ease-out' }}
          >
            {panel ?? (
              <ActivityList
                theme={theme}
                stats={stats}
                phone={false}
                inRail
                onOpenBundle={onOpenBundle}
                onOpenInbox={onOpenInbox}
              />
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
