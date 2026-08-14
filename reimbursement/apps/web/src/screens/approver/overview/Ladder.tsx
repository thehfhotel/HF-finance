import type { KeyboardEvent } from 'react';
import type { OverviewLadder, OverviewPropertyKey, OverviewStats, OverviewWindowKey } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { PROPERTY_LABELS } from '../../../lib/types';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { Baht, PillToggle, goldMark } from './_shared';
import { baht } from './format';
import type { DrillSelection } from './types';

/**
 * §3 เงินจ่ายออกจริง — the ladder IS the period control.
 *
 * There is no segmented control and no second KPI row anywhere on the page:
 * these three tiles both show the money and choose the window. Tapping an
 * inactive tile switches the window AND opens its requests; tapping the active
 * one toggles its panel. Gold marks the active tile as a 2px rule on the
 * bottom edge — never as a fill.
 *
 * All three amounts ship on every response, so switching repaints instantly
 * and only the breakdowns below wait for the refetch.
 */

const WINDOW_ORDER: OverviewWindowKey[] = ['day', 'week', 'month'];

const PROPERTY_CHIPS: Array<{ key: OverviewPropertyKey; label: string }> = [
  { key: 'all', label: 'ทั้งหมด' },
  { key: 'hf-hotel', label: PROPERTY_LABELS['hf-hotel'] },
  { key: 'hf-ville', label: PROPERTY_LABELS['hf-ville'] },
];

interface LadderProps {
  theme: Theme;
  stats: OverviewStats;
  window: OverviewWindowKey;
  property: OverviewPropertyKey;
  phone: boolean;
  drill: DrillSelection | null;
  onSelectWindow: (key: OverviewWindowKey) => void;
  onSelectProperty: (key: OverviewPropertyKey) => void;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
}

export function Ladder({
  theme,
  stats,
  window,
  property,
  phone,
  drill,
  onSelectWindow,
  onSelectProperty,
  onDrill,
  drillId,
}: LadderProps) {
  const ladder: OverviewLadder = stats.ladder;
  const gold = goldMark(theme);
  const entry = ladder[window];

  const activate = (key: OverviewWindowKey) => onSelectWindow(key);
  const onKey = (event: KeyboardEvent<HTMLDivElement>, key: OverviewWindowKey) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    // A real <button> inside the tile (the delta chip) keeps its own
    // activation; only the tile itself answers here.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    activate(key);
  };

  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: phone ? 8 : 10 }}>
        {WINDOW_ORDER.map((key) => {
          const active = window === key;
          const item = ladder[key];
          const drilled = drill?.t === 'ladder' && drill.win === key;
          return (
            <div
              key={key}
              role="button"
              tabIndex={0}
              aria-pressed={active}
              aria-expanded={drilled}
              aria-controls={drilled ? drillId : undefined}
              onClick={() => activate(key)}
              onKeyDown={(event) => onKey(event, key)}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                gap: 3,
                overflow: 'hidden',
                border: `0.5px solid ${theme.hairline}`,
                borderRadius: 16,
                padding: phone ? '11px 8px 13px' : '13px 14px 15px',
                background: active ? theme.surface2 : 'transparent',
                cursor: 'pointer',
              }}
            >
              <span style={{ fontFamily: FONT_UI, fontSize: phone ? 11 : 11.5, color: theme.inkSoft }}>
                {item.label}
              </span>
              <Baht
                theme={theme}
                value={item.total}
                size={active ? (phone ? 22 : 30) : phone ? 16 : 20}
                weight={400}
                display
                letterSpacing={active ? -0.6 : -0.5}
                color={active ? theme.ink : theme.inkSoft}
              />
              <span
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: phone ? 10.5 : 11,
                  color: theme.inkSofter,
                  fontVariantNumeric: 'tabular-nums',
                }}
              >
                {item.count} คำขอ
              </span>
              {active && (
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    onDrill({ t: 'prev' });
                  }}
                  aria-expanded={drill?.t === 'prev'}
                  aria-controls={drill?.t === 'prev' ? drillId : undefined}
                  style={{
                    marginTop: 3,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    fontFamily: FONT_MONO,
                    fontSize: phone ? 10 : 11,
                    lineHeight: 1.4,
                    color: theme.inkSoft,
                  }}
                >
                  {phone ? item.delta.shortText : item.delta.text}
                </button>
              )}
              {active && (
                <span style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: gold }} />
              )}
            </div>
          );
        })}
      </div>

      <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter, margin: '8px 0 0' }}>
        {entry.caption}
      </div>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', margin: '2px 0 0' }} role="group" aria-label="กรองตามสาขา">
        {PROPERTY_CHIPS.map((chip) => (
          <PillToggle
            key={chip.key}
            theme={theme}
            label={chip.label}
            active={property === chip.key}
            onClick={() => onSelectProperty(chip.key)}
          />
        ))}
      </div>
    </div>
  );
}

/**
 * The phone's 44px collapsed ladder. It appears once the AppBar has scrolled
 * away, so re-scoping from the bottom of the page never costs a scroll up.
 */
export function LadderStickyBar({
  theme,
  ladder,
  window,
  onSelectWindow,
}: {
  theme: Theme;
  ladder: OverviewLadder;
  window: OverviewWindowKey;
  onSelectWindow: (key: OverviewWindowKey) => void;
}) {
  const gold = goldMark(theme);
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        top: 0,
        zIndex: 8,
        height: 44,
        display: 'flex',
        alignItems: 'stretch',
        background: theme.paper,
        borderBottom: `0.5px solid ${theme.hairline}`,
        padding: '0 12px',
      }}
    >
      {WINDOW_ORDER.map((key) => {
        const active = window === key;
        return (
          <button
            key={key}
            onClick={() => onSelectWindow(key)}
            aria-pressed={active}
            style={{
              position: 'relative',
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 1,
              padding: '0 6px',
              background: 'none',
              border: 'none',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            <span style={{ fontFamily: FONT_UI, fontSize: 10, color: theme.inkSofter }}>{ladder[key].label}</span>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 11.5,
                fontWeight: active ? 600 : 400,
                color: active ? theme.ink : theme.inkSoft,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {baht(ladder[key].total)}
            </span>
            {active && (
              <span style={{ position: 'absolute', left: 4, right: 4, bottom: 0, height: 2, background: gold }} />
            )}
          </button>
        );
      })}
    </div>
  );
}
