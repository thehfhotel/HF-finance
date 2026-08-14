import type { BundleStatus, Theme } from '../../../lib/types';
import type { OverviewStats } from '../../../lib/api';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { Card } from '../../../components/primitives';
import { ZoneHeader } from './_shared';
import { DrillRowView } from './DrillRow';
import { ms } from './format';
import type { DrillRow } from './types';

/**
 * §10 ความเคลื่อนไหวล่าสุด — it IS the list, so nothing drills in front of it.
 *
 * Every label is composed server-side, so the desktop rail, the phone list and
 * any panel that shows the same event word it identically. A withdraw has no
 * bundle row left to open — only the audit event survives — so it renders
 * un-navigable rather than as a link into a 404.
 */

interface ActivityListProps {
  theme: Theme;
  stats: OverviewStats;
  phone: boolean;
  /** Rail variant: the card carries its own header instead of a zone label. */
  inRail?: boolean;
  onOpenBundle: (id: string) => void;
  /** Desktop: swap the master-detail pane to a status list. */
  onOpenInbox?: (filter: Exclude<BundleStatus, 'draft' | 'paying'>) => void;
  /** Phone: there is no pane to swap, so the footer pushes the inbox route
   *  instead. Supplied by the screen, never resolved inside `overview/`. */
  onOpenInboxRoute?: () => void;
}

export function ActivityList({
  theme,
  stats,
  phone,
  inRail,
  onOpenBundle,
  onOpenInbox,
  onOpenInboxRoute,
}: ActivityListProps) {
  const rows: DrillRow[] = stats.activity.slice(0, phone ? 6 : 8).map((event, index) => {
    const bundle = event.bundleId !== null ? stats.bundles[event.bundleId] : undefined;
    return {
      key: `${event.at}-${event.bundleId ?? 'withdraw'}-${index}`,
      bundleId: bundle ? bundle.id : null,
      name: event.name,
      meta: `${event.actorName} · ${event.label}`,
      initials: event.actorInitials,
      status: (bundle?.status ?? null) as BundleStatus | null,
      amount: event.amount,
      note: bundle ? null : 'คำขอถูกถอนแล้ว',
      sortDate: ms(event.at),
      wait: ms(event.at),
    };
  });

  return (
    <div>
      {!inRail && <ZoneHeader theme={theme} title="ความเคลื่อนไหว" hint={stats.meta.window.label} />}
      <Card theme={theme} padding={0}>
        {inRail && (
          <div style={{ padding: '13px 15px 11px', borderBottom: `0.5px solid ${theme.hairline}` }}>
            <div style={{ fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 600, color: theme.ink }}>
              ความเคลื่อนไหวล่าสุด
            </div>
            <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter, marginTop: 2 }}>
              {stats.meta.window.label} · แตะเพื่อเปิดคำขอ
            </div>
          </div>
        )}
        {rows.length === 0 ? (
          <div style={{ padding: '18px 15px', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
            ไม่มีความเคลื่อนไหวในช่วงนี้
          </div>
        ) : (
          rows.map((row, i) => (
            // The rail header already carries a hairline, so the first row
            // never draws its own.
            <DrillRowView key={row.key} theme={theme} row={row} onOpen={onOpenBundle} first={i === 0} />
          ))
        )}
        {(onOpenInbox || onOpenInboxRoute) && (
          <div style={{ padding: '11px 15px', borderTop: `0.5px solid ${theme.hairline}` }}>
            <button
              onClick={() => (onOpenInbox ? onOpenInbox('pending') : onOpenInboxRoute?.())}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                minHeight: 44,
                cursor: 'pointer',
                fontFamily: FONT_UI,
                fontSize: 12,
                color: theme.inkSoft,
              }}
            >
              ดูทั้งหมดในกล่องอนุมัติ →
            </button>
          </div>
        )}
      </Card>
    </div>
  );
}
