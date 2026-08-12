import type { ReactNode } from 'react';
import { FONT_DISPLAY, FONT_UI } from '../lib/theme';
import type { Theme } from '../lib/types';

interface AppBarProps {
  theme: Theme;
  title?: string | null;
  large?: boolean;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}

export function AppBar({ title, large = false, leading, trailing, theme, subtitle }: AppBarProps) {
  return (
    <div style={{ paddingTop: 54, paddingLeft: 20, paddingRight: 20, paddingBottom: large ? 4 : 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', minHeight: 36 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>{leading}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>{trailing}</div>
      </div>
      {large && (
        <div style={{ marginTop: 14 }}>
          {subtitle && (
            <div
              style={{
                fontFamily: FONT_UI,
                fontSize: 12,
                color: theme.inkSoft,
                letterSpacing: 1.2,
                textTransform: 'uppercase',
                fontWeight: 500,
                marginBottom: 4,
              }}
            >
              {subtitle}
            </div>
          )}
          <h1
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 40,
              lineHeight: 1.05,
              letterSpacing: -0.8,
              color: theme.ink,
            }}
          >
            {title}
          </h1>
        </div>
      )}
      {!large && title && (
        <div
          style={{
            textAlign: 'center',
            marginTop: -28,
            fontFamily: FONT_UI,
            fontSize: 16,
            fontWeight: 600,
            color: theme.ink,
            pointerEvents: 'none',
          }}
        >
          {title}
        </div>
      )}
    </div>
  );
}
