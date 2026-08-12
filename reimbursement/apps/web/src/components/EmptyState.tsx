import type { ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { FONT_DISPLAY, FONT_UI } from '../lib/theme';

interface EmptyStateAction {
  label: string;
  onClick: () => void;
}

interface EmptyStateProps {
  theme: Theme;
  icon: (color?: string) => ReactNode;
  title: string;
  subtext?: string;
  action?: EmptyStateAction;
}

export function EmptyState({ theme, icon, title, subtext, action }: EmptyStateProps): JSX.Element {
  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        padding: '0 40px',
        gap: 14,
      }}
    >
      {/* 56px rounded-square icon chip */}
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: 16,
          background: theme.surface2,
          border: `0.5px solid ${theme.hairline}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {icon(theme.inkSofter)}
      </div>

      {/* Heading */}
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 19,
          fontWeight: 400,
          letterSpacing: -0.3,
          color: theme.ink,
        }}
      >
        {title}
      </div>

      {/* Optional subtext */}
      {subtext !== undefined && (
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.inkSoft,
            lineHeight: 1.5,
            maxWidth: 300,
          }}
        >
          {subtext}
        </div>
      )}

      {/* Optional action button */}
      {action !== undefined && (
        <button
          onClick={action.onClick}
          style={{
            marginTop: 4,
            padding: '10px 20px',
            background: theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontFamily: FONT_UI,
            fontSize: 14,
            fontWeight: 600,
            cursor: 'pointer',
            letterSpacing: 0.1,
          }}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
