import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import type { KbizSettings, PublishedPayee } from '../../lib/api';
import { formatThaiRelative } from '../../lib/format';
import { formatKbizAccountLabel } from '../../lib/kbizDestination';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import type {
  AdminUser,
  KbizCategoryId,
  KbizCategoryMapping,
  KbizFavorite,
  KbizPayeeHandles,
  Theme,
  User,
} from '../../lib/types';
import { KBIZ_CATEGORIES } from '../../lib/types';
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

/** Favorites-sync poll cadence and give-up window — see handleSyncFavorites. */
const SYNC_POLL_MS = 3000;
const SYNC_TIMEOUT_MS = 90_000;

/** Deterministic string of the mapping's editable content — key order in the
 *  underlying object may drift as rows are edited, but the compare must not. */
function mappingKey(list: string[], categories: Record<string, string>, defaultCategoryId: string): string {
  const rows = list.map((cat) => `${cat}=${categories[cat] ?? ''}`).sort();
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

  const [savedCategories, setSavedCategories] = useState<string[]>([]);
  const [categoriesDraft, setCategoriesDraft] = useState<string[]>([]);
  const [newCategory, setNewCategory] = useState('');
  const [savedMapping, setSavedMapping] = useState<KbizCategoryMapping | null>(null);
  const [savedPayees, setSavedPayees] = useState<KbizPayeeHandles>({});
  const [categoryDraft, setCategoryDraft] = useState<Record<string, KbizCategoryId>>({});
  const [defaultCategoryDraft, setDefaultCategoryDraft] = useState<KbizCategoryId>('12');
  const [payeeDraft, setPayeeDraft] = useState<Record<string, string>>({});

  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [availableHandles, setAvailableHandles] = useState<string[] | null>(null);
  const [availablePayees, setAvailablePayees] = useState<PublishedPayee[] | null>(null);
  const [favorites, setFavorites] = useState<KbizFavorite[] | null>(null);
  const [favoritesUpdatedAt, setFavoritesUpdatedAt] = useState<string | null>(null);
  const [syncingFavorites, setSyncingFavorites] = useState(false);

  // Guards state updates from the sync-poll loop (setTimeout chain) once the
  // screen has gone away — the loop has no other way to know to stop.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const [settings, userList] = await Promise.all([
          api.admin.getKbizSettings(),
          api.admin.listUsers(),
        ]);
        if (cancelled) return;
        setSavedCategories(settings.receiptCategories);
        setCategoriesDraft(settings.receiptCategories);
        setSavedMapping(settings.mapping);
        setCategoryDraft(settings.mapping.categories);
        setDefaultCategoryDraft(settings.mapping.defaultCategoryId);
        setSavedPayees(settings.payees);
        setPayeeDraft(settings.payees);
        setConfigured(settings.configured);
        setAvailableHandles(settings.availableHandles ?? null);
        setAvailablePayees(settings.availablePayees ?? null);
        setFavorites(settings.favorites ?? null);
        setFavoritesUpdatedAt(settings.favoritesUpdatedAt ?? null);
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
  const showErrorText = (text: string): void => {
    setToast({ id: Date.now(), text, tone: 'error' });
  };

  /**
   * "ซิงค์จาก KBIZ" — queue the read-only favorites scrape, then poll
   * GET kbiz-settings until `favoritesUpdatedAt` moves OR the favorites list
   * itself changes — a manifest the bot publishes without a timestamp
   * (`readKbizFavorites` maps a missing/non-string `updatedAt` to `null`)
   * still carries a real account list, so waiting on the timestamp alone
   * would spin for the full 90s and then discard accounts that already
   * arrived. Either that, or 90s pass with no answer, in which case the
   * button releases and the toast points at kbiz-bot rather than spinning
   * forever on a bot that may be down — but even then the last poll's
   * favorites are applied first, so data already in hand is never thrown
   * away.
   */
  const handleSyncFavorites = async (): Promise<void> => {
    if (syncingFavorites || !configured) return;
    setSyncingFavorites(true);
    try {
      await api.admin.syncKbizFavorites();
    } catch (err) {
      if (mountedRef.current) {
        setSyncingFavorites(false);
        showError(err);
      }
      return;
    }

    const startedAt = favoritesUpdatedAt;
    const startedFavorites = JSON.stringify(favorites);
    const deadline = Date.now() + SYNC_TIMEOUT_MS;

    const poll = async (): Promise<void> => {
      if (!mountedRef.current) return;
      let settings: KbizSettings | null = null;
      try {
        settings = await api.admin.getKbizSettings();
      } catch {
        // Transient — keep polling until the deadline decides.
      }
      if (!mountedRef.current) return;
      if (settings !== null) {
        const changed =
          settings.favoritesUpdatedAt !== startedAt || JSON.stringify(settings.favorites) !== startedFavorites;
        if (changed) {
          setFavorites(settings.favorites ?? null);
          setFavoritesUpdatedAt(settings.favoritesUpdatedAt);
          setSyncingFavorites(false);
          showInfo('ซิงค์บัญชีจาก KBIZ แล้ว');
          return;
        }
      }
      if (Date.now() >= deadline) {
        // Apply whatever the last poll returned before giving up — a
        // manifest without a timestamp still carries real accounts.
        if (settings !== null) {
          setFavorites(settings.favorites ?? null);
          setFavoritesUpdatedAt(settings.favoritesUpdatedAt);
        }
        setSyncingFavorites(false);
        showErrorText('บอทยังไม่ตอบ — ตรวจสอบว่า kbiz-bot ทำงานอยู่');
        return;
      }
      window.setTimeout(() => void poll(), SYNC_POLL_MS);
    };
    window.setTimeout(() => void poll(), SYNC_POLL_MS);
  };

  const categoriesDirty = categoriesDraft.join('\u0001') !== savedCategories.join('\u0001');
  const mappingDirty =
    savedMapping !== null &&
    mappingKey(categoriesDraft, categoryDraft, defaultCategoryDraft) !==
      mappingKey(savedCategories, savedMapping.categories, savedMapping.defaultCategoryId);
  const payeesDirty = payeesKey(payeeDraft, users) !== payeesKey(savedPayees, users);
  const dirty = categoriesDirty || mappingDirty || payeesDirty;

  const handleSave = async (): Promise<void> => {
    if (saving || !dirty) return;
    setSaving(true);
    try {
      const mapping: KbizCategoryMapping = {
        categories: Object.fromEntries(
          categoriesDraft.map((cat) => [cat, categoryDraft[cat] ?? defaultCategoryDraft]),
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
      const result = await api.admin.putKbizSettings({ receiptCategories: categoriesDraft, mapping, payees });
      setSavedCategories(result.receiptCategories);
      setCategoriesDraft(result.receiptCategories);
      setSavedMapping(result.mapping);
      setCategoryDraft(result.mapping.categories);
      setDefaultCategoryDraft(result.mapping.defaultCategoryId);
      setSavedPayees(result.payees);
      setPayeeDraft(result.payees);
      setConfigured(result.configured);
      showInfo('บันทึกการตั้งค่าแล้ว');
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

  const addCategory = (): void => {
    const c = newCategory.trim();
    if (!c) return;
    if (categoriesDraft.includes(c)) {
      setToast({ id: Date.now(), text: `มีหมวดหมู่ "${c}" อยู่แล้ว`, tone: 'error' });
      return;
    }
    setCategoriesDraft((prev) => [...prev, c]);
    setNewCategory('');
  };
  const removeCategory = (cat: string): void => {
    setCategoriesDraft((prev) => (prev.length > 1 ? prev.filter((c) => c !== cat) : prev));
  };
  const moveCategory = (cat: string, dir: -1 | 1): void => {
    setCategoriesDraft((prev) => {
      const i = prev.indexOf(cat);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  };

  const body = (
    <SettingsBody
      theme={theme}
      configured={configured}
      loading={loading}
      loadError={loadError}
      receiptCategories={categoriesDraft}
      newCategory={newCategory}
      onNewCategoryChange={setNewCategory}
      onAddCategory={addCategory}
      onRemoveCategory={removeCategory}
      onMoveCategory={moveCategory}
      categoryDraft={categoryDraft}
      defaultCategoryDraft={defaultCategoryDraft}
      onCategoryChange={(cat, id) => setCategoryDraft((prev) => ({ ...prev, [cat]: id }))}
      onDefaultCategoryChange={setDefaultCategoryDraft}
      users={users}
      payeeDraft={payeeDraft}
      availableHandles={availableHandles}
      availablePayees={availablePayees}
      onPayeeChange={(userId, handle) => setPayeeDraft((prev) => ({ ...prev, [userId]: handle }))}
      favorites={favorites}
      favoritesUpdatedAt={favoritesUpdatedAt}
      syncingFavorites={syncingFavorites}
      onSyncFavorites={() => void handleSyncFavorites()}
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
          title="ตั้งค่า"
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
          ตั้งค่า
        </h1>
        <div style={{ marginTop: 4, fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
          {dirty ? (
            <span style={{ color: theme.warn }}>มีการเปลี่ยนแปลงที่ยังไม่บันทึก</span>
          ) : (
            'หมวดหมู่ใบเสร็จ · การโอนอัตโนมัติผ่าน KBIZ'
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
  receiptCategories: string[];
  newCategory: string;
  onNewCategoryChange: (v: string) => void;
  onAddCategory: () => void;
  onRemoveCategory: (cat: string) => void;
  onMoveCategory: (cat: string, dir: -1 | 1) => void;
  categoryDraft: Record<string, KbizCategoryId>;
  defaultCategoryDraft: KbizCategoryId;
  onCategoryChange: (category: string, id: KbizCategoryId) => void;
  onDefaultCategoryChange: (id: KbizCategoryId) => void;
  users: AdminUser[];
  payeeDraft: Record<string, string>;
  availableHandles: string[] | null;
  availablePayees: PublishedPayee[] | null;
  onPayeeChange: (userId: string, handle: string) => void;
  favorites: KbizFavorite[] | null;
  favoritesUpdatedAt: string | null;
  syncingFavorites: boolean;
  onSyncFavorites: () => void;
}

function SettingsBody({
  theme,
  configured,
  loading,
  loadError,
  receiptCategories,
  newCategory,
  onNewCategoryChange,
  onAddCategory,
  onRemoveCategory,
  onMoveCategory,
  categoryDraft,
  defaultCategoryDraft,
  onCategoryChange,
  onDefaultCategoryChange,
  users,
  payeeDraft,
  availableHandles,
  availablePayees,
  onPayeeChange,
  favorites,
  favoritesUpdatedAt,
  syncingFavorites,
  onSyncFavorites,
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

      <SectionLabel theme={theme}>หมวดหมู่ใบเสร็จ (แบบฟอร์มบันทึกใบเสร็จ)</SectionLabel>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSofter, marginBottom: 10, lineHeight: 1.5 }}>
        ใบเสร็จเดิมยังใช้ชื่อหมวดหมู่เดิม — การลบ/เปลี่ยนชื่อมีผลเฉพาะใบเสร็จใหม่
      </div>
      <Card theme={theme} padding={0}>
        {receiptCategories.map((cat, i) => (
          <div
            key={cat}
            style={{
              padding: '9px 14px 9px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              borderBottom: `0.5px solid ${theme.hairline}`,
            }}
          >
            <span style={{ flex: 1, fontFamily: FONT_UI, fontSize: 13, fontWeight: 500, color: theme.ink }}>{cat}</span>
            <button
              onClick={() => onMoveCategory(cat, -1)}
              disabled={i === 0}
              title="เลื่อนขึ้น"
              style={{ ...catBtnStyle(theme), opacity: i === 0 ? 0.25 : 1 }}
            >
              ↑
            </button>
            <button
              onClick={() => onMoveCategory(cat, 1)}
              disabled={i === receiptCategories.length - 1}
              title="เลื่อนลง"
              style={{ ...catBtnStyle(theme), opacity: i === receiptCategories.length - 1 ? 0.25 : 1 }}
            >
              ↓
            </button>
            <button
              onClick={() => onRemoveCategory(cat)}
              disabled={receiptCategories.length <= 1}
              title="ลบหมวดหมู่"
              style={{ ...catBtnStyle(theme), color: theme.danger, opacity: receiptCategories.length <= 1 ? 0.25 : 1 }}
            >
              ✕
            </button>
          </div>
        ))}
        <div style={{ padding: '10px 14px 10px 18px', display: 'flex', gap: 10 }}>
          <input
            value={newCategory}
            onChange={(e) => onNewCategoryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddCategory();
            }}
            placeholder="เพิ่มหมวดหมู่ใหม่…"
            maxLength={60}
            style={{
              flex: 1,
              padding: '9px 12px',
              borderRadius: 10,
              background: theme.surface,
              border: `0.5px solid ${theme.hairlineStrong}`,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.ink,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
          <button
            onClick={onAddCategory}
            disabled={newCategory.trim() === ''}
            style={{
              padding: '9px 16px',
              borderRadius: 10,
              background: newCategory.trim() === '' ? theme.surface : theme.ink,
              color: newCategory.trim() === '' ? theme.inkSofter : theme.paper,
              border: 'none',
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 500,
              cursor: newCategory.trim() === '' ? 'default' : 'pointer',
            }}
          >
            เพิ่ม
          </button>
        </div>
      </Card>

      <SectionLabel theme={theme}>จับคู่หมวดหมู่ใบเสร็จ → หมวดหมู่ KBIZ</SectionLabel>
      <Card theme={theme} padding={0}>
        <SelectRow
          theme={theme}
          label="หมวดหมู่เริ่มต้น (เมื่อไม่พบหมวดที่ตรง)"
          value={defaultCategoryDraft}
          onChange={(id) => onDefaultCategoryChange(id)}
          strong
        />
        {receiptCategories.map((cat, i) => (
          <SelectRow
            key={cat}
            theme={theme}
            label={cat}
            value={categoryDraft[cat] ?? defaultCategoryDraft}
            onChange={(id) => onCategoryChange(cat, id)}
            isLast={i === receiptCategories.length - 1}
          />
        ))}
      </Card>

      <SectionLabel theme={theme}>บัญชีผู้รับเงินสำหรับโอนอัตโนมัติ</SectionLabel>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginBottom: 10, lineHeight: 1.5 }}>
        {availableHandles !== null
          ? 'เลือกบัญชีผู้รับจากสมุดบัญชีของบอท — เลือก "—" หากพนักงานคนนั้นยังโอนผ่าน KBIZ ไม่ได้'
          : 'ระบุชื่อย่อบัญชีผู้รับที่บันทึกไว้ใน KBIZ (ยังไม่ได้รับรายชื่อจากบอท — ตรวจสอบว่า kbiz-bot ทำงานอยู่)'}
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
              availableHandles={availableHandles}
              availablePayees={availablePayees}
              onChange={(v) => onPayeeChange(u.id, v)}
              isLast={i === users.length - 1}
            />
          ))
        )}
      </Card>

      <SectionLabel theme={theme}>บัญชีที่บันทึกไว้ใน KBIZ</SectionLabel>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 10,
        }}
      >
        <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, lineHeight: 1.5 }}>
          {favoritesUpdatedAt
            ? `ซิงค์ล่าสุด ${formatThaiRelative(favoritesUpdatedAt)}`
            : favorites !== null
              ? 'ซิงค์แล้ว แต่ไม่ทราบเวลาซิงค์ล่าสุด'
              : 'ยังไม่เคยซิงค์บัญชีจาก KBIZ'}
        </div>
        <div style={{ minWidth: 140 }}>
          <PrimaryButton theme={theme} full={false} disabled={!configured || syncingFavorites} onClick={onSyncFavorites}>
            {syncingFavorites ? 'กำลังซิงค์…' : 'ซิงค์จาก KBIZ'}
          </PrimaryButton>
        </div>
      </div>
      <Card theme={theme} padding={0}>
        {!favorites || favorites.length === 0 ? (
          <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter, lineHeight: 1.5 }}>
            {favorites === null
              ? 'ยังไม่มีบัญชีที่ซิงค์จาก KBIZ — กด "ซิงค์จาก KBIZ" ด้านบนเพื่อดึงรายชื่อบัญชีที่บันทึกไว้'
              : 'ซิงค์แล้ว แต่ไม่มีบัญชีที่บันทึกไว้ใน KBIZ'}
          </div>
        ) : (
          <>
            <div
              style={{
                padding: '10px 18px',
                display: 'grid',
                gridTemplateColumns: FAVORITES_GRID_COLUMNS,
                gap: 14,
                fontFamily: FONT_UI,
                fontSize: 11,
                color: theme.inkSoft,
                letterSpacing: 0.6,
                textTransform: 'uppercase',
                borderBottom: `0.5px solid ${theme.hairline}`,
                fontWeight: 500,
              }}
            >
              <span>ชื่อบัญชี</span>
              <span>ธนาคาร</span>
              <span>เลขบัญชี</span>
              <span>ชื่อที่บันทึกใน KBIZ</span>
            </div>
            {favorites.map((f, i) => (
              <div
                key={`${f.nickname}-${f.accountLast4}-${i}`}
                style={{
                  padding: '12px 18px',
                  display: 'grid',
                  gridTemplateColumns: FAVORITES_GRID_COLUMNS,
                  gap: 14,
                  alignItems: 'center',
                  borderBottom: i < favorites.length - 1 ? `0.5px solid ${theme.hairline}` : 'none',
                  fontFamily: FONT_UI,
                  fontSize: 13,
                  color: theme.ink,
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.accountName}</span>
                <span style={{ color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.bank}</span>
                <span style={{ fontFamily: FONT_MONO, fontSize: 12 }}>{f.accountMasked}</span>
                <span style={{ color: theme.inkSoft, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nickname}</span>
              </div>
            ))}
          </>
        )}
      </Card>
    </div>
  );
}

const FAVORITES_GRID_COLUMNS = '1.3fr 1fr 0.9fr 1fr';

function catBtnStyle(theme: Theme): CSSProperties {
  return {
    width: 30,
    height: 30,
    borderRadius: 8,
    background: 'transparent',
    border: `0.5px solid ${theme.hairlineStrong}`,
    color: theme.inkSoft,
    fontFamily: FONT_UI,
    fontSize: 13,
    cursor: 'pointer',
    lineHeight: 1,
  };
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
  /** Bot-published handle options; null = not published, fall back to typing. */
  availableHandles: string[] | null;
  /** Details behind each handle (nickname/bank/masked account), when published. */
  availablePayees: PublishedPayee[] | null;
  onChange: (v: string) => void;
  isLast: boolean;
}

/** "นางสาว สลิลทิพย์ เพชรรักษ์ · Siam Commercial …7394" — the account name
 *  leads, since that's what actually identifies who a handle pays; the handle
 *  itself is a plain <option>'s text, so it's omitted here rather than tacked
 *  on as an unstyleable technical suffix (see the detail line below, which can
 *  style it small). */
function payeeOptionLabel(handle: string, payees: PublishedPayee[] | null): string {
  const p = payees?.find((x) => x.handle === handle);
  if (!p) return handle;
  return formatKbizAccountLabel(p, handle);
}

function PayeeRow({ theme, user, value, availableHandles, availablePayees, onChange, isLast }: PayeeRowProps): JSX.Element {
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
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft }}>
          {roleLabel}
          {value !== '' && availablePayees && (
            <span style={{ marginLeft: 8, color: theme.inkSofter }}>
              →{' '}
              {(() => {
                const p = availablePayees.find((x) => x.handle === value);
                return p ? formatKbizAccountLabel(p, value) : 'ไม่พบรายละเอียดจากบอท';
              })()}
              {/* Handle as a small technical suffix — useful for cross-checking
                  against the bot's book, never the primary label. */}
              <span style={{ fontFamily: FONT_MONO, opacity: 0.7, marginLeft: 6 }}>#{value}</span>
            </span>
          )}
        </div>
      </div>
      {availableHandles !== null ? (
        <select
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={{
            width: 180,
            padding: '9px 12px',
            borderRadius: 10,
            background: theme.surface,
            border: `0.5px solid ${theme.hairlineStrong}`,
            fontFamily: FONT_MONO,
            fontSize: 13,
            color: value === '' ? theme.inkSoft : theme.ink,
            outline: 'none',
            boxSizing: 'border-box',
            appearance: 'none' as const,
            cursor: 'pointer',
          }}
        >
          <option value="">— ไม่โอนผ่าน KBIZ —</option>
          {availableHandles.map((h) => (
            <option key={h} value={h}>
              {payeeOptionLabel(h, availablePayees)}
            </option>
          ))}
          {/* A saved handle the bot no longer knows stays visible + flagged,
              instead of silently vanishing from the row. */}
          {value !== '' && !availableHandles.includes(value) && (
            <option value={value}>{value} (ไม่พบในบอท)</option>
          )}
        </select>
      ) : (
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
      )}
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
