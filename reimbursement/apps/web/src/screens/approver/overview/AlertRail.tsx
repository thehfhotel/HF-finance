import type { OverviewAlert, OverviewBundleRef } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { StatusPill } from '../../../components/primitives';
import { ScopeChip } from './_shared';
import { baht } from './format';
import type { DrillSelection } from './types';

/**
 * §1 แถบเตือน — chrome, not a section.
 *
 * It has no zone header and no empty state: when nothing is wrong it renders
 * nothing at all, so a clean queue looks clean rather than looking like a card
 * that failed to load. There is no dismiss button either — a row leaves when
 * the thing it names is fixed.
 *
 * Window- and property-immune: a stuck transfer is stuck no matter which branch
 * chip or period the page is showing.
 */

const SHOWN = 3;

function alertMeta(alert: OverviewAlert): string {
  if (alert.kind === 'pending-overdue') return `${alert.count} คำขอ · ${baht(alert.total)}`;
  if (alert.kind === 'payment-stuck') return `${baht(alert.total)} · ค้าง ${alert.minutes ?? 0} นาที`;
  return baht(alert.total);
}

interface AlertRailProps {
  theme: Theme;
  alerts: OverviewAlert[];
  bundles: Record<string, OverviewBundleRef>;
  onOpenBundle: (id: string) => void;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
  overdueOpen: boolean;
}

export function AlertRail({
  theme,
  alerts,
  bundles,
  onOpenBundle,
  onDrill,
  drillId,
  overdueOpen,
}: AlertRailProps) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, SHOWN);
  const rest = alerts.length - shown.length;

  return (
    <div>
      <div
        style={{
          background: `${theme.danger}0F`,
          border: `0.5px solid ${theme.hairline}`,
          borderLeft: `2px solid ${theme.danger}`,
          borderRadius: 18,
          overflow: 'hidden',
          marginBottom: 14,
        }}
      >
        {shown.map((alert, i) => {
          // The branch is the KIND, never the id count: one bundle in the 7-day
          // band is still the aggregate alert, and keying off `length === 1`
          // sent it straight to that bundle while the meta beside it still read
          // `1 คำขอ · ฿5,900`.
          const overdue = alert.kind === 'pending-overdue';
          const bundle: OverviewBundleRef | undefined =
            !overdue && alert.bundleIds.length === 1 ? bundles[alert.bundleIds[0]] : undefined;
          const body = `${overdue ? 'คำขอที่รอนานที่สุดในคิว' : (bundle?.name ?? 'คำขอ')}${alert.note ? ` · ${alert.note}` : ''}`;
          return (
            <button
              key={`${alert.kind}-${alert.bundleIds[0] ?? i}`}
              onClick={() =>
                overdue ? onDrill({ t: 'alertOverdue' }) : bundle && onOpenBundle(bundle.id)
              }
              aria-expanded={overdue ? overdueOpen : undefined}
              aria-controls={overdue && overdueOpen ? drillId : undefined}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                minHeight: 44,
                padding: '12px 14px',
                background: 'none',
                // Shorthand FIRST: React writes inline properties in key order,
                // so a `border` after `borderTop` erases the separator.
                border: 'none',
                borderTop: i === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                textAlign: 'left',
                font: 'inherit',
                cursor: 'pointer',
                overflow: 'hidden',
              }}
            >
              {bundle ? (
                <StatusPill status={bundle.status} theme={theme} size="sm" />
              ) : (
                <span style={{ width: 6, height: 6, borderRadius: 3, background: theme.warn, flex: '0 0 auto' }} />
              )}
              <span
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.ink,
                  whiteSpace: 'nowrap',
                  flex: '0 1 auto',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
              >
                {alert.label}
              </span>
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  color: theme.inkSoft,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {body}
              </span>
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  color: theme.inkSoft,
                  fontVariantNumeric: 'tabular-nums',
                  whiteSpace: 'nowrap',
                }}
              >
                {alertMeta(alert)}
              </span>
            </button>
          );
        })}
        {rest > 0 && (
          <div
            style={{
              padding: '8px 14px',
              borderTop: `0.5px solid ${theme.hairline}`,
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSofter,
            }}
          >
            อีก {rest} รายการ
          </div>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          margin: '-6px 0 12px',
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSofter,
        }}
      >
        <ScopeChip theme={theme} />
        แจ้งเตือนตามสถานะจริง ไม่มีปุ่มปิด — จะหายเองเมื่อเรื่องถูกแก้
      </div>
    </div>
  );
}
