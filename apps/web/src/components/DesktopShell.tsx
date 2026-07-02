import type { ReactNode } from 'react';
import type { Theme } from '../lib/types';

interface DesktopShellProps {
  theme: Theme;
  sidebar: ReactNode;
  children: ReactNode;
}

/**
 * Bare desktop chrome — sidebar + main content. No macOS window decoration.
 * Pinned to the viewport with `position: fixed; inset: 0` so it always fills
 * the full window — this escapes index.html's centered, padded, dark-gradient
 * `body` (a backdrop meant only for the dev phone-mockup preview), which would
 * otherwise shrink-wrap the desktop layout and leave dark margins on wide
 * screens. Each panel scrolls independently via its own overflow.
 *
 * `top` reads `--hf-band-offset` (set in index.html via the `body:has(>
 * #hf-bar-host)` gotcha pattern) instead of using the `inset: 0` shorthand,
 * so this fixed chrome drops 46px when the HF One band below loads, and
 * sits flush at 0 if it doesn't.
 */
export function DesktopShell({ theme, sidebar, children }: DesktopShellProps) {
  return (
    <div
      style={{
        position: 'fixed',
        top: 'var(--hf-band-offset, 0px)',
        right: 0,
        bottom: 0,
        left: 0,
        background: theme.paper,
        color: theme.ink,
        display: 'flex',
        overflow: 'hidden',
      }}
    >
      {/* HF One shell band. Desktop-only outer chrome (this component, not
          the mobile iOS-device preview) — monogram + portal link only, no
          app switcher, since this app is employee/approver-facing. */}
      <script
        defer
        src="https://erp.thehfhotel.org/shell/hf-bar.js"
        data-app="Reimbursement"
        data-module="finance"
        data-portal-only="1"
      />
      <aside
        style={{
          width: 240,
          flexShrink: 0,
          background: theme.surface2,
          borderRight: `0.5px solid ${theme.hairline}`,
          display: 'flex',
          flexDirection: 'column',
          padding: '20px 0 12px',
          overflowY: 'auto',
        }}
      >
        {sidebar}
      </aside>
      <main
        style={{
          flex: 1,
          minWidth: 0,
          height: '100%',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        {children}
      </main>
    </div>
  );
}

interface SidebarItemProps {
  theme: Theme;
  label: string;
  count?: number;
  sub?: string;
  active?: boolean;
  accent?: boolean;
  onClick?: () => void;
}

export function SidebarItem({ theme, label, count, sub, active, accent, onClick }: SidebarItemProps) {
  return (
    <div
      onClick={onClick}
      style={{
        margin: '1px 8px',
        padding: '7px 12px',
        borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        background: active ? 'rgba(0,0,0,0.06)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        fontFamily: 'Arial, sans-serif',
        fontSize: 13,
        color: theme.ink,
        fontWeight: active ? 500 : 400,
      }}
    >
      {accent && <div style={{ width: 6, height: 6, borderRadius: 3, background: theme.warn }} />}
      <span style={{ flex: 1 }}>{label}</span>
      {count != null && (
        <span
          style={{
            fontFamily: 'Arial, sans-serif',
            fontSize: 11,
            color: theme.inkSoft,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
      {sub && <span style={{ fontFamily: 'Arial, sans-serif', fontSize: 11, color: theme.inkSofter }}>{sub}</span>}
    </div>
  );
}

interface SidebarSectionProps {
  label: string;
  theme: Theme;
}

export function SidebarSection({ label, theme }: SidebarSectionProps) {
  return (
    <div
      style={{
        padding: '14px 16px 6px',
        fontFamily: 'Arial, sans-serif',
        fontSize: 10,
        fontWeight: 600,
        color: theme.inkSofter,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </div>
  );
}
