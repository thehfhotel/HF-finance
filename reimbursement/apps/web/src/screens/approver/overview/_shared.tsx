import { useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import type { OverviewSeriesPoint } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_DISPLAY, FONT_MONO, FONT_UI, HF_GOLD } from '../../../lib/theme';
import { Avatar } from '../../../components/primitives';
import { baht } from './format';
import type { ChipTone } from './types';

/**
 * The page's building blocks. Geometry is the app's own — 26px/12px zone
 * margins, 18px card radius, 0.5px hairlines — so a card here and a card on
 * the inbox are the same object.
 *
 * Gold is jewellery: the active ladder rule, the selected mark, today's column
 * cap and the two active toggle underlines. Never a fill, never a bar.
 */

/** The theme carries no mode flag, and gold has to step with the ground it
 *  sits on, so read the paper's luminance rather than guessing. */
export function isDarkTheme(theme: Theme): boolean {
  const hex = theme.paper.replace('#', '');
  if (hex.length !== 6) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

export const goldMark = (theme: Theme): string => (isDarkTheme(theme) ? HF_GOLD[600] : HF_GOLD[700]);

/** Compact baht for aggregates — ฿ demoted, satang dropped. Drill rows use the
 *  `Money` primitive instead. */
export function Baht({
  theme,
  value,
  size = 14,
  weight = 500,
  color,
  display,
  letterSpacing,
}: {
  theme: Theme;
  value: number;
  size?: number;
  weight?: number;
  color?: string;
  /** Headline numbers — ladder tiles, panel header — take the display face. */
  display?: boolean;
  letterSpacing?: number;
}) {
  return (
    <span
      style={{
        fontFamily: display ? FONT_DISPLAY : FONT_UI,
        fontSize: size,
        fontWeight: weight,
        color: color ?? theme.ink,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: letterSpacing ?? (display ? -0.6 : -0.2),
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ fontSize: size * 0.78, opacity: 0.6, marginRight: 2 }}>฿</span>
      {baht(value).slice(1)}
    </span>
  );
}

/** `ตอนนี้` — carried by the three zones that deliberately ignore the window. */
export function ScopeChip({ theme }: { theme: Theme }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        fontFamily: FONT_UI,
        fontSize: 11,
        color: theme.inkSofter,
        border: `0.5px solid ${theme.hairlineStrong}`,
        borderRadius: 100,
        padding: '3px 8px',
        lineHeight: 1,
        whiteSpace: 'nowrap',
      }}
    >
      ตอนนี้
    </span>
  );
}

interface PillToggleProps {
  theme: Theme;
  label: string;
  active: boolean;
  onClick: () => void;
  expanded?: boolean;
  controls?: string;
}

/**
 * A filter pill. The visible lozenge keeps its 26px height while the button
 * around it clears 44px of transparent hit area — the same trick `IconBtn`
 * uses, so a thumb never has to find a 26px target.
 */
export function PillToggle({ theme, label, active, onClick, expanded, controls }: PillToggleProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={expanded}
      aria-controls={controls}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        padding: '9px 0',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span
        style={{
          border: `0.5px solid ${active ? goldMark(theme) : theme.hairlineStrong}`,
          borderRadius: 100,
          padding: '5px 13px',
          background: active ? theme.surface2 : 'transparent',
          color: active ? theme.ink : theme.inkSoft,
          fontWeight: active ? 600 : 400,
          fontFamily: FONT_UI,
          fontSize: 11.5,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </span>
    </button>
  );
}

interface UnderlineToggleProps {
  theme: Theme;
  label: string;
  active: boolean;
  onClick: () => void;
  size?: number;
  mono?: boolean;
}

/** A text toggle underlined in gold when active — the sort keys and the phone's
 *  หมวดหมู่⇄ร้านค้า title. Same 44px wrapper, same 2px rule. */
export function UnderlineToggle({ theme, label, active, onClick, size = 13.5, mono }: UnderlineToggleProps) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        minHeight: 44,
        padding: '11px 0',
        background: 'none',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
      }}
    >
      <span
        style={{
          paddingBottom: 3,
          fontFamily: mono ? FONT_MONO : FONT_UI,
          fontSize: size,
          fontWeight: active && !mono ? 600 : 400,
          color: active ? theme.ink : mono ? theme.inkSofter : theme.inkSoft,
          boxShadow: active ? `inset 0 -2px 0 ${goldMark(theme)}` : 'none',
        }}
      >
        {label}
      </span>
    </button>
  );
}

export function ZoneHeader({
  theme,
  title,
  hint,
  scope,
}: {
  theme: Theme;
  title: string;
  hint?: string;
  scope?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 0 12px' }}>
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          color: theme.inkSofter,
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      <span style={{ flex: 1, height: 0.5, background: theme.hairlineStrong }} />
      {scope && <ScopeChip theme={theme} />}
      {hint && (
        <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: theme.inkSofter, whiteSpace: 'nowrap' }}>
          {hint}
        </span>
      )}
    </div>
  );
}

export function CardHeader({
  theme,
  title,
  hint,
  scope,
}: {
  theme: Theme;
  title: ReactNode;
  hint?: string;
  scope?: boolean;
}) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      {typeof title === 'string' ? (
        <span style={{ fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 600, color: theme.ink }}>{title}</span>
      ) : (
        title
      )}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {scope && <ScopeChip theme={theme} />}
        {hint && (
          <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter, whiteSpace: 'nowrap' }}>
            {hint}
          </span>
        )}
      </span>
    </div>
  );
}

export function FootNote({ theme, children }: { theme: Theme; children: ReactNode }) {
  return (
    <div style={{ fontFamily: FONT_UI, fontSize: 10.5, color: theme.inkSofter, marginTop: 6, lineHeight: 1.5 }}>
      {children}
    </div>
  );
}

/** `ครอบคลุม ฿X จาก ฿Y ในงวด` — the one-window-one-denominator proof, printed
 *  on every breakdown card so the bars can be checked against the ladder. */
export function CoverageLine({
  theme,
  covered,
  windowTotal,
}: {
  theme: Theme;
  covered: number;
  windowTotal: number;
}) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 10.5,
        color: theme.inkSofter,
        marginTop: 10,
        paddingTop: 9,
        borderTop: `0.5px solid ${theme.hairline}`,
      }}
    >
      ครอบคลุม {baht(covered)} จาก {baht(windowTotal)} ในงวด
    </div>
  );
}

const CHIP_TONE_ALPHA = '1F';

export function MetaChip({ theme, text, tone }: { theme: Theme; text: string; tone: ChipTone }) {
  const color = tone === 'danger' ? theme.danger : tone === 'warn' ? theme.warn : theme.inkSofter;
  return (
    <span
      style={{
        fontFamily: FONT_MONO,
        fontSize: 11,
        fontWeight: 600,
        borderRadius: 100,
        padding: '3px 8px',
        color,
        background: tone === 'neutral' ? theme.hairline : `${color}${CHIP_TONE_ALPHA}`,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </span>
  );
}

interface BarRowProps {
  theme: Theme;
  label: string;
  value: number;
  max: number;
  /** Defaults to the compact baht form; pass a count or a percent instead. */
  valueText?: string;
  sub?: string;
  dot?: string;
  avatarInitials?: string;
  /** Overrides `chartInk` for the four status-coloured flow rows only. */
  fill?: string;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  controls?: string;
}

/** Horizontal magnitude bar. One hue, length carries the value; ฿0 draws a
 *  1px tick on the origin rather than a pill that reads as "a little money". */
export function BarRow({
  theme,
  label,
  value,
  max,
  valueText,
  sub,
  dot,
  avatarInitials,
  fill,
  selected,
  dimmed,
  onClick,
  controls,
}: BarRowProps) {
  const zero = !(value > 0);
  const pct = !zero && max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      title={label}
      aria-expanded={onClick ? selected === true : undefined}
      aria-controls={selected && controls ? controls : undefined}
      style={{
        position: 'relative',
        display: 'block',
        width: '100%',
        minHeight: 44,
        padding: selected ? '6px 8px 5px' : '6px 0 5px',
        margin: selected ? '0 -8px' : undefined,
        background: selected ? theme.surface2 : 'none',
        borderRadius: selected ? 10 : 0,
        border: 'none',
        textAlign: 'left',
        font: 'inherit',
        cursor: onClick ? 'pointer' : 'default',
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 0,
            width: 2,
            borderRadius: 2,
            background: goldMark(theme),
          }}
        />
      )}
      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5, alignItems: 'baseline' }}>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 7,
            minWidth: 0,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.inkSoft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {dot && <i style={{ width: 6, height: 6, borderRadius: 3, background: dot, flex: '0 0 auto' }} />}
          {avatarInitials && <Avatar theme={theme} initials={avatarInitials} size={22} />}
          {label}
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 12,
            color: theme.ink,
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {valueText ?? baht(value)}
          {sub && <small style={{ fontSize: 11, color: theme.inkSofter, marginLeft: 6 }}>{sub}</small>}
        </span>
      </span>
      <span
        style={{
          display: 'block',
          height: 9,
          borderRadius: 100,
          background: theme.chartTrack,
          overflow: 'hidden',
        }}
      >
        <span
          style={
            zero
              ? { display: 'block', height: '100%', width: 1, background: theme.hairlineStrong }
              : { display: 'block', height: '100%', width: `${pct}%`, borderRadius: 100, background: fill ?? theme.chartInk }
          }
        />
      </span>
    </button>
  );
}

/**
 * `อื่น ๆ อีก 4 หมวด` — everything past the card's own top rows.
 *
 * Text, not a bar. The tail's amount is the sum of every folded group, so a
 * proportional bar measured against the top row draws it clipped at full track
 * whenever those groups outweigh the leader — making `อื่น ๆ` the visually
 * largest thing in a card whose whole job is ranking.
 */
export function TailRow({
  theme,
  label,
  amount,
  selected,
  dimmed,
  onClick,
  controls,
}: {
  theme: Theme;
  label: string;
  amount: number;
  selected?: boolean;
  dimmed?: boolean;
  onClick?: () => void;
  controls?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-expanded={onClick ? selected === true : undefined}
      aria-controls={selected && controls ? controls : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        justifyContent: 'space-between',
        gap: 10,
        width: '100%',
        minHeight: 44,
        alignItems: 'center',
        border: 'none',
        padding: selected ? '9px 8px 2px' : '9px 0 2px',
        margin: selected ? '0 -8px' : undefined,
        borderRadius: selected ? 10 : 0,
        background: selected ? theme.surface2 : 'none',
        font: 'inherit',
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
        fontFamily: FONT_UI,
        fontSize: 11.5,
        color: theme.inkSofter,
        opacity: dimmed ? 0.45 : 1,
      }}
    >
      {selected && (
        <span
          style={{
            position: 'absolute',
            top: 4,
            bottom: 4,
            left: 0,
            width: 2,
            borderRadius: 2,
            background: goldMark(theme),
          }}
        />
      )}
      <span>{label}</span>
      <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
        {baht(amount)}
      </span>
    </button>
  );
}

/** A card-level nothing-here line. `onJump` offers the wider window. */
export function EmptyLine({
  theme,
  message,
  jumpLabel,
  onJump,
}: {
  theme: Theme;
  message: string;
  jumpLabel?: string;
  onJump?: () => void;
}) {
  return (
    <div style={{ padding: '14px 0', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
      {message}
      {onJump && jumpLabel && (
        <button
          onClick={onJump}
          style={{
            display: 'block',
            marginTop: 8,
            minHeight: 44,
            background: 'none',
            border: 'none',
            padding: 0,
            font: 'inherit',
            fontFamily: FONT_UI,
            fontSize: 12.5,
            color: theme.inkSoft,
            cursor: 'pointer',
          }}
        >
          {jumpLabel}
        </button>
      )}
    </div>
  );
}

interface ColumnChartProps {
  theme: Theme;
  points: OverviewSeriesPoint[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  height: number;
  controls?: string;
}

/**
 * The cash-out chart. Columns are the tap target: each overlay spans the full
 * chart height (84–96px), so even the month's narrow columns clear 44px in the
 * dimension a thumb misses in — and the phone never draws more than 7 of them,
 * because เดือนนี้ collapses to five weekly buckets there.
 */
export function ColumnChart({ theme, points, selectedKey, onSelect, height, controls }: ColumnChartProps) {
  // A native `title` inherits the OS tooltip: a second of delay, the system
  // font, and no way to set the numbers in FONT_MONO. Hover/focus is a
  // pointer-and-keyboard affordance, so touch loses nothing by its absence.
  const [hovered, setHovered] = useState<number | null>(null);
  const max = Math.max(1, ...points.map((p) => p.total));
  const maxIndex = points.reduce((best, p, i) => (p.total > points[best].total ? i : best), 0);
  const maxLabelStyle: CSSProperties =
    maxIndex === 0
      ? { left: 0, transform: 'translate(0,-100%)' }
      : maxIndex === points.length - 1
        ? { left: '100%', transform: 'translate(-100%,-100%)' }
        : { left: `${((maxIndex + 0.5) / points.length) * 100}%`, transform: 'translate(-50%,-100%)' };
  const gold = goldMark(theme);

  return (
    <div style={{ position: 'relative', paddingTop: 16 }}>
      <div
        style={{
          position: 'absolute',
          top: 14,
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: theme.ink,
          fontVariantNumeric: 'tabular-nums',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          ...maxLabelStyle,
        }}
      >
        {baht(points[maxIndex]?.total ?? 0)}
      </div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height, position: 'relative' }}>
        {hovered !== null && points[hovered] && (
          <div
            style={{
              position: 'absolute',
              zIndex: 3,
              bottom: `calc(${
                points[hovered].total > 0 ? Math.max(3, (points[hovered].total / max) * 100) : 0
              }% + 8px)`,
              ...(hovered === 0
                ? { left: 0 }
                : hovered === points.length - 1
                  ? { left: '100%', transform: 'translateX(-100%)' }
                  : { left: `${((hovered + 0.5) / points.length) * 100}%`, transform: 'translateX(-50%)' }),
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
              background: theme.surface,
              border: `0.5px solid ${theme.hairline}`,
              borderRadius: 10,
              padding: 8,
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.ink,
              boxShadow: '0 4px 14px rgba(0,0,0,0.10)',
            }}
          >
            {points[hovered].fullLabel}{' '}
            <span style={{ fontFamily: FONT_MONO, fontVariantNumeric: 'tabular-nums' }}>
              · {baht(points[hovered].total)} · {points[hovered].count} คำขอ
            </span>
          </div>
        )}
        {points.map((p, index) => {
          const selected = selectedKey === p.key;
          const dimmed = selectedKey !== null && !selected;
          const pct = p.total > 0 ? Math.max(3, (p.total / max) * 100) : 0;
          return (
            <div
              key={p.key}
              style={{
                flex: 1,
                minWidth: 0,
                position: 'relative',
                display: 'flex',
                alignItems: 'flex-end',
                height: '100%',
                opacity: dimmed ? 0.45 : 1,
              }}
            >
              <span
                style={
                  p.isFuture
                    ? { width: '100%', height: 2, borderTop: `2px dotted ${theme.hairlineStrong}` }
                    : p.total > 0
                      ? { width: '100%', height: `${pct}%`, background: theme.chartInk, borderRadius: '4px 4px 0 0', position: 'relative' }
                      : { width: '100%', height: 1, background: theme.hairlineStrong, position: 'relative' }
                }
              >
                {/* The cap rides the zero stub too: on a morning with no
                    cash-out yet, today is exactly the column a reader is
                    looking for and an unmarked stub hides it. */}
                {p.isToday && !p.isFuture && (
                  <span style={{ position: 'absolute', left: 0, right: 0, top: -2, height: 2, background: gold }} />
                )}
                {selected && p.total > 0 && !p.isFuture && (
                  <span style={{ position: 'absolute', left: 0, right: 0, bottom: -2, height: 2, background: gold }} />
                )}
              </span>
              {!p.isFuture && (
                <button
                  onClick={() => onSelect(p.key)}
                  onMouseEnter={() => setHovered(index)}
                  onMouseLeave={() => setHovered((current) => (current === index ? null : current))}
                  onFocus={() => setHovered(index)}
                  onBlur={() => setHovered((current) => (current === index ? null : current))}
                  aria-expanded={selected}
                  aria-controls={selected ? controls : undefined}
                  aria-label={`${p.fullLabel} ${baht(p.total)} ${p.count} คำขอ`}
                  style={{
                    position: 'absolute',
                    top: -6,
                    bottom: -6,
                    left: -1,
                    right: -1,
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      <div style={{ height: 0.5, background: theme.hairlineStrong }} />
      <div style={{ display: 'flex', gap: 2, marginTop: 5 }}>
        {points.map((p, i) => (
          <span
            key={p.key}
            style={{
              flex: 1,
              minWidth: 0,
              textAlign: 'center',
              fontFamily: FONT_MONO,
              fontSize: 9,
              color: theme.inkSofter,
              overflow: 'hidden',
            }}
          >
            {points.length <= 8 || i === 0 || (i + 1) % 5 === 0 ? p.label : ''}
          </span>
        ))}
      </div>
    </div>
  );
}
