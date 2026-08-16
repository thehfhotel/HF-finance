import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ShareSetup, ShareTokenSummary, Theme } from '../../lib/types';
import { api } from '../../lib/api';
import { encodeQr, qrSvgPath } from '../../lib/qr';
import { FONT_MONO, FONT_UI } from '../../lib/theme';
import { Card, GhostButton, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';

/**
 * เชื่อมต่อมือถือ — issue and manage the credential an iPhone Shortcut holds.
 *
 * Lives inside the share inbox rather than in admin settings, for two reasons:
 * this is where somebody stands when they wonder how files get in here, and the
 * approver-only admin screen is the wrong home for something every employee
 * needs. Each employee manages their own phones; nobody manages anyone else's.
 *
 * The plaintext token exists only in the response that creates it, so this
 * component shows it once, prominently, and never asks for it again. Losing it
 * is not a problem — the fix is to revoke and issue another.
 */

/**
 * The setup guide. A static page in `public/`, not an SPA route — it has to be
 * readable on the phone being set up while the app is open on another device,
 * and it is plain reference text with no app state behind it. Same origin, so
 * it is covered by the same Cloudflare Access session.
 */
const SHORTCUT_HELP_PATH = '/shortcut.html';

interface ConnectPhoneProps {
  theme: Theme;
  onClose: () => void;
}

export function ConnectPhone({ theme, onClose }: ConnectPhoneProps) {
  const [tokens, setTokens] = useState<ShareTokenSummary[] | null>(null);
  const [setup, setSetup] = useState<ShareSetup | null>(null);
  const [issued, setIssued] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTokens(await api.shareTokens.list());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'โหลดไม่สำเร็จ');
      setTokens([]);
    }
    try {
      setSetup(await api.shareTokens.setup());
    } catch {
      // Not fatal: without it the screen still issues tokens and the employee
      // falls back to asking an admin for the two device values.
      setSetup(null);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.shareTokens.create(label.trim() || 'มือถือของฉัน');
      setIssued(result.token);
      setLabel('');
      await load();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'สร้างไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setBusy(true);
    try {
      await api.shareTokens.revoke(id);
      await load();
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'เพิกถอนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  };


  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 60,
        background: theme.paper,
        overflowY: 'auto',
        padding: '54px 18px 40px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontFamily: FONT_UI, fontSize: 18, fontWeight: 600, color: theme.ink, margin: 0 }}>
          เชื่อมต่อมือถือ
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="ปิด"
          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}
        >
          {Icon.close(theme.ink)}
        </button>
      </div>

      <p
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
          lineHeight: 1.6,
          margin: '10px 0 18px',
        }}
      >
        ตั้งค่าครั้งเดียว แล้วจะแชร์รูปใบเสร็จหรือ PDF จากปุ่มแชร์ของ iPhone
        เข้ามาที่แอปนี้ได้เลย
        <br />
        <span style={{ color: theme.inkSofter }}>
          (Android ไม่ต้องตั้งค่า — ติดตั้งแอปแล้วจะขึ้นในเมนูแชร์เอง)
        </span>
      </p>

      {error !== null && (
        <Card theme={theme} padding={13} style={{ marginBottom: 14, borderColor: theme.danger }}>
          <span style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>{error}</span>
        </Card>
      )}

      {issued !== null ? (
        <IssuedToken theme={theme} token={issued} setup={setup} />
      ) : (
        <Card theme={theme} padding={16} style={{ marginBottom: 16 }}>
          <label
            style={{
              display: 'block',
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.inkSoft,
              marginBottom: 6,
            }}
          >
            ชื่อเครื่อง
          </label>
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="เช่น iPhone ของนัท"
            maxLength={60}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '11px 12px',
              borderRadius: 10,
              border: `1px solid ${theme.hairline}`,
              background: theme.surface2,
              color: theme.ink,
              fontFamily: FONT_UI,
              fontSize: 15,
              marginBottom: 12,
            }}
          />
          <PrimaryButton theme={theme} onClick={() => void create()} disabled={busy}>
            สร้างรหัสเชื่อมต่อ
          </PrimaryButton>
        </Card>
      )}

      <Steps theme={theme} />

      {tokens !== null && tokens.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <h3
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 600,
              color: theme.inkSoft,
              margin: '0 0 8px',
            }}
          >
            เครื่องที่เชื่อมต่อแล้ว
          </h3>
          {tokens.map((token) => (
            <Card key={token.id} theme={theme} padding={13} style={{ marginBottom: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {Icon.phone(theme.inkSoft)}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: FONT_UI, fontSize: 14, color: theme.ink }}>
                    {token.label || 'มือถือ'}
                  </div>
                  <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter }}>
                    hfr_{token.hint}… ·{' '}
                    {token.lastUsedAt
                      ? `ใช้ล่าสุด ${new Date(token.lastUsedAt).toLocaleDateString('th-TH')}`
                      : 'ยังไม่เคยใช้'}
                  </div>
                </div>
                <GhostButton theme={theme} onClick={() => void revoke(token.id)} disabled={busy}>
                  เพิกถอน
                </GhostButton>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Everything the Shortcut needs, in the order its fields appear.
 *
 * Four copyable rows rather than one QR, because the realistic setup is one
 * person building the Shortcut on the SAME phone that is showing this screen —
 * so copy-to-clipboard is the mechanism that fits, and a QR would mean scanning
 * yourself. The QR is kept for the token alone, which covers the other case:
 * the app open on a desktop and the Shortcut being built on a phone.
 *
 * The two `CF-Access-*` values come from the server (`/api/me/share-setup`) so
 * an employee never has to be handed credentials out of band — and, more to the
 * point, so nobody is tempted to publish a pre-filled Shortcut via an iCloud
 * link, which would embed them in a publicly fetchable URL.
 */
function IssuedToken({
  theme,
  token,
  setup,
}: {
  theme: Theme;
  token: string;
  setup: ShareSetup | null;
}) {
  const qr = useMemo(() => encodeQr(token), [token]);
  const border = 2;
  const dim = qr.size + border * 2;

  return (
    <Card theme={theme} padding={16} style={{ marginBottom: 16 }}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 600,
          color: theme.ink,
          marginBottom: 4,
        }}
      >
        รหัสนี้จะแสดงเพียงครั้งเดียว
      </div>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginBottom: 14 }}>
        เปิดแอป Shortcuts แล้วคัดลอกทีละช่องไปวางตามลำดับด้านล่าง
      </div>

      <CopyRow theme={theme} label="URL" value={setup?.uploadUrl ?? ''} />
      <CopyRow theme={theme} label="Authorization" value={`Bearer ${token}`} highlight />
      {setup?.configured ? (
        <>
          <CopyRow theme={theme} label="CF-Access-Client-Id" value={setup.clientId ?? ''} />
          <CopyRow
            theme={theme}
            label="CF-Access-Client-Secret"
            value={setup.clientSecret ?? ''}
            secret
          />
        </>
      ) : (
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.warn,
            background: theme.surface2,
            padding: '10px 12px',
            borderRadius: 8,
            marginTop: 8,
            lineHeight: 1.6,
          }}
        >
          ยังไม่ได้ตั้งค่ารหัสอุปกรณ์ในระบบ — ขอค่า CF-Access-Client-Id และ
          CF-Access-Client-Secret จากผู้ดูแลระบบ
        </div>
      )}

      <details style={{ marginTop: 14 }}>
        <summary
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.inkSoft,
            cursor: 'pointer',
          }}
        >
          ตั้งค่าจากคอมพิวเตอร์? สแกน QR นี้ด้วยมือถือ
        </summary>
        <div
          style={{
            width: 190,
            height: 190,
            margin: '12px auto 0',
            background: '#fff',
            padding: 8,
            borderRadius: 10,
            boxSizing: 'content-box',
          }}
        >
          <svg
            viewBox={`0 0 ${dim} ${dim}`}
            style={{ width: '100%', height: '100%', display: 'block' }}
            role="img"
            aria-label="QR รหัสเชื่อมต่อมือถือ"
          >
            <rect width={dim} height={dim} fill="#FFFFFF" />
            <path d={qrSvgPath(qr, border)} fill="#000000" />
          </svg>
        </div>
      </details>
    </Card>
  );
}

/**
 * One labelled value with a copy button.
 *
 * `secret` masks the value until tapped: the service-token secret is the one
 * thing here that is shared across every staff phone, so it should not sit
 * legible on a screen in a hotel lobby. It is still selectable once revealed —
 * masking is shoulder-surfing hygiene, not a security boundary.
 */
function CopyRow({
  theme,
  label,
  value,
  highlight = false,
  secret = false,
}: {
  theme: Theme;
  label: string;
  value: string;
  highlight?: boolean;
  secret?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(!secret);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard is blocked outside a secure context or without permission.
      // The value is on screen and selectable, so this is a convenience miss,
      // not a dead end — reveal it instead of raising an alarm.
      setRevealed(true);
    }
  };

  return (
    <div style={{ marginBottom: 10 }}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSofter,
          marginBottom: 3,
        }}
      >
        {label}
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
        <div
          onClick={() => setRevealed(true)}
          style={{
            flex: 1,
            minWidth: 0,
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: highlight ? theme.ink : theme.inkSoft,
            wordBreak: 'break-all',
            background: theme.surface2,
            border: `1px solid ${highlight ? theme.accent : theme.hairline}`,
            padding: '9px 11px',
            borderRadius: 8,
            userSelect: revealed ? 'all' : 'none',
            cursor: revealed ? 'text' : 'pointer',
          }}
        >
          {revealed ? value : '•'.repeat(Math.min(value.length, 40)) || '—'}
        </div>
        <button
          type="button"
          onClick={() => void copy()}
          aria-label={`คัดลอก ${label}`}
          style={{
            flex: 'none',
            width: 64,
            fontFamily: FONT_UI,
            fontSize: 12,
            fontWeight: 600,
            color: copied ? theme.success : theme.accent,
            background: 'none',
            border: `1px solid ${copied ? theme.success : theme.hairline}`,
            borderRadius: 8,
            cursor: 'pointer',
          }}
        >
          {copied ? '✓' : 'คัดลอก'}
        </button>
      </div>
    </div>
  );
}

function Steps({ theme }: { theme: Theme }) {
  const STEPS = [
    'เปิดแอป Shortcuts → กด + → ตั้งชื่อว่า "ส่งใบเสร็จ"',
    'กด ⓘ → เปิด Show in Share Sheet → เลือกเฉพาะ Images และ Files',
    'เพิ่มแอ็กชัน Get Contents of URL แล้วคัดลอก 4 ช่องด้านบนไปวาง',
    'เสร็จแล้ว: เปิดรูปใบเสร็จ → ปุ่มแชร์ → "ส่งใบเสร็จ"',
  ];

  return (
    <Card theme={theme} padding={16}>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 600,
          color: theme.ink,
          marginBottom: 10,
        }}
      >
        วิธีตั้งค่าบน iPhone
      </div>
      <ol style={{ margin: 0, paddingInlineStart: 20 }}>
        {STEPS.map((step) => (
          <li
            key={step}
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.inkSoft,
              lineHeight: 1.7,
              marginBottom: 4,
            }}
          >
            {step}
          </li>
        ))}
      </ol>
      <a
        href={SHORTCUT_HELP_PATH}
        style={{
          display: 'inline-block',
          marginTop: 10,
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.accent,
          textDecoration: 'none',
        }}
      >
        ดูวิธีตั้งค่าแบบละเอียด →
      </a>
    </Card>
  );
}
