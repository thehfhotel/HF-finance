import { useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { AppState, BundleStatus, BundleWithDetails, Theme, User } from '../../lib/types';
import type { Nav } from '../../lib/router';
import type { BundleStats, OverviewPropertyKey, OverviewWindowKey } from '../../lib/api';
import { FONT_UI } from '../../lib/theme';
import { Avatar } from '../../components/primitives';
import { AppBar } from '../../components/AppBar';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/icons';
import { OverviewBody } from './overview/OverviewBody';
import { useOverviewStats } from './overview/useOverviewStats';
import { useWindowPreference } from './overview/useWindowPreference';
import type { DrillSelection } from './overview/types';

/** Filters the sidebar/tabs understand — 'draft' is never a bundle status. */
export type OverviewFilter = Exclude<BundleStatus, 'draft'>;

interface OverviewProps {
  theme: Theme;
  /** The inbox's page of bundles. The overview no longer reads it: every
   *  figure, chart and drill row comes from the one `/stats` payload. */
  bundles: BundleWithDetails[];
  /** The boot stats. Kept for the prop contract; the ภาพรวม block is fetched
   *  here, keyed on the window and branch actually on screen. */
  stats?: BundleStats | null;
  /** Open a bundle for review. */
  onOpenBundle: (id: string) => void;
  /** Jump the sidebar/tab to a status list. Omitted on mobile. */
  onSelectFilter?: (filter: OverviewFilter) => void;
  /** Horizontal padding; desktop pane wants more room than a phone. */
  padding?: string;
  /** View state, when the host owns it so a review round-trip restores it. */
  window?: OverviewWindowKey;
  property?: OverviewPropertyKey;
  onWindowChange?: (key: OverviewWindowKey) => void;
  onPropertyChange?: (key: OverviewPropertyKey) => void;
  drill?: DrillSelection | null;
  onDrillChange?: (drill: DrillSelection | null) => void;
  /** Phone only: the ความเคลื่อนไหว footer's route push. */
  onOpenInboxRoute?: () => void;
  phone?: boolean;
  /** The phone's scroll container, for the sticky bar and the two-tap pin. */
  scrollRef?: RefObject<HTMLDivElement | null>;
}

export function ApproverOverview(props: OverviewProps) {
  const { theme, onOpenBundle, onSelectFilter, onOpenInboxRoute, padding, phone = false, scrollRef } = props;

  const [ownWindow, setOwnWindow] = useWindowPreference();
  const [ownProperty, setOwnProperty] = useState<OverviewPropertyKey>('all');
  const [ownDrill, setOwnDrill] = useState<DrillSelection | null>(null);

  const windowKey = props.window ?? ownWindow;
  const property = props.property ?? ownProperty;
  const drill = props.drill !== undefined ? props.drill : ownDrill;
  const setWindow = props.onWindowChange ?? setOwnWindow;
  const setProperty = props.onPropertyChange ?? setOwnProperty;
  const setDrill = props.onDrillChange ?? setOwnDrill;

  const { stats, loading, error } = useOverviewStats(windowKey, property);

  if (!stats) {
    if (loading) {
      return (
        <div style={{ padding, fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>กำลังโหลดภาพรวม…</div>
      );
    }
    return (
      <EmptyState
        theme={theme}
        icon={Icon.bundle}
        title="ยังไม่มีข้อมูล"
        subtext={error ?? 'เมื่อมีคำขอเข้ามา ภาพรวมจะแสดงที่นี่'}
      />
    );
  }

  // The collapsed sticky bar lives inside OverviewBody: it has to run the same
  // window handler as a full ladder tile, and that handler owns the panel state.
  return (
    <OverviewBody
      theme={theme}
      stats={stats}
      phone={phone}
      window={windowKey}
      property={property}
      onSelectWindow={setWindow}
      onSelectProperty={setProperty}
      drill={drill}
      onDrillChange={setDrill}
      onOpenBundle={onOpenBundle}
      onOpenInbox={onSelectFilter}
      onOpenInboxRoute={onOpenInboxRoute}
      padding={padding}
      scrollRef={scrollRef}
    />
  );
}

interface OverviewScreenProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  currentUser: User | null;
  stats?: BundleStats | null;
}

export function Overview({ theme, state, nav, currentUser, stats }: OverviewScreenProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  return (
    <div
      ref={scrollRef}
      style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingBottom: 72, background: theme.paper }}
    >
      <AppBar
        theme={theme}
        large
        subtitle="การเงิน · ผู้อนุมัติ"
        title="ภาพรวม"
        leading={<Avatar theme={theme} initials={currentUser?.initials ?? ''} />}
      />
      <ApproverOverview
        theme={theme}
        bundles={state.bundles}
        stats={stats}
        phone
        scrollRef={scrollRef}
        onOpenBundle={(id) => nav({ name: 'approver-review', id })}
        onOpenInboxRoute={() => nav({ name: 'approver-home' })}
        padding="4px 20px 32px"
      />
    </div>
  );
}
