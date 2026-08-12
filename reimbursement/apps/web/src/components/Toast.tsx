import { useCallback, useEffect, useRef, useState } from 'react';
import type { Theme } from '../lib/types';
import { FONT_UI } from '../lib/theme';

// ── Types ─────────────────────────────────────────────────────────────

export interface ToastState {
  message: string;
  /** Internal: unique key to reset the animation on repeated shows */
  key: number;
  visible: boolean;
}

export interface UseToastReturn {
  toast: ToastState | null;
  showToast: (msg: string) => void;
}

// ── Hook ──────────────────────────────────────────────────────────────

const DISMISS_MS = 3000;

export function useToast(): UseToastReturn {
  const [toast, setToast] = useState<ToastState | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string): void => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setToast((prev) => ({
      message: msg,
      key: (prev?.key ?? 0) + 1,
      visible: true,
    }));

    timerRef.current = setTimeout(() => {
      setToast((prev) => (prev !== null ? { ...prev, visible: false } : null));
      timerRef.current = null;
    }, DISMISS_MS);
  }, []);

  // Clean up timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  return { toast, showToast };
}

// ── Component ─────────────────────────────────────────────────────────

interface ToastProps {
  toast: ToastState | null;
  theme: Theme;
}

export function Toast({ toast, theme }: ToastProps): JSX.Element | null {
  if (toast === null || !toast.visible) return null;

  return (
    <>
      <style>{`
        @keyframes __toast_in {
          from { opacity: 0; transform: translate(-50%, 12px); }
          to   { opacity: 1; transform: translate(-50%, 0); }
        }
      `}</style>
      <div
        key={toast.key}
        role="status"
        aria-live="polite"
        style={{
          position: 'fixed',
          bottom: 32,
          left: '50%',
          transform: 'translate(-50%, 0)',
          zIndex: 9999,
          background: theme.ink,
          color: theme.paper,
          fontFamily: FONT_UI,
          fontSize: 14,
          fontWeight: 500,
          padding: '11px 20px',
          borderRadius: 40,
          boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          animation: '__toast_in 0.22s cubic-bezier(0.34,1.56,0.64,1) both',
        }}
      >
        {toast.message}
      </div>
    </>
  );
}
