import type { CSSProperties, ReactNode } from 'react';
import { useState } from 'react';
import type { BundleStatus, Theme } from '../lib/types';
import { FONT_DISPLAY, FONT_UI } from '../lib/theme';

// ── Card ─────────────────────────────────────────────────────────────
interface CardProps {
  children: ReactNode;
  theme: Theme;
  onClick?: () => void;
  padding?: number;
  style?: CSSProperties;
}

export function Card({ children, theme, onClick, padding = 18, style }: CardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        background: theme.surface,
        borderRadius: 18,
        padding,
        border: `0.5px solid ${theme.hairline}`,
        cursor: onClick ? 'pointer' : 'default',
        ...style,
      }}
    >
      {children}
    </div>
  );
}

// ── Buttons ──────────────────────────────────────────────────────────
interface PrimaryButtonProps {
  children: ReactNode;
  onClick?: () => void;
  theme: Theme;
  disabled?: boolean;
  full?: boolean;
  style?: CSSProperties;
}

export function PrimaryButton({ children, onClick, theme, disabled, full = true, style }: PrimaryButtonProps) {
  const [pressed, setPressed] = useState(false);
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      onMouseDown={() => !disabled && setPressed(true)}
      onMouseUp={() => setPressed(false)}
      onMouseLeave={() => setPressed(false)}
      style={{
        width: full ? '100%' : 'auto',
        padding: '15px 22px',
        background: disabled ? theme.hairlineStrong : theme.accent,
        color: disabled ? theme.inkSoft : '#fff',
        border: 'none',
        borderRadius: 14,
        fontFamily: FONT_UI,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 0.1,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'transform 0.08s ease, opacity 0.15s',
        opacity: disabled ? 0.6 : 1,
        transform: pressed && !disabled ? 'scale(0.98)' : 'scale(1)',
        ...style,
      }}
    >
      {children}
    </button>
  );
}

interface GhostButtonProps {
  children: ReactNode;
  onClick?: () => void;
  theme: Theme;
  /** Same contract as PrimaryButton — a disabled ghost mutes its border and
   *  label so an in-flight action reads as unavailable rather than ignored. */
  disabled?: boolean;
  full?: boolean;
}

export function GhostButton({ children, onClick, theme, disabled, full = false }: GhostButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        width: full ? '100%' : 'auto',
        padding: '13px 18px',
        background: 'transparent',
        color: disabled ? theme.inkSoft : theme.ink,
        border: `1px solid ${disabled ? theme.hairline : theme.hairlineStrong}`,
        borderRadius: 14,
        fontFamily: FONT_UI,
        fontSize: 15,
        fontWeight: 500,
        cursor: disabled ? 'default' : 'pointer',
        transition: 'opacity 0.15s',
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {children}
    </button>
  );
}

interface IconBtnProps {
  children: ReactNode;
  onClick?: () => void;
  theme: Theme;
}

export function IconBtn({ children, onClick, theme }: IconBtnProps) {
  return (
    <button
      onClick={onClick}
      style={{
        // 44×44 touch target; negative margin keeps layout footprint at 36px
        width: 44,
        height: 44,
        margin: -4,
        borderRadius: 22,
        background: 'transparent',
        border: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        color: theme.ink,
        padding: 0,
        flexShrink: 0,
      }}
    >
      {/* Visual 36px circle */}
      <span
        style={{
          width: 36,
          height: 36,
          borderRadius: 18,
          background: theme.surface,
          border: `0.5px solid ${theme.hairline}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {children}
      </span>
    </button>
  );
}

// ── Avatar ───────────────────────────────────────────────────────────
interface AvatarProps {
  theme: Theme;
  initials: string;
  size?: number;
}

export function Avatar({ theme, initials, size = 36 }: AvatarProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        background: theme.accent,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: FONT_UI,
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: 0.3,
      }}
    >
      {initials}
    </div>
  );
}

// ── Money ────────────────────────────────────────────────────────────
interface MoneyProps {
  value: number;
  theme: Theme;
  size?: number;
  weight?: number;
  accent?: boolean;
}

export function Money({ value, theme, size = 18, weight = 500, accent = false }: MoneyProps) {
  const [whole, frac] = value.toFixed(2).split('.');
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    <span
      style={{
        fontFamily: FONT_UI,
        fontSize: size,
        fontWeight: weight,
        color: accent ? theme.accent : theme.ink,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: -0.2,
      }}
    >
      <span style={{ fontSize: size * 0.78, opacity: 0.6, marginRight: 2 }}>฿</span>
      {w}
      <span style={{ opacity: 0.5 }}>.{frac}</span>
    </span>
  );
}

// ── Status pill ──────────────────────────────────────────────────────
interface StatusPillProps {
  status: BundleStatus;
  theme: Theme;
  size?: 'sm' | 'md';
}

export function StatusPill({ status, theme, size = 'md' }: StatusPillProps) {
  const map: Record<BundleStatus, { label: string; dot: string; fg: string }> = {
    draft: { label: 'ร่าง', dot: theme.inkSofter, fg: theme.inkSoft },
    pending: { label: 'รออนุมัติ', dot: theme.statusPending, fg: theme.statusPending },
    approved: { label: 'อนุมัติแล้ว', dot: theme.statusApproved, fg: theme.statusApproved },
    paying: { label: 'กำลังโอน', dot: theme.statusPaying, fg: theme.statusPaying },
    paid: { label: 'จ่ายแล้ว', dot: theme.statusPaid, fg: theme.statusPaid },
    rejected: { label: 'ปฏิเสธ', dot: theme.statusRejected, fg: theme.statusRejected },
  };
  const s = map[status] ?? map.draft;
  const small = size === 'sm';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: FONT_UI,
        fontSize: small ? 11 : 12,
        fontWeight: 500,
        color: s.fg,
        letterSpacing: 0.2,
      }}
    >
      <span
        style={{
          width: small ? 5 : 6,
          height: small ? 5 : 6,
          borderRadius: '50%',
          background: s.dot,
        }}
      />
      {s.label}
    </span>
  );
}

// ── SectionHeader ────────────────────────────────────────────────────
interface SectionHeaderProps {
  title: string;
  theme: Theme;
  action?: ReactNode;
}

export function SectionHeader({ title, action, theme }: SectionHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '0 4px 10px',
        marginTop: 18,
      }}
    >
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          fontWeight: 600,
          color: theme.inkSoft,
          letterSpacing: 1.4,
          textTransform: 'uppercase',
        }}
      >
        {title}
      </span>
      {action && (
        <span
          style={{
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.accent,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          {action}
        </span>
      )}
    </div>
  );
}

// ── DetailRow ────────────────────────────────────────────────────────
interface DetailRowProps {
  theme: Theme;
  label: string;
  value: ReactNode;
  last?: boolean;
}

export function DetailRow({ theme, label, value, last }: DetailRowProps) {
  return (
    <div
      style={{
        padding: '14px 18px',
        borderBottom: last ? 'none' : `0.5px solid ${theme.hairline}`,
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontFamily: FONT_UI,
      }}
    >
      <span style={{ fontSize: 13, color: theme.inkSoft }}>{label}</span>
      <span style={{ fontSize: 14, color: theme.ink, fontWeight: 500 }}>{value}</span>
    </div>
  );
}

// ── BigAmount ────────────────────────────────────────────────────────
// Reused display style for hero amounts (record detail, bundle total)
interface BigAmountProps {
  theme: Theme;
  value: number;
  size?: number;
  symbolSize?: number;
}

export function BigAmount({ theme, value, size = 64, symbolSize }: BigAmountProps) {
  const sym = symbolSize ?? size * 0.56;
  const [whole, frac] = value.toFixed(2).split('.');
  const w = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (
    <span
      style={{
        fontFamily: FONT_DISPLAY,
        fontSize: size,
        fontWeight: 400,
        letterSpacing: -1.8,
        color: theme.ink,
        lineHeight: 1,
      }}
    >
      <span style={{ fontSize: sym, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
      {w}
      <span style={{ opacity: 0.5 }}>.{frac}</span>
    </span>
  );
}
