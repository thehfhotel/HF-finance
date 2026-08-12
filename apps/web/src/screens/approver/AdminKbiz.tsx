import { useEffect, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import type {
  AdminUser,
  KbizCategoryId,
  KbizCategoryMapping,
  KbizPayeeHandles,
  Theme,
  User,
} from '../../lib/types';
import { KBIZ_CATEGORIES, RECEIPT_CATEGORIES } from '../../lib/types';
import { useViewportPlatform } from '../../lib/useViewportPlatform';
import { AppSidebar } from '../../components/AppSidebar';
import type { SidebarCounts } from '../../components/AppSidebar';
import type { Route } from '../../lib/router';
import { DesktopShell } from '../../components/DesktopShell';
import { AppBar } from '../../components/AppBar';
import { Avatar, Card, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';

interface AdminKbizProps {
  theme: Theme;
  /** Optional — when set, the back action navigates via the app's router instead of `window.history.back()`. */
  onBack?: () => void;
  /** Shown in the sidebar footer; the sidebar is the same one every screen renders. */
  currentUser?: User | null;
  /** Lets the shared sidebar reach the other screens, so this page is a
   *  destination in the menu rather than a dead end with a back link. */
  onNavigate?: (route: Route) => void;
  /** The same numbers the other screens show. This page owns no bundle state,
   *  so without them every count in the "identical" menu silently disappears. */
  counts?: SidebarCounts;
  onLogout?: () => void;
}

interface ToastMessage {
  id: number;
  text: string;
  tone: 'error' | 'info';
}

/** Deterministic string of the mapping's editable content — key order in the
 *  underlying object may drift as rows are edited, but the compare must not. */
function mappingKey(categories: Record<string, string>, defaultCategoryId: string): string {
  const rows = RECEIPT_CATEGORIES.map((cat) => `${cat}=${categories[cat] ?? ''}`).sort();
  return `${defaultCategoryId}|${rows.join(',')}`;
}

/** Same idea for the payee handles: only the users actually shown matter, and
 *  values are trimmed so whitespace-only edits never read as "dirty". */
function payeesKey(payees: Record<string, string>, users: AdminUser[]): string {
  return users.map((u) => `${u.id}=${(payees[u.id] ?? '').trim()}`).sort().join(',');
}

export function AdminKbiz({
  theme,
  onBack,
  currentUser,
  onNavigate,
  onLogout,
  counts,
}: AdminKbizProps): JSX.Element {
  const platform = useViewportPlatform();
  const isMobile = platform === 'mobile';

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [users, setUsers] = useState<AdminUser[]>([]);

  const [savedMapping, setSavedMapping] = useState<KbizCategoryMapping | null>(null);
  const [savedPayees, setSavedPayees] = useState<KbizPayeeHandles>({});
  const [categoryDraft, setCategoryDraft] = useState<Record<string, KbizCategoryId>>({});
  const [defaultCategoryDraft, setDefaultCategoryDraft] = useState<KbizCategoryId>('12');
  const [payeeDraft, setPayeeDraft] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [settings, userList] = await Promise.all([
          api.admin.getKbizSettings(),
          api.admin.listUsers(),
        ]);
        if (cancelled) return;
        setSavedMapping(settings.mapping);
        setCategoryDraft(settings.mapping.categories);
        setDefaultCategoryDraft(settings.mapping.defaultCategoryId);
        setSavedPayees(settings.payees);
        setPayeeDraft(settings.payees);
        setConfigured(settings.configured);
        setUsers(userList);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'โหลดการตั้งค่าไม่สำเร็จ');
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const handle = window.setTimeout(() => setToast(null), 4000);
    return () => window.clearTimeout(handle);
  }, [toast]);

  const showError = (err: unknown): void => {
    const text = err instanceof ApiError ? err.message : err instanceof Error ? err.message : 'เกิดข้อผิดพลาด';
    setToast({ id: Date.now(), text, tone: 'error' });
  };
  const showInfo = (text: string): void => {
    setToast({ id: Date.now(), text, tone: 'info' });
  };

  const mappingDirty =
    savedMapping !== null &&
    mappingKey(categoryDraft, defaultCategoryDraft) !== mappingKey(savedMapping.categories, savedMapping.defaultCategoryId);
  const payeesDirty = payeesKey(payeeDraft, users) !== payeesKey(savedPayees, users);
  const dirty = mappingDirty || payeesDirty;

  const handleSave = async (): Promise<void> => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const mapping: KbizCategoryMapping = {
        categories: Object.fromEntries(
          RECEIPT_CATEGORIES.map((cat) => [cat, categoryDraft[cat] ?? defaultCategoryDraft]),
        ) as Record<string, KbizCategoryId>,
        defaultCategoryId: defaultCategoryDraft,
      };
      // Only rows with a value are ever sent — a blank handle means "cannot
      // pay via KBIZ", not "handle set to empty string".
      const payees: KbizPayeeHandles = Object.fromEntries(
        users
          .map((u) => [u.id, (payeeDraft[u.id] ?? '').trim()] as const)
          .filter(([, handle]) => handle !== ''),
      );
      const result = await api.admin.putKbizSettings({ mapping, payees });
      setSavedMapping(result.mapping);
      setCategoryDraft(result.mapping.categories);
      setDefaultCategoryDraft(result.mapping.defaultCategoryId);
      setSavedPayees(result.payees);
      setPayeeDraft(result.payees);
      setConfigured(result.configured);
      showInfo('บันทึกการตั้งค่า KBIZ แล้ว');
    } catch (err) {
      showError(err);
    } finally {
      setSaving(false);
    }
  };

  const handleBack = (): void => {
    if (onBack) {
      onBack();
    } else {
      window.history.back();
    }
  };

  const body = (
    <SettingsBody
      theme={theme}
      configured={configured}
      loading={loading}
      loadError={loadError}
      categoryDraft={categoryDraft}
      defaultCategoryDraft={defaultCategoryDraft}
      onCategoryChange={(cat, id) => setCategoryDraft((prev) => ({ ...prev, [cat]: id }))}
      onDefaultCategoryChange={setDefaultCategoryDraft}
      users={users}
      payeeDraft={payeeDraft}
      onPayeeChange={(userId, handle) => setPayeeDraft((prev) => ({ ...prev, [userId]: handle }))}
    />
  );

  if (isMobile) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.paper, position: 'relative' }}>
        {toast && <SettingsToast theme={theme} message={toast} onClose={() => setToast(null)} />}

        <AppBar
          theme={theme}
          large
          subtitle="การจัดการ"
          title="ตั้งค่า KBIZ"
          leading={
            <button
              onClick={handleBack}
              style={{
                background: 'transparent',
                border: 'none',
                padding: '4px 0',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                color: theme.accent,
                fontFamily: FONT_UI,
                fontSize: 14,
              }}
            >
              {Icon.back(theme.accent)}
              <span>กลับ</span>
            </button>
          }
        />

        <div style={{ flex: 1, overflowY: 'auto', WebkitOverflowScrolling: 'touch' } as CSSProperties}>
          <div style={{ padding: '8px 16px 120px' }}>{body}</div>
        </div>

        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '14px 16px calc(14px + env(safe-area-inset-bottom))',
            background: `linear-gradient(180deg, transparent, ${theme.paper} 30%)`,
          }}
        >
          {dirty && (
            <div
              style={{
                textAlign: 'center',
                marginBottom: 8,
                fontFamily: FONT_UI,
                fontSize: 12,
                color: theme.warn,
              }}
            >
              มีการเปลี่ยนแปลงที่ยังไม่บันทึก
            </div>
          )}
          <PrimaryButton theme={theme} disabled={!dirty || saving} onClick={() => void handleSave()}>
            {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
          </PrimaryButton>
        </div>
      </div>
    );
  }

  const sidebar = (
    <AppSidebar
      theme={theme}
      currentUser={currentUser ?? null}
      isApprover
      active="admin-kbiz"
      counts={counts}
      onSelect={(key) => {
        if (key === 'employees') return onNavigate?.({ name: 'admin-employees' });
        if (key === 'admin-kbiz') return onNavigate?.({ name: 'admin-kbiz' });
        if (key === 'overview') return onNavigate?.({ name: 'overview' });
        if (key.startsWith('my-')) {
          const view = key.slice(3) as 'drafts' | 'pending' | 'approved' | 'paid' | 'rejected';
          return onNavigate?.({ name: 'my-requests', view });
        }
        onNavigate?.({ name: 'approver-home', filter: key as 'pending' });
      }}
      onLogout={onLogout}
    />
  );

  return (
    <DesktopShell theme={theme} sidebar={sidebar}>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: theme.paper }}>
        {toast && <SettingsToast theme={theme} message={toast} onClose={() => setToast(null)} />}

        <div style={{ flex: 1, overflow: 'auto' }}>
          <div style={{ padding: '32px 40px 80px', maxWidth: 860 }}>
            <TopBar theme={theme} dirty={dirty} saving={saving} onSave={() => void handleSave()} />
            {body}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

// ── Top bar (desktop) ───────────────────────────────────────────────

interface TopBarProps {
  theme: Theme;
  dirty: boolean;
  saving: boolean;
  onSave: () => void;
}

function TopBar({ theme, dirty, saving, onSave }: TopBarProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 24,
        marginBottom: 24,
      }}
    >
      <div>
        <h1
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            color: theme.ink,
          }}
        >
          ตั้งค่า KBIZ
        </h1>
        <div style={{ marginTop: 4, fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
          {dirty ? (
            <span style={{ color: theme.warn }}>มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
          ) : (
            'การโอนอัตโนมัติผ่าน KBIZ สำหรับคำขอที่อนุมัติแล้ว'
          )}
        </div>
      </div>
      <div style={{ minWidth: 160 }}>
        <PrimaryButton theme={theme} full={false} disabled={!dirty || saving} onClick={onSave}>
          {saving ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่า'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Shared body (both mobile and desktop) ────────────────────────────

interface SettingsBodyProps {
  theme: Theme;
  configured: boolean;
  loading: boolean;
  loadError: string | null;
  categoryDraft: Record<string, KbizCategoryId>;
  defaultCategoryDraft: KbizCategoryId;
  onCategoryChange: (category: string, id: KbizCategoryId) => void;
  onDefaultCategoryChange: (id: KbizCategoryId) => void;
  users: AdminUser[];
  payeeDraft: Record<string, string>;
  onPayeeChange: (userId: string, handle: string) => void;
}

function SettingsBody({
  theme,
  configured,
  loading,
  loadError,
  categoryDraft,
  defaultCategoryDraft,
  onCategoryChange,
  onDefaultCategoryChange,
  users,
  payeeDraft,
  onPayeeChange,
}: SettingsBodyProps): JSX.Element {
  if (loading) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
        กำลังโหลด...
      </div>
    );
  }

  if (loadError) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>
        {loadError}
      </div>
    );
  }

  return (
    <div>
      {!configured && (
        <div
          style={{
            marginBottom: 18,
            padding: '12px 16px',
            borderRadius: 12,
            background: `${theme.warn}18`,
            borderLeft: `3px solid ${theme.warn}`,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.ink,
            lineHeight: 1.5,
          }}
        >
          ยังไม่ได้เปิดใช้งานการโอนอัตโนมัติบนเซิร์ฟเวอร์
          <span style={{ display: 'block', color: theme.inkSoft, marginTop: 2 }}>
            ต้องสร้างโฟลเดอร์คิวที่ใช้ร่วมกับ kbiz-bot (queue/) บนเครื่องเซิร์ฟเวอร์ก่อน — ตั้งค่าที่นี่เก็บไว้ได้ แต่จะยังโอนไม่ได้
          </span>
        </div>
      )}

      <SectionLabel theme={theme}>จับคู่หมวดหมู่ใบเสร็จ → หมวดหมู่ KBIZ</SectionLabel>
      <Card theme={theme} padding={0}>
        <SelectRow
          theme={theme}
          label="หมวดหมู่เริ่มต้น (เมื่อไม่พบหมวดที่ตรง)"
          value={defaultCategoryDraft}
          onChange={(id) => onDefaultCategoryChange(id)}
          strong
        />
        {RECEIPT_CATEGORIES.map((cat, i) => (
          <SelectRow
            key={cat}
            theme={theme}
            label={cat}
            value={categoryDraft[cat] ?? defaultCategoryDraft}
            onChange={(id) => onCategoryChange(cat, id)}
            isLast={i === RECEIPT_CATEGORIES.length - 1}
          />
        ))}
      </Card>

      <SectionLabel theme={theme}>บัญชีผู้รับเงินสำหรับโอนอัตโนมัติ</SectionLabel>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
        ระบุชื่อย่อบัญชีผู้รับที่บันทึกไว้ใน KBIZ (พิมพ์เป็นตัวอักษรอังกฤษ) — เว้นว่างหากพนักงานคนนั้นยังโอนผ่าน KBIZ ไม่ได้
      </div>
      <Card theme={theme} padding={0}>
        {users.length === 0 ? (
          <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
            ยังไม่มีพนักงาน
          </div>
        ) : (
          users.map((u, i) => (
            <PayeeRow
              key={u.id}
              theme={theme}
              user={u}
              value={payeeDraft[u.id] ?? ''}
              onChange={(v) => onPayeeChange(u.id, v)}
              isLast={i === users.length - 1}
            />
          ))
        )}
      </Card>
    </div>
  );
}

function SectionLabel({ theme, children }: { theme: Theme; children: ReactNode }): JSX.Element {
  return (
    <div
      style={{
        fontFamily: FONT_UI,
        fontSize: 11,
        color: theme.inkSoft,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        fontWeight: 500,
        margin: '22px 0 10px',
      }}
    >
      {children}
    </div>
  );
}

// ── Category mapping row ──────────────────────────────────────────────

interface SelectRowProps {
  theme: Theme;
  label: string;
  value: KbizCategoryId;
  onChange: (id: KbizCategoryId) => void;
  isLast?: boolean;
  /** The default-category row reads slightly heavier — it isn't one of the
   *  RECEIPT_CATEGORIES rows below it. */
  strong?: boolean;
}

function SelectRow({ theme, label, value, onChange, isLast, strong }: SelectRowProps): JSX.Element {
  return (
    <div
      style={{
        padding: '12px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderBottom: isLast ? 'none' : `0.5px solid ${theme.hairline}`,
      }}
    >
      <div
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: strong ? 600 : 400,
          color: theme.ink,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </div>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value as KbizCategoryId)}
        style={{
          minWidth: 190,
          padding: '9px 10px',
          borderRadius: 10,
          background: theme.surface,
          border: `0.5px solid ${theme.hairlineStrong}`,
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.ink,
          outline: 'none',
        }}
      >
        {KBIZ_CATEGORIES.map((c) => (
          <option key={c.id} value={c.id}>
            {c.th}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Payee row ───────────────────────────────────────────────────────

interface PayeeRowProps {
  theme: Theme;
  user: AdminUser;
  value: string;
  onChange: (v: string) => void;
  isLast: boolean;
}

function PayeeRow({ theme, user, value, onChange, isLast }: PayeeRowProps): JSX.Element {
  const roleLabel = user.role === 'approver' ? 'ผู้อนุมัติ' : 'พนักงาน';
  return (
    <div
      style={{
        padding: '10px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        borderBottom: isLast ? 'none' : `0.5px solid ${theme.hairline}`,
      }}
    >
      <Avatar theme={theme} initials={user.initials} size={32} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 13,
            fontWeight: 500,
            color: theme.ink,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {user.name}
        </div>
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft }}>{roleLabel}</div>
      </div>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="เช่น revew"
        style={{
          width: 160,
          padding: '9px 12px',
          borderRadius: 10,
          background: theme.surface,
          border: `0.5px solid ${theme.hairlineStrong}`,
          fontFamily: FONT_MONO,
          fontSize: 13,
          color: theme.ink,
          outline: 'none',
          boxSizing: 'border-box',
        }}
      />
    </div>
  );
}

// ── Toast (copied pattern from ManageEmployees — private per screen) ──

function SettingsToast({
  theme,
  message,
  onClose,
}: {
  theme: Theme;
  message: ToastMessage;
  onClose: () => void;
}): JSX.Element {
  const isError = message.tone === 'error';
  return (
    <div
      style={{
        position: 'absolute',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        minWidth: 280,
        maxWidth: 480,
        padding: '12px 16px',
        borderRadius: 12,
        background: isError ? theme.danger : theme.ink,
        color: '#fff',
        fontFamily: FONT_UI,
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 12px 30px rgba(0,0,0,0.2)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        zIndex: 100,
      }}
    >
      <span style={{ flex: 1 }}>{message.text}</span>
      <button
        onClick={onClose}
        style={{
          background: 'transparent',
          border: 'none',
          color: '#fff',
          fontSize: 16,
          cursor: 'pointer',
          opacity: 0.8,
          padding: 0,
          lineHeight: 1,
        }}
      >
        ×
      </button>
    </div>
  );
}
