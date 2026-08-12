import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { ApiError, api } from '../lib/api';
import type { PublishedPayee } from '../lib/api';
import { fmtN } from '../lib/format';
import {
  KBIZ_ACCOUNT_NO_MAX_DIGITS,
  KBIZ_ACCOUNT_NO_MIN_DIGITS,
  countKbizAccountDigits,
  formatKbizAccountLabel,
  formatKbizFavoriteLabel,
  isValidKbizAccountNo,
  sanitizeKbizAccountNoInput,
} from '../lib/kbizDestination';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../lib/theme';
import type { BundleWithDetails, KbizDestination, KbizFavorite, Theme } from '../lib/types';
import { KBIZ_BANKS_TH } from '../lib/types';
import { Card, GhostButton, PrimaryButton } from './primitives';

type Mode = 'handle' | 'favorite' | 'custom';

const MODE_LABEL: Record<Mode, string> = {
  handle: 'บัญชีที่ผูกไว้',
  favorite: 'เลือกจากบัญชีที่บันทึกไว้',
  custom: 'บัญชีอื่น',
};

/** What the picker hands back once the approver commits to a destination. */
export interface KbizChosenDestination {
  destination: KbizDestination;
  /** Account-name-first, human-readable — for the confirm dialog's summary
   *  line, so the approver reads the FULL destination before it becomes
   *  irreversible. */
  summary: string;
}

export interface KbizDestinationPickerProps {
  theme: Theme;
  bundle: BundleWithDetails;
  onClose: () => void;
  onConfirm: (chosen: KbizChosenDestination) => void;
  /** Navigates to ตั้งค่า (admin-kbiz) — offered from the empty-favorites state. */
  onGotoSettings: () => void;
}

/**
 * Pay-time destination picker for "จ่ายผ่าน KBIZ" — one shared component for
 * both the desktop confirm flow (Desktop.tsx) and the mobile approver
 * (Review.tsx). It fetches its own copy of the admin KBIZ settings (the
 * submitter's mapped handle + its published details, and the bot-synced
 * favorites) so both call sites stay thin.
 *
 * Ends by handing the parent a resolved `KbizDestination` plus a ready-to-read
 * summary line; the parent still runs its own (existing) ConfirmDialog as the
 * final, irreversible step — this picker never calls payViaKbiz itself.
 */
export function KbizDestinationPicker({ theme, bundle, onClose, onConfirm, onGotoSettings }: KbizDestinationPickerProps) {
  const [payees, setPayees] = useState<Record<string, string> | null>(null);
  const [availablePayees, setAvailablePayees] = useState<PublishedPayee[] | null>(null);
  const [favorites, setFavorites] = useState<KbizFavorite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode | null>(null);
  const [favoriteKey, setFavoriteKey] = useState<string | null>(null);
  const [customBank, setCustomBank] = useState('');
  const [customAccountNo, setCustomAccountNo] = useState('');
  const [customAccountName, setCustomAccountName] = useState('');

  useEffect(() => {
    let cancelled = false;
    api.admin
      .getKbizSettings()
      .then((settings) => {
        if (cancelled) return;
        setPayees(settings.payees);
        setAvailablePayees(settings.availablePayees ?? null);
        // Keep null (never synced) distinct from [] (synced, nothing saved)
        // — EmptyFavorites below reads this to pick the right message/CTA.
        setFavorites(settings.favorites);
        const mappedHandle = settings.payees[bundle.userId] ?? '';
        setMode(mappedHandle.trim() !== '' ? 'handle' : (settings.favorites?.length ?? 0) > 0 ? 'favorite' : 'custom');
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof ApiError ? err.message : 'โหลดบัญชีปลายทางไม่สำเร็จ');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [bundle.userId]);

  // Esc closes, matching ConfirmDialog/PaySheet.
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const total = bundle.receipts.reduce((acc, r) => acc + r.amount, 0);
  const mappedHandle = payees?.[bundle.userId] ?? '';
  const hasHandle = mappedHandle.trim() !== '';
  const mappedPayee: PublishedPayee | null = hasHandle
    ? (availablePayees?.find((p) => p.handle === mappedHandle) ?? null)
    : null;
  const favoriteList = favorites ?? [];

  const availableModes: Mode[] = [
    ...(hasHandle ? (['handle'] as const) : []),
    'favorite',
    'custom',
  ];

  const digitCount = countKbizAccountDigits(customAccountNo);
  const customValid = customBank.trim() !== '' && isValidKbizAccountNo(customAccountNo);

  const valid =
    mode === 'handle' ? hasHandle : mode === 'favorite' ? favoriteKey !== null : mode === 'custom' ? customValid : false;

  const handleConfirm = (): void => {
    if (!valid) return;
    if (mode === 'handle') {
      onConfirm({
        destination: { kind: 'handle', handle: mappedHandle },
        summary: formatKbizAccountLabel(mappedPayee ?? {}, mappedHandle),
      });
    } else if (mode === 'favorite') {
      const fav = favoriteKey !== null ? favoriteList[Number(favoriteKey)] : undefined;
      if (!fav) return;
      onConfirm({
        destination: {
          kind: 'favorite',
          nickname: fav.nickname,
          bank: fav.bank,
          accountLast4: fav.accountLast4,
          ...(fav.accountName ? { accountName: fav.accountName } : {}),
        },
        summary: formatKbizFavoriteLabel(fav),
      });
    } else if (mode === 'custom') {
      const accountName = customAccountName.trim();
      onConfirm({
        destination: {
          kind: 'custom',
          bank: customBank,
          accountNo: customAccountNo,
          ...(accountName ? { accountName } : {}),
        },
        summary: accountName ? `${accountName} · ${customBank} ${customAccountNo}` : `${customBank} ${customAccountNo}`,
      });
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,5,0.55)',
        backdropFilter: 'blur(6px)',
        zIndex: 260,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxWidth: 480,
          maxHeight: '86vh',
          display: 'flex',
          flexDirection: 'column',
          background: theme.paper,
          borderRadius: 18,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          fontFamily: FONT_UI,
        }}
      >
        <div style={{ padding: '28px 28px 0', flexShrink: 0 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 18 }}>
            <div>
              <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, letterSpacing: 1.4, textTransform: 'uppercase' }}>
                โอนผ่าน KBIZ
              </div>
              <div style={{ fontFamily: FONT_DISPLAY, fontSize: 24, color: theme.ink, marginTop: 4, letterSpacing: -0.4 }}>
                เลือกบัญชีปลายทาง
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 4 }}>
                {bundle.submitter.name} · ฿{fmtN(total)}
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 16,
                background: theme.surface2,
                border: 'none',
                cursor: 'pointer',
                color: theme.inkSoft,
                fontSize: 16,
                flexShrink: 0,
              }}
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: '0 28px' }}>
          {loading ? (
            <div style={{ padding: '30px 0 40px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
              กำลังโหลดบัญชีปลายทาง...
            </div>
          ) : loadError ? (
            <div style={{ padding: '30px 0 40px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>
              {loadError}
            </div>
          ) : (
            <>
              <ModeTabs theme={theme} modes={availableModes} value={mode} onChange={setMode} />

              <div style={{ marginTop: 16, marginBottom: 8 }}>
                {mode === 'handle' && (
                  <Card theme={theme} padding={16}>
                    <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 6 }}>
                      บัญชีที่ผูกไว้กับ {bundle.submitter.name}
                    </div>
                    <div style={{ fontFamily: FONT_UI, fontSize: 15, fontWeight: 600, color: theme.ink, lineHeight: 1.4 }}>
                      {formatKbizAccountLabel(mappedPayee ?? {}, mappedHandle)}
                    </div>
                    <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter, marginTop: 6 }}>#{mappedHandle}</div>
                  </Card>
                )}

                {mode === 'favorite' && (
                  favoriteList.length === 0 ? (
                    <EmptyFavorites
                      theme={theme}
                      favorites={favorites}
                      onGotoSettings={onGotoSettings}
                      onUseCustom={() => setMode('custom')}
                    />
                  ) : (
                    <Card theme={theme} padding={0}>
                      {favoriteList.map((fav, i) => {
                        const key = String(i);
                        const selected = favoriteKey === key;
                        return (
                          <div
                            key={key}
                            onClick={() => setFavoriteKey(key)}
                            style={{
                              padding: '12px 16px',
                              display: 'flex',
                              alignItems: 'center',
                              gap: 12,
                              cursor: 'pointer',
                              background: selected ? theme.surface2 : 'transparent',
                              borderBottom: i < favoriteList.length - 1 ? `0.5px solid ${theme.hairline}` : 'none',
                            }}
                          >
                            <RadioDot theme={theme} selected={selected} />
                            <div style={{ flex: 1, minWidth: 0, fontFamily: FONT_UI, fontSize: 13, fontWeight: 500, color: theme.ink }}>
                              {formatKbizFavoriteLabel(fav)}
                            </div>
                          </div>
                        );
                      })}
                    </Card>
                  )
                )}

                {mode === 'custom' && (
                  <div>
                    <FieldLabel theme={theme}>ธนาคาร</FieldLabel>
                    <select
                      value={customBank}
                      onChange={(e) => setCustomBank(e.target.value)}
                      style={selectStyle(theme)}
                    >
                      <option value="" disabled>
                        เลือกธนาคาร
                      </option>
                      {KBIZ_BANKS_TH.map((bank) => (
                        <option key={bank} value={bank}>
                          {bank}
                        </option>
                      ))}
                    </select>

                    <FieldLabel theme={theme} style={{ marginTop: 16 }}>เลขที่บัญชี</FieldLabel>
                    <input
                      value={customAccountNo}
                      onChange={(e) => setCustomAccountNo(sanitizeKbizAccountNoInput(e.target.value))}
                      placeholder="123-4-56789-0"
                      inputMode="numeric"
                      style={inputStyle(theme)}
                    />
                    <div
                      style={{
                        fontFamily: FONT_UI,
                        fontSize: 11,
                        marginTop: 5,
                        color: digitCount === 0 ? theme.inkSoft : isValidKbizAccountNo(customAccountNo) ? theme.success : theme.danger,
                      }}
                    >
                      {digitCount} หลัก
                      {digitCount > 0 && !isValidKbizAccountNo(customAccountNo)
                        ? ` (ต้อง ${KBIZ_ACCOUNT_NO_MIN_DIGITS}-${KBIZ_ACCOUNT_NO_MAX_DIGITS} หลัก)`
                        : ''}
                    </div>

                    <FieldLabel theme={theme} style={{ marginTop: 16 }}>ชื่อบัญชี (ถ้าทราบ)</FieldLabel>
                    <input
                      value={customAccountName}
                      onChange={(e) => setCustomAccountName(e.target.value)}
                      placeholder="ชื่อ-นามสกุลเจ้าของบัญชี"
                      maxLength={80}
                      style={inputStyle(theme)}
                    />
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div style={{ padding: '16px 28px 28px', flexShrink: 0, display: 'flex', gap: 10 }}>
          <GhostButton theme={theme} onClick={onClose}>
            ยกเลิก
          </GhostButton>
          <div style={{ flex: 1 }}>
            <PrimaryButton theme={theme} disabled={loading || !!loadError || !valid} onClick={handleConfirm}>
              ยืนยัน
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Small subcomponents ─────────────────────────────────────────────

function ModeTabs({
  theme,
  modes,
  value,
  onChange,
}: {
  theme: Theme;
  modes: Mode[];
  value: Mode | null;
  onChange: (m: Mode) => void;
}) {
  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
      {modes.map((m) => {
        const selected = value === m;
        return (
          <button
            key={m}
            onClick={() => onChange(m)}
            style={{
              padding: '8px 14px',
              borderRadius: 100,
              background: selected ? theme.ink : 'transparent',
              color: selected ? theme.paper : theme.ink,
              border: `0.5px solid ${selected ? theme.ink : theme.hairlineStrong}`,
              fontFamily: FONT_UI,
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {MODE_LABEL[m]}
          </button>
        );
      })}
    </div>
  );
}

function EmptyFavorites({
  theme,
  favorites,
  onGotoSettings,
  onUseCustom,
}: {
  theme: Theme;
  /** null = never synced on this host; [] = synced, KBIZ just has nothing
   *  saved — two different situations, so this can't collapse to a length
   *  check (see KbizSettings.favorites in lib/api.ts). */
  favorites: KbizFavorite[] | null;
  onGotoSettings: () => void;
  onUseCustom: () => void;
}) {
  const neverSynced = favorites === null;
  return (
    <div
      style={{
        padding: '20px 18px',
        textAlign: 'center',
        borderRadius: 14,
        background: theme.surface,
        border: `0.5px solid ${theme.hairline}`,
      }}
    >
      <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.ink, marginBottom: 6 }}>
        {neverSynced ? 'ยังไม่มีบัญชีที่ซิงค์จาก KBIZ' : 'ซิงค์แล้ว แต่ไม่มีบัญชีที่บันทึกไว้ใน KBIZ'}
      </div>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, lineHeight: 1.5, marginBottom: 14 }}>
        {neverSynced
          ? 'ไปที่ตั้งค่าเพื่อซิงค์รายชื่อบัญชีที่บันทึกไว้ใน KBIZ ก่อนเลือกจากที่นี่ได้'
          : 'เลือก "บัญชีอื่น" เพื่อกรอกเลขบัญชีแทนได้เลย'}
      </div>
      <button
        onClick={neverSynced ? onGotoSettings : onUseCustom}
        style={{
          background: 'transparent',
          border: 'none',
          color: theme.accent,
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 600,
          cursor: 'pointer',
          padding: 0,
        }}
      >
        {neverSynced ? 'ไปที่ตั้งค่า →' : 'ใช้บัญชีอื่น →'}
      </button>
    </div>
  );
}

function RadioDot({ theme, selected }: { theme: Theme; selected: boolean }) {
  return (
    <span
      style={{
        width: 16,
        height: 16,
        borderRadius: 8,
        flexShrink: 0,
        border: `1.5px solid ${selected ? theme.accent : theme.hairlineStrong}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {selected && <span style={{ width: 8, height: 8, borderRadius: 4, background: theme.accent }} />}
    </span>
  );
}

function FieldLabel({ theme, children, style }: { theme: Theme; children: string; style?: CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: FONT_UI,
        fontSize: 11,
        color: theme.inkSoft,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        marginBottom: 6,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

function selectStyle(theme: Theme): CSSProperties {
  return {
    width: '100%',
    padding: '11px 12px',
    borderRadius: 10,
    background: theme.surface,
    border: `0.5px solid ${theme.hairlineStrong}`,
    fontFamily: FONT_UI,
    fontSize: 14,
    color: theme.ink,
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
  };
}

function inputStyle(theme: Theme): CSSProperties {
  return {
    width: '100%',
    padding: '11px 14px',
    borderRadius: 10,
    background: theme.surface,
    border: `0.5px solid ${theme.hairlineStrong}`,
    fontFamily: FONT_UI,
    fontSize: 14,
    color: theme.ink,
    outline: 'none',
    boxSizing: 'border-box',
  };
}
