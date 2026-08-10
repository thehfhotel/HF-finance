import { useEffect, useRef, useState } from 'react';
import type { Theme } from '../../lib/types';
import { FONT_DISPLAY, FONT_UI, getTheme, HF_BRAND } from '../../lib/theme';
import { ApiError, api, setAuthToken } from '../../lib/api';

/** Per-terminal reader id, paired once and remembered in this browser. */
const READER_ID_STORAGE_KEY = 'reimbursement_reader_id';
/** Poll cadence + overall deadline for waiting on a card tap. */
const CARD_POLL_INTERVAL_MS = 1500;
const CARD_WAIT_TIMEOUT_MS = 60_000;

function readReaderId(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(READER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

function saveReaderId(id: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (id === null) window.localStorage.removeItem(READER_ID_STORAGE_KEY);
    else window.localStorage.setItem(READER_ID_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable — pairing just won't persist across reloads.
  }
}

function cardErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 403) {
      return 'บัตรนี้ยังไม่ได้ผูกกับพนักงาน หรือไม่มีสิทธิ์ใช้งาน — ติดต่อผู้ดูแลระบบ';
    }
    if (err.status === 401) return 'บัตรไม่ถูกต้อง กรุณาแตะใหม่อีกครั้ง';
    if (err.status === 503) return 'ระบบแตะบัตรยังไม่พร้อมใช้งาน — ติดต่อผู้ดูแลระบบ';
    if (err.status === 502) return 'เชื่อมต่อระบบบัตรไม่สำเร็จ กรุณาลองใหม่';
    return err.message;
  }
  return 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง';
}

/** Contact point shown when the user has no account or needs help.
 *  Accounts are admin-created (no self-signup), so this reaches the approver
 *  who can add the badge/email mapping. */
const ADMIN_CONTACT = 'mailto:winut.hf@gmail.com';

interface LoginProps {
  /** Optional theme — Login is shown pre-auth, so a default is provided. */
  theme?: Theme;
  /** Thai error message from a failed silent Cloudflare Access exchange that
   *  ran during app bootstrap, if any — seeds the screen's error banner. */
  cfError?: string | null;
}

/** Maps a failed `api.auth.cfLogin()` to the Thai message shown on this
 *  screen — mirrors the mapping App.tsx uses for the silent bootstrap attempt. */
function cfLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return error.message;
    if (error.status === 503) return 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน — ติดต่อผู้ดูแลระบบ';
  }
  return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export function Login({ theme = getTheme(false, HF_BRAND[500]), cfError = null }: LoginProps) {
  const [errorMessage, setErrorMessage] = useState<string | null>(cfError);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const handleCfLogin = async () => {
    setSubmitting(true);
    setErrorMessage(null);
    try {
      const result = await api.auth.cfLogin();
      setAuthToken(result.token);
      window.location.assign('/');
    } catch (error) {
      setErrorMessage(cfLoginErrorMessage(error));
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100%',
        background: theme.paper,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '0 28px',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 11,
            color: theme.inkSoft,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            marginBottom: 14,
          }}
        >
          ใบเบิกค่าใช้จ่าย
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 38,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            color: theme.ink,
          }}
        >
          เข้าสู่ระบบ
        </h1>
        <div
          style={{
            marginTop: 14,
            maxWidth: 280,
            fontFamily: FONT_UI,
            fontSize: 14,
            color: theme.inkSoft,
            lineHeight: 1.5,
          }}
        >
          แตะบัตรพนักงาน หรือเข้าสู่ระบบผ่านระบบกลางของบริษัท
        </div>
        {errorMessage && (
          <div
            style={{
              marginTop: 18,
              padding: '10px 14px',
              borderRadius: 10,
              background: `${theme.danger}14`,
              border: `1px solid ${theme.danger}40`,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.danger,
              maxWidth: 300,
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 30px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <CfLoginButton theme={theme} onClick={handleCfLogin} submitting={submitting} />
        <CardLoginSection theme={theme} />
        <a
          href={ADMIN_CONTACT}
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.inkSoft,
            textAlign: 'center',
            lineHeight: 1.5,
            textDecoration: 'underline',
            textDecorationColor: theme.inkSofter,
            textUnderlineOffset: 2,
            cursor: 'pointer',
          }}
        >
          ติดต่อผู้ดูแลระบบหากยังไม่มีบัญชี
        </a>
      </div>
    </div>
  );
}

interface CfLoginButtonProps {
  theme: Theme;
  submitting: boolean;
  onClick: () => void;
}

function CfLoginButton({ theme, submitting, onClick }: CfLoginButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={submitting}
      style={{
        width: '100%',
        padding: '15px 22px',
        background: theme.accent,
        color: '#fff',
        border: 'none',
        borderRadius: 14,
        fontFamily: FONT_UI,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 0.1,
        cursor: submitting ? 'default' : 'pointer',
        opacity: submitting ? 0.7 : 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <span>{submitting ? 'กำลังเข้าสู่ระบบ...' : 'เข้าสู่ระบบผ่านระบบกลาง HF'}</span>
    </button>
  );
}

// ─── Card login ──────────────────────────────────────────────────────────────

type CardMode = 'idle' | 'pairing' | 'waiting';

interface CardLoginSectionProps {
  theme: Theme;
}

/**
 * "Tap your card" option. A terminal is paired once (its `reader_id` is stored
 * in localStorage); after that, tapping the button opens a claim against the
 * central HF-ID service and polls until the employee taps their NFC card. On
 * success we store the minted session JWT and reload into the app — exactly
 * like the LINE OAuth success path.
 */
function CardLoginSection({ theme }: CardLoginSectionProps) {
  const [mode, setMode] = useState<CardMode>('idle');
  const [error, setError] = useState<string | null>(null);
  const [readerId, setReaderId] = useState<string | null>(() => readReaderId());
  const [readerInput, setReaderInput] = useState('');

  // Cancellation guard shared with the async poll loop + timer handle.
  const cancelledRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, []);

  const stopPolling = () => {
    cancelledRef.current = true;
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  const beginWaiting = async (id: string) => {
    setError(null);
    cancelledRef.current = false;
    setMode('waiting');

    try {
      await api.auth.cardLoginStart(id);
    } catch (err) {
      if (cancelledRef.current) return;
      setMode('idle');
      setError(cardErrorText(err));
      return;
    }

    const deadline = Date.now() + CARD_WAIT_TIMEOUT_MS;
    const tick = async () => {
      if (cancelledRef.current) return;
      if (Date.now() > deadline) {
        setMode('idle');
        setError('หมดเวลารอแตะบัตร กรุณาลองใหม่อีกครั้ง');
        return;
      }
      try {
        const result = await api.auth.cardLoginWait();
        if (cancelledRef.current) return;
        if (result === null) {
          // No tap yet — poll again.
          timerRef.current = setTimeout(() => void tick(), CARD_POLL_INTERVAL_MS);
          return;
        }
        // Success: persist the session and reload into the app, mirroring the
        // LINE callback path (App bootstraps from the stored token).
        setAuthToken(result.token);
        window.location.assign(result.redirect || '/');
      } catch (err) {
        if (cancelledRef.current) return;
        setMode('idle');
        setError(cardErrorText(err));
      }
    };
    void tick();
  };

  const handleTap = () => {
    setError(null);
    if (readerId) {
      void beginWaiting(readerId);
    } else {
      setReaderInput('');
      setMode('pairing');
    }
  };

  const handlePairAndStart = () => {
    const id = readerInput.trim();
    if (id.length === 0) return;
    saveReaderId(id);
    setReaderId(id);
    void beginWaiting(id);
  };

  const handleCancel = () => {
    stopPolling();
    setMode('idle');
  };

  const handleRepair = () => {
    stopPolling();
    saveReaderId(null);
    setReaderId(null);
    setReaderInput('');
    setError(null);
    setMode('pairing');
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <OrDivider theme={theme} />

      {mode === 'waiting' ? (
        <CardWaiting theme={theme} readerId={readerId} onCancel={handleCancel} />
      ) : mode === 'pairing' ? (
        <CardPairing
          theme={theme}
          value={readerInput}
          onChange={setReaderInput}
          onConfirm={handlePairAndStart}
          onCancel={() => setMode('idle')}
        />
      ) : (
        <CardTapButton theme={theme} onClick={handleTap} />
      )}

      {mode === 'idle' && readerId && (
        <button
          onClick={handleRepair}
          style={{
            background: 'transparent',
            border: 'none',
            padding: 0,
            fontFamily: FONT_UI,
            fontSize: 11,
            color: theme.inkSofter,
            cursor: 'pointer',
            textAlign: 'center',
          }}
        >
          เครื่อง: {readerId} · เปลี่ยน
        </button>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 10,
            background: `${theme.danger}14`,
            border: `1px solid ${theme.danger}40`,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.danger,
            lineHeight: 1.5,
            textAlign: 'center',
          }}
        >
          {error}
        </div>
      )}
    </div>
  );
}

function OrDivider({ theme }: { theme: Theme }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <div style={{ flex: 1, height: 1, background: theme.hairline }} />
      <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>หรือ</span>
      <div style={{ flex: 1, height: 1, background: theme.hairline }} />
    </div>
  );
}

function CardTapButton({ theme, onClick }: { theme: Theme; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: '100%',
        padding: '15px 22px',
        background: 'transparent',
        color: theme.ink,
        border: `1px solid ${theme.hairlineStrong}`,
        borderRadius: 14,
        fontFamily: FONT_UI,
        fontSize: 16,
        fontWeight: 600,
        letterSpacing: 0.1,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
      }}
    >
      <CardGlyph color={theme.accent} />
      <span>แตะบัตรพนักงาน</span>
    </button>
  );
}

function CardWaiting({
  theme,
  readerId,
  onCancel,
}: {
  theme: Theme;
  readerId: string | null;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: '18px 16px',
        borderRadius: 14,
        border: `1px solid ${theme.hairlineStrong}`,
        background: theme.surface,
      }}
    >
      <div
        style={{
          width: 26,
          height: 26,
          borderRadius: 13,
          border: `2.5px solid ${theme.accent}33`,
          borderTopColor: theme.accent,
          animation: 'card-login-spin 0.8s linear infinite',
        }}
      />
      <div style={{ fontFamily: FONT_UI, fontSize: 15, fontWeight: 600, color: theme.ink }}>
        แตะบัตรของคุณที่เครื่องอ่าน
      </div>
      {readerId && (
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>
          เครื่อง: {readerId}
        </div>
      )}
      <button
        onClick={onCancel}
        style={{
          background: 'transparent',
          border: 'none',
          padding: '4px 8px',
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
          cursor: 'pointer',
          textDecoration: 'underline',
          textUnderlineOffset: 2,
        }}
      >
        ยกเลิก
      </button>
      <style>{`@keyframes card-login-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}

function CardPairing({
  theme,
  value,
  onChange,
  onConfirm,
  onCancel,
}: {
  theme: Theme;
  value: string;
  onChange: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: '16px',
        borderRadius: 14,
        border: `1px solid ${theme.hairlineStrong}`,
        background: theme.surface,
      }}
    >
      <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
        ตั้งค่าเครื่องนี้ครั้งแรก — ใส่รหัสเครื่องอ่านบัตร (reader ID)
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') onConfirm();
        }}
        placeholder="เช่น reception-1"
        autoFocus
        style={{
          width: '100%',
          padding: '12px 14px',
          borderRadius: 12,
          background: theme.paper,
          border: `1px solid ${theme.hairlineStrong}`,
          fontFamily: FONT_UI,
          fontSize: 15,
          color: theme.ink,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          onClick={onCancel}
          style={{
            flex: 1,
            padding: '11px 16px',
            background: 'transparent',
            color: theme.inkSoft,
            border: `1px solid ${theme.hairlineStrong}`,
            borderRadius: 12,
            fontFamily: FONT_UI,
            fontSize: 14,
            fontWeight: 500,
            cursor: 'pointer',
          }}
        >
          ยกเลิก
        </button>
        <button
          onClick={onConfirm}
          disabled={value.trim().length === 0}
          style={{
            flex: 2,
            padding: '11px 16px',
            background: value.trim().length === 0 ? theme.hairlineStrong : theme.accent,
            color: '#fff',
            border: 'none',
            borderRadius: 12,
            fontFamily: FONT_UI,
            fontSize: 14,
            fontWeight: 600,
            cursor: value.trim().length === 0 ? 'default' : 'pointer',
          }}
        >
          บันทึกเครื่อง แล้วแตะบัตร
        </button>
      </div>
    </div>
  );
}

function CardGlyph({ color }: { color: string }) {
  return (
    <svg viewBox="0 0 24 24" width={22} height={22} aria-hidden="true" focusable="false" style={{ display: 'block' }}>
      <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" fill="none" stroke={color} strokeWidth="1.6" />
      <line x1="2.5" y1="9.5" x2="21.5" y2="9.5" stroke={color} strokeWidth="1.6" />
      <line x1="5.5" y1="14.5" x2="11" y2="14.5" stroke={color} strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}
