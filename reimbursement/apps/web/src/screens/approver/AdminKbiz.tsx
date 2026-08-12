import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { ApiError, api } from '../../lib/api';
import type { KbizSettings, PublishedPayee } from '../../lib/api';
import { formatThaiRelative } from '../../lib/format';
import { payeeDetailLine, payeeOptionLabel } from '../../lib/kbizFormat';
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
import { Avatar, Card, GhostButton, PrimaryButton } from '../../components/primitives';
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

/** How long a just-added category stays tinted before it fades back. */
const HIGHLIGHT_MS = 1200;

/** Past this many employees the payee list gets its own filter box — below it,
 *  a search field costs more attention than scanning the rows does. */
const PAYEE_FILTER_THRESHOLD = 8;

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

/** Honours the OS "reduce motion" setting — the two animations on this screen
 *  (the add-a-category tint, the loading pulse) are decoration, so they are
 *  simply not run rather than being swapped for something else. */
function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const mq = window.matchMedia(query);
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
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
  const reducedMotion = useReducedMotion();

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

  // View-only state: which row was just added (brief tint), the employee
  // filter, and whether the KBIZ reference table is unfolded. None of it is
  // persisted — reopening the screen starts collapsed and unfiltered.
  const [highlightCategory, setHighlightCategory] = useState<string | null>(null);
  const [payeeFilter, setPayeeFilter] = useState('');
  const [favoritesOpen, setFavoritesOpen] = useState(false);

  // Guards state updates from the sync-poll loop (setTimeout chain) once the
  // screen has gone away — the loop has no other way to know to stop.
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const highlightTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    [],
  );

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

  // What the save bar names as changed. The category list and its KBIZ mapping
  // are one zone on screen now, so they report as one thing.
  const dirtyAreas: string[] = [];
  if (categoriesDirty || mappingDirty) dirtyAreas.push('หมวดหมู่');
  if (payeesDirty) dirtyAreas.push('ผู้รับเงิน');

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

  /** "ยกเลิก" — every draft back to what the server last confirmed. */
  const handleReset = (): void => {
    if (saving) return;
    setCategoriesDraft(savedCategories);
    setCategoryDraft(savedMapping !== null ? savedMapping.categories : {});
    setDefaultCategoryDraft(savedMapping !== null ? savedMapping.defaultCategoryId : '12');
    setPayeeDraft(savedPayees);
    setHighlightCategory(null);
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
    // The new row renders with the default KBIZ category already selected (no
    // explicit entry is written, so it keeps following the default until the
    // admin picks something), and is tinted just long enough to be found.
    setHighlightCategory(c);
    if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      highlightTimer.current = null;
      if (mountedRef.current) setHighlightCategory(null);
    }, HIGHLIGHT_MS);
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
      compact={isMobile}
      reducedMotion={reducedMotion}
      configured={configured}
      loading={loading}
      loadError={loadError}
      receiptCategories={categoriesDraft}
      highlightCategory={highlightCategory}
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
      payeeFilter={payeeFilter}
      onPayeeFilterChange={setPayeeFilter}
      payeeDraft={payeeDraft}
      availableHandles={availableHandles}
      availablePayees={availablePayees}
      onPayeeChange={(userId, handle) => setPayeeDraft((prev) => ({ ...prev, [userId]: handle }))}
      favorites={favorites}
      favoritesUpdatedAt={favoritesUpdatedAt}
      favoritesOpen={favoritesOpen}
      onToggleFavorites={() => setFavoritesOpen((v) => !v)}
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
          <div style={{ padding: '8px 16px 40px' }}>{body}</div>
        </div>

        {/* Pinned above the bottom safe area (and above the app's bottom nav),
            and only there at all once something has actually changed. */}
        {dirty && (
          <div
            style={{
              padding: '10px 16px calc(10px + env(safe-area-inset-bottom))',
              background: theme.paper,
              borderTop: `0.5px solid ${theme.hairline}`,
            }}
          >
            <SaveBar
              theme={theme}
              compact
              areas={dirtyAreas}
              saving={saving}
              onSave={() => void handleSave()}
              onReset={handleReset}
            />
          </div>
        )}
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
          <div style={{ padding: '32px 40px 20px', maxWidth: 860 }}>
            <TopBar theme={theme} />
            {body}
            {/* Sticks to the bottom of the content column while there is
                anything to save, then leaves entirely. */}
            {dirty && (
              <div style={{ position: 'sticky', bottom: 12, marginTop: 22, zIndex: 5 }}>
                <SaveBar
                  theme={theme}
                  compact={false}
                  areas={dirtyAreas}
                  saving={saving}
                  onSave={() => void handleSave()}
                  onReset={handleReset}
                />
              </div>
            )}
          </div>
        </div>
      </div>
    </DesktopShell>
  );
}

// ── Top bar (desktop) ───────────────────────────────────────────────

function TopBar({ theme }: { theme: Theme }): JSX.Element {
  return (
    <div style={{ marginBottom: 4 }}>
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
        หมวดหมู่ใบเสร็จ · การโอนอัตโนมัติผ่าน KBIZ
      </div>
    </div>
  );
}

// ── Save bar ────────────────────────────────────────────────────────

interface SaveBarProps {
  theme: Theme;
  /** Names of the zones holding unsaved edits, in screen order. */
  areas: string[];
  saving: boolean;
  compact: boolean;
  onSave: () => void;
  onReset: () => void;
}

function SaveBar({ theme, areas, saving, compact, onSave, onReset }: SaveBarProps): JSX.Element {
  const note = (
    <div style={{ fontFamily: FONT_UI, fontSize: 12.5, color: theme.inkSoft, minWidth: 0, lineHeight: 1.4 }}>
      มีการเปลี่ยนแปลง:{' '}
      <span style={{ color: theme.ink, fontWeight: 600 }}>{areas.join(' · ')}</span>
    </div>
  );

  if (compact) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {note}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ flex: 1 }}>
            <GhostButton theme={theme} full disabled={saving} onClick={() => !saving && onReset()}>
              ยกเลิก
            </GhostButton>
          </div>
          <div style={{ flex: 1.6 }}>
            <PrimaryButton theme={theme} full disabled={saving} onClick={onSave}>
              {saving ? 'กำลังบันทึก...' : 'บันทึก'}
            </PrimaryButton>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 18,
        padding: '12px 16px',
        borderRadius: 16,
        background: theme.surface,
        border: `0.5px solid ${theme.hairlineStrong}`,
        boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
      }}
    >
      {note}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
        <GhostButton theme={theme} disabled={saving} onClick={() => !saving && onReset()}>
          ยกเลิก
        </GhostButton>
        <PrimaryButton theme={theme} full={false} disabled={saving} onClick={onSave}>
          {saving ? 'กำลังบันทึก...' : 'บันทึก'}
        </PrimaryButton>
      </div>
    </div>
  );
}

// ── Shared body (both mobile and desktop) ────────────────────────────

interface SettingsBodyProps {
  theme: Theme;
  compact: boolean;
  reducedMotion: boolean;
  configured: boolean;
  loading: boolean;
  loadError: string | null;
  receiptCategories: string[];
  /** The row added a moment ago — tinted so it can be found in a long list. */
  highlightCategory: string | null;
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
  payeeFilter: string;
  onPayeeFilterChange: (v: string) => void;
  payeeDraft: Record<string, string>;
  availableHandles: string[] | null;
  availablePayees: PublishedPayee[] | null;
  onPayeeChange: (userId: string, handle: string) => void;
  favorites: KbizFavorite[] | null;
  favoritesUpdatedAt: string | null;
  favoritesOpen: boolean;
  onToggleFavorites: () => void;
  syncingFavorites: boolean;
  onSyncFavorites: () => void;
}

function SettingsBody({
  theme,
  compact,
  reducedMotion,
  configured,
  loading,
  loadError,
  receiptCategories,
  highlightCategory,
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
  payeeFilter,
  onPayeeFilterChange,
  payeeDraft,
  availableHandles,
  availablePayees,
  onPayeeChange,
  favorites,
  favoritesUpdatedAt,
  favoritesOpen,
  onToggleFavorites,
  syncingFavorites,
  onSyncFavorites,
}: SettingsBodyProps): JSX.Element {
  if (loading) {
    return <SkeletonBody theme={theme} animate={!reducedMotion} />;
  }

  if (loadError) {
    return (
      <div style={{ padding: '40px 0', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>
        {loadError}
      </div>
    );
  }

  const showFilter = users.length > PAYEE_FILTER_THRESHOLD;
  const filter = payeeFilter.trim().toLowerCase();
  const visibleUsers =
    showFilter && filter !== '' ? users.filter((u) => u.name.toLowerCase().includes(filter)) : users;

  // "3 วันที่แล้ว" for a week-old book, an absolute date past that — the payee
  // dropdown is populated from this book, so how stale it is has to be legible.
  const syncNote = favoritesUpdatedAt
    ? `ซิงค์ล่าสุด ${formatThaiRelative(favoritesUpdatedAt)}`
    : favorites !== null
      ? 'ซิงค์แล้ว · ไม่ทราบเวลาซิงค์ล่าสุด'
      : 'ยังไม่เคยซิงค์';

  return (
    <div>
      {!configured && (
        <div
          style={{
            marginTop: compact ? 10 : 18,
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

      {/* ── หมวดหมู่ใบเสร็จ ─────────────────────────────────────────── */}

      <ZoneHeader
        theme={theme}
        first
        title="หมวดหมู่ใบเสร็จ"
        caption="ลำดับนี้คือลำดับในแบบฟอร์มบันทึกใบเสร็จ · ใบเสร็จเดิมยังใช้ชื่อหมวดหมู่เดิม — การลบ/เปลี่ยนชื่อมีผลเฉพาะใบเสร็จใหม่"
      />
      <Card theme={theme} padding={0} style={{ overflow: 'hidden' }}>
        {receiptCategories.map((cat, i) => (
          <CategoryRow
            key={cat}
            theme={theme}
            compact={compact}
            category={cat}
            index={i}
            total={receiptCategories.length}
            value={categoryDraft[cat] ?? defaultCategoryDraft}
            // No explicit entry — the row shows the default's value and moves
            // with it, so it says so rather than looking deliberately mapped.
            usesDefault={categoryDraft[cat] === undefined}
            highlighted={cat === highlightCategory}
            animate={!reducedMotion}
            onMove={(dir) => onMoveCategory(cat, dir)}
            onRemove={() => onRemoveCategory(cat)}
            onChange={(id) => onCategoryChange(cat, id)}
          />
        ))}

        <div style={{ padding: '10px 14px', display: 'flex', gap: 10 }}>
          <input
            value={newCategory}
            onChange={(e) => onNewCategoryChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onAddCategory();
            }}
            placeholder="เพิ่มหมวดหมู่ใหม่…"
            maxLength={60}
            aria-label="ชื่อหมวดหมู่ใหม่"
            style={{
              flex: 1,
              minWidth: 0,
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
              border: newCategory.trim() === '' ? `0.5px solid ${theme.hairlineStrong}` : 'none',
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 500,
              cursor: newCategory.trim() === '' ? 'default' : 'pointer',
              flexShrink: 0,
            }}
          >
            เพิ่ม
          </button>
        </div>

        {/* Footer: the one mapping that isn't a row — where everything with no
            row of its own lands. */}
        <div
          style={{
            padding: '10px 14px',
            borderTop: `0.5px solid ${theme.hairline}`,
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            justifyContent: 'space-between',
          }}
        >
          {/* Names the runtime trigger, not the rows on this screen: this is
              where a receipt whose category isn't in the mapping lands — and
              also where every row still marked "(ค่าเริ่มต้น)" follows. */}
          <span style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, minWidth: 0, lineHeight: 1.4 }}>
            หมวดหมู่เริ่มต้น (เมื่อไม่พบหมวดที่ตรง) →
          </span>
          <select
            value={defaultCategoryDraft}
            onChange={(e) => onDefaultCategoryChange(e.target.value as KbizCategoryId)}
            aria-label="หมวดหมู่ KBIZ เริ่มต้น สำหรับหมวดที่ไม่ได้จับคู่"
            style={{ ...selectStyle(theme), minWidth: compact ? 0 : 190, flex: compact ? 1 : '0 0 auto' }}
          >
            {KBIZ_CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>
                {c.th}
              </option>
            ))}
          </select>
        </div>
      </Card>

      {/* ── ผู้รับเงิน ──────────────────────────────────────────────── */}

      <ZoneHeader
        theme={theme}
        title="ผู้รับเงิน"
        caption={
          availableHandles !== null
            ? 'เลือกบัญชีผู้รับจากสมุดบัญชีของบอท — เลือก "—" หากพนักงานคนนั้นยังโอนผ่าน KBIZ ไม่ได้'
            : 'ระบุชื่อย่อบัญชีผู้รับที่บันทึกไว้ใน KBIZ (ยังไม่ได้รับรายชื่อจากบอท — ตรวจสอบว่า kbiz-bot ทำงานอยู่)'
        }
        right={
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              flexWrap: 'wrap',
              justifyContent: 'flex-end',
              // Keeps the meta hard right even on the phone, where it wraps
              // onto its own line and `space-between` alone would drop it left.
              marginLeft: 'auto',
            }}
          >
            <span style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>{syncNote}</span>
            <button
              onClick={onSyncFavorites}
              disabled={!configured || syncingFavorites}
              style={{
                padding: '7px 12px',
                borderRadius: 10,
                background: 'transparent',
                border: `1px solid ${theme.hairlineStrong}`,
                color: !configured || syncingFavorites ? theme.inkSofter : theme.ink,
                fontFamily: FONT_UI,
                fontSize: 12.5,
                fontWeight: 500,
                cursor: !configured || syncingFavorites ? 'default' : 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {syncingFavorites ? 'กำลังซิงค์…' : 'ซิงค์จาก KBIZ'}
            </button>
          </div>
        }
      />

      {showFilter && (
        <input
          value={payeeFilter}
          onChange={(e) => onPayeeFilterChange(e.target.value)}
          placeholder="ค้นหาพนักงาน…"
          aria-label="ค้นหาพนักงาน"
          style={{
            width: '100%',
            marginBottom: 8,
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
      )}

      <Card theme={theme} padding={0}>
        {users.length === 0 ? (
          <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
            ยังไม่มีพนักงาน
          </div>
        ) : visibleUsers.length === 0 ? (
          <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
            ไม่พบพนักงานที่ค้นหา
          </div>
        ) : (
          visibleUsers.map((u, i) => (
            <PayeeRow
              key={u.id}
              theme={theme}
              compact={compact}
              user={u}
              value={payeeDraft[u.id] ?? ''}
              availableHandles={availableHandles}
              availablePayees={availablePayees}
              onChange={(v) => onPayeeChange(u.id, v)}
              isLast={i === visibleUsers.length - 1}
            />
          ))
        )}
      </Card>

      {/* Reference only — what KBIZ itself has saved. Folded away by default:
          nothing here is editable, it exists to check a mapping against. */}
      <div style={{ marginTop: 10 }}>
        <Card theme={theme} padding={0} style={{ overflow: 'hidden' }}>
          <button
            onClick={onToggleFavorites}
            aria-expanded={favoritesOpen}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 10,
              padding: '11px 16px',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT_UI,
              fontSize: 12.5,
              fontWeight: 500,
              color: theme.inkSoft,
              textAlign: 'left',
            }}
          >
            <span>
              บัญชีที่บันทึกไว้ใน KBIZ
              {favorites !== null && <span style={{ color: theme.inkSofter }}> ({favorites.length})</span>}
            </span>
            <span aria-hidden style={{ fontSize: 11, color: theme.inkSofter }}>{favoritesOpen ? '▾' : '▸'}</span>
          </button>

          {favoritesOpen && (
            <div style={{ borderTop: `0.5px solid ${theme.hairline}` }}>
              {favorites === null ? (
                <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter, lineHeight: 1.5 }}>
                  ยังไม่เคยซิงค์จาก KBIZ — กดซิงค์เพื่อดึงรายชื่อ
                </div>
              ) : favorites.length === 0 ? (
                <div style={{ padding: '18px', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter, lineHeight: 1.5 }}>
                  ไม่มีบัญชีที่บันทึกไว้ใน KBIZ
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <div style={{ minWidth: compact ? 520 : 0 }}>
                    <div
                      style={{
                        padding: '10px 16px',
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
                          padding: '12px 16px',
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
                  </div>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

const FAVORITES_GRID_COLUMNS = '1.3fr 1fr 0.9fr 1fr';

// ── Shared bits ─────────────────────────────────────────────────────

function selectStyle(theme: Theme): CSSProperties {
  return {
    padding: '8px 10px',
    borderRadius: 10,
    background: theme.surface,
    border: `0.5px solid ${theme.hairlineStrong}`,
    fontFamily: FONT_UI,
    fontSize: 13,
    color: theme.ink,
    outline: 'none',
    boxSizing: 'border-box',
    cursor: 'pointer',
    maxWidth: '100%',
  };
}

function rowBtnStyle(theme: Theme): CSSProperties {
  return {
    width: 26,
    height: 26,
    flexShrink: 0,
    borderRadius: 8,
    background: 'transparent',
    border: `0.5px solid ${theme.hairlineStrong}`,
    color: theme.inkSoft,
    fontFamily: FONT_UI,
    fontSize: 12,
    lineHeight: 1,
    padding: 0,
  };
}

interface ZoneHeaderProps {
  theme: Theme;
  title: string;
  caption?: string;
  right?: ReactNode;
  /** The first zone sits right under the page title, so it needs less air. */
  first?: boolean;
}

function ZoneHeader({ theme, title, caption, right, first }: ZoneHeaderProps): JSX.Element {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-end',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
        margin: first ? '18px 0 10px' : '26px 0 10px',
      }}
    >
      <div style={{ minWidth: 0, flex: '1 1 220px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 17, fontWeight: 600, color: theme.ink, letterSpacing: -0.2 }}>
          {title}
        </div>
        {caption && (
          <div style={{ marginTop: 3, fontFamily: FONT_UI, fontSize: 12, color: theme.inkSofter, lineHeight: 1.5 }}>
            {caption}
          </div>
        )}
      </div>
      {right}
    </div>
  );
}

// ── Category row (name + KBIZ mapping + order + delete, one row) ─────

interface CategoryRowProps {
  theme: Theme;
  compact: boolean;
  category: string;
  index: number;
  total: number;
  value: KbizCategoryId;
  /** True when this category has no mapping entry of its own and is simply
   *  following the default control in the card footer. */
  usesDefault: boolean;
  highlighted: boolean;
  animate: boolean;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  onChange: (id: KbizCategoryId) => void;
}

function CategoryRow({
  theme,
  compact,
  category,
  index,
  total,
  value,
  usesDefault,
  highlighted,
  animate,
  onMove,
  onRemove,
  onChange,
}: CategoryRowProps): JSX.Element {
  const isFirst = index === 0;
  const isLast = index === total - 1;
  const canRemove = total > 1;

  return (
    <div
      style={{
        padding: '8px 12px 8px 10px',
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        flexWrap: compact ? 'wrap' : 'nowrap',
        borderBottom: `0.5px solid ${theme.hairline}`,
        // A just-added row is tinted, then fades back as the highlight clears.
        background: highlighted ? `${theme.accent}1F` : 'transparent',
        transition: animate ? 'background-color 700ms ease' : undefined,
      }}
    >
      <div style={{ display: 'flex', gap: 2, order: 0, flexShrink: 0 }}>
        <button
          onClick={() => onMove(-1)}
          disabled={isFirst}
          title="เลื่อนขึ้น"
          aria-label={`เลื่อน ${category} ขึ้น`}
          style={{ ...rowBtnStyle(theme), opacity: isFirst ? 0.25 : 1, cursor: isFirst ? 'default' : 'pointer' }}
        >
          ↑
        </button>
        <button
          onClick={() => onMove(1)}
          disabled={isLast}
          title="เลื่อนลง"
          aria-label={`เลื่อน ${category} ลง`}
          style={{ ...rowBtnStyle(theme), opacity: isLast ? 0.25 : 1, cursor: isLast ? 'default' : 'pointer' }}
        >
          ↓
        </button>
      </div>

      {/* This is the only place the category name is rendered now, so it must
          stay readable in full: it wraps on the phone (line 1 is just ↑↓ name ✕)
          and carries a title for the desktop row, which still clips. */}
      <span
        title={category}
        style={{
          order: 1,
          flex: '1 1 110px',
          minWidth: 0,
          fontFamily: FONT_UI,
          fontSize: 13,
          fontWeight: 500,
          color: theme.ink,
          lineHeight: 1.35,
          ...(compact
            ? { whiteSpace: 'normal' as const, overflowWrap: 'break-word' as const }
            : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }),
        }}
      >
        {category}
      </span>

      {/* On a phone the mapping drops to its own line under the name (order 3,
          full basis) so the name never has to compete with a select. */}
      <div
        style={{
          order: compact ? 3 : 2,
          flexBasis: compact ? '100%' : 'auto',
          marginLeft: compact ? 62 : 0,
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          minWidth: 0,
        }}
      >
        <span aria-hidden style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter, flexShrink: 0 }}>
          →
        </span>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as KbizCategoryId)}
          aria-label={`หมวดหมู่ KBIZ สำหรับ ${category}`}
          style={{ ...selectStyle(theme), flex: compact ? 1 : '0 0 auto', minWidth: compact ? 0 : 190 }}
        >
          {KBIZ_CATEGORIES.map((c) => (
            <option key={c.id} value={c.id}>
              {c.th}
            </option>
          ))}
        </select>
        {usesDefault && (
          <span
            title="ยังไม่ได้จับคู่ไว้เอง — ตามหมวดหมู่เริ่มต้นท้ายการ์ด"
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSofter,
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            (ค่าเริ่มต้น)
          </span>
        )}
      </div>

      <button
        onClick={onRemove}
        disabled={!canRemove}
        title="ลบหมวดหมู่"
        aria-label={`ลบหมวดหมู่ ${category}`}
        style={{
          ...rowBtnStyle(theme),
          order: compact ? 2 : 3,
          color: theme.danger,
          opacity: canRemove ? 1 : 0.25,
          cursor: canRemove ? 'pointer' : 'default',
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ── Payee row ───────────────────────────────────────────────────────

interface PayeeRowProps {
  theme: Theme;
  compact: boolean;
  user: AdminUser;
  value: string;
  /** Bot-published handle options; null = not published, fall back to typing. */
  availableHandles: string[] | null;
  /** Details behind each handle (nickname/bank/masked account), when published. */
  availablePayees: PublishedPayee[] | null;
  onChange: (v: string) => void;
  isLast: boolean;
}

function PayeeRow({
  theme,
  compact,
  user,
  value,
  availableHandles,
  availablePayees,
  onChange,
  isLast,
}: PayeeRowProps): JSX.Element {
  const roleLabel = user.role === 'approver' ? 'ผู้อนุมัติ' : 'พนักงาน';
  const detail = payeeDetailLine(value, availablePayees);
  const mapped = value !== '' && availablePayees !== null;
  // Desktop keeps the caption on one clipped line, so the same text is offered
  // on hover — the phone gets the real thing by wrapping it below.
  const captionTitle = mapped
    ? `${roleLabel} → ${detail ?? 'ไม่พบรายละเอียดจากบอท'} #${value}`
    : roleLabel;

  return (
    <div
      style={{
        padding: '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        // On a phone the account control drops to its own full-width line —
        // the same move CategoryRow makes with its select. Sharing one line
        // left the caption ~120px, too narrow to show which account is being
        // authorised, and clipped the select's own selected label as well.
        flexWrap: compact ? 'wrap' : 'nowrap',
        borderBottom: isLast ? 'none' : `0.5px solid ${theme.hairline}`,
      }}
    >
      <Avatar theme={theme} initials={user.initials} size={32} />
      {/* Basis 0, not auto: the caption's max-content run is long, and Avatar
          sets no flex-shrink of its own — an auto basis would squeeze it. */}
      <div style={{ order: 1, flex: '1 1 0', minWidth: 0 }}>
        <div
          title={user.name}
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
        {/* The only on-screen proof of which bank account this employee is
            mapped to — it must never be clipped to nothing. */}
        <div
          title={captionTitle}
          style={{
            fontFamily: FONT_UI,
            fontSize: 11,
            color: theme.inkSoft,
            lineHeight: 1.45,
            ...(compact
              ? { whiteSpace: 'normal' as const, overflowWrap: 'break-word' as const }
              : { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }),
          }}
        >
          {roleLabel}
          {mapped && (
            <span style={{ marginLeft: 8, color: theme.inkSofter }}>
              → {detail ?? 'ไม่พบรายละเอียดจากบอท'}
              {/* Handle as a small technical suffix — useful for cross-checking
                  against the bot's book, never the primary label. */}
              <span style={{ fontFamily: FONT_MONO, opacity: 0.7, marginLeft: 6 }}>#{value}</span>
            </span>
          )}
        </div>
      </div>
      <div
        style={{
          order: 2,
          // 100% basis + the avatar-width indent shrinks back to the row on
          // the phone; on desktop it stays the fixed-width control it was.
          flexBasis: compact ? '100%' : 'auto',
          flexGrow: 0,
          flexShrink: compact ? 1 : 0,
          marginLeft: compact ? 44 : 0,
          minWidth: 0,
        }}
      >
        {availableHandles !== null ? (
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={`บัญชีผู้รับเงินของ ${user.name}`}
            style={{
              ...selectStyle(theme),
              width: compact ? '100%' : 180,
              padding: '9px 12px',
              fontFamily: FONT_MONO,
              color: value === '' ? theme.inkSoft : theme.ink,
              appearance: 'none' as const,
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
            aria-label={`ชื่อย่อบัญชีผู้รับเงินของ ${user.name}`}
            style={{
              width: compact ? '100%' : 160,
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
    </div>
  );
}

// ── Loading skeleton ────────────────────────────────────────────────

function SkeletonBody({ theme, animate }: { theme: Theme; animate: boolean }): JSX.Element {
  return (
    <div>
      {animate && (
        <style>{`@keyframes kbiz-skeleton-pulse { 0%, 100% { opacity: 1 } 50% { opacity: 0.45 } }`}</style>
      )}
      <ZoneHeader theme={theme} first title="หมวดหมู่ใบเสร็จ" />
      <SkeletonRows theme={theme} animate={animate} />
      <ZoneHeader theme={theme} title="ผู้รับเงิน" />
      <SkeletonRows theme={theme} animate={animate} avatar />
    </div>
  );
}

function SkeletonRows({
  theme,
  animate,
  avatar,
}: {
  theme: Theme;
  animate: boolean;
  avatar?: boolean;
}): JSX.Element {
  const block = (width: number | string, height: number, delay: number): CSSProperties => ({
    width,
    height,
    borderRadius: height / 2,
    background: theme.surface2,
    animation: animate ? `kbiz-skeleton-pulse 1.4s ease-in-out ${delay}s infinite` : undefined,
  });

  return (
    <Card theme={theme} padding={0}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          style={{
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            borderBottom: i < 2 ? `0.5px solid ${theme.hairline}` : 'none',
          }}
        >
          {avatar && <div style={{ ...block(32, 32, i * 0.12), borderRadius: 16 }} />}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ ...block(i === 1 ? 160 : 130, 12, i * 0.12), marginBottom: 6 }} />
            <div style={block(90, 10, i * 0.12)} />
          </div>
          <div style={{ ...block(150, 30, i * 0.12), borderRadius: 10 }} />
        </div>
      ))}
    </Card>
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
