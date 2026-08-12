import { useEffect, type ReactNode } from 'react';
import type { Theme } from '../lib/types';
import { FONT_UI, FONT_DISPLAY } from '../lib/theme';
import { Card, GhostButton, PrimaryButton } from './primitives';

export interface ConfirmDialogProps {
  theme: Theme;
  title: string;
  message?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  theme,
  title,
  message,
  confirmLabel,
  cancelLabel = 'ยกเลิก',
  danger = false,
  loading = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  // Esc key cancels
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !loading) onCancel();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [loading, onCancel]);

  const confirmBg = danger ? theme.danger : theme.accent;

  return (
    <div
      onClick={() => { if (!loading) onCancel(); }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10,8,5,0.5)',
        padding: '24px 20px',
      }}
    >
      {/* Card stops click propagation so backdrop click doesn't fire for inner clicks */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 360 }}
      >
        <Card theme={theme} padding={24}>
          {/* Title */}
          <p
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 18,
              fontWeight: 500,
              color: theme.ink,
              margin: '0 0 8px',
              letterSpacing: -0.3,
              lineHeight: 1.3,
            }}
          >
            {title}
          </p>

          {/* Optional message */}
          {message && (
            <p
              style={{
                fontFamily: FONT_UI,
                fontSize: 14,
                color: theme.inkSoft,
                margin: '0 0 20px',
                lineHeight: 1.55,
              }}
            >
              {message}
            </p>
          )}

          {/* Buttons */}
          <div
            style={{
              display: 'flex',
              gap: 10,
              marginTop: message ? 0 : 20,
              justifyContent: 'flex-end',
            }}
          >
            <GhostButton
              theme={theme}
              onClick={loading ? undefined : onCancel}
            >
              {cancelLabel}
            </GhostButton>

            <PrimaryButton
              theme={theme}
              disabled={loading}
              full={false}
              onClick={loading ? undefined : onConfirm}
              style={
                danger && !loading
                  ? { background: confirmBg }
                  : undefined
              }
            >
              {loading ? 'กำลังดำเนินการ...' : confirmLabel}
            </PrimaryButton>
          </div>
        </Card>
      </div>
    </div>
  );
}
