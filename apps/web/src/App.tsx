import { useCallback, useEffect, useRef, useState } from 'react';
import type { AppState, Tweaks, User } from './lib/types';
import type { Route } from './lib/router';
import { getTheme } from './lib/theme';
import { useViewportPlatform } from './lib/useViewportPlatform';
import {
  ApiError,
  DEV_USER_ID_BY_ROLE,
  api,
  getAuthToken,
  getDevUserId,
  setAuthToken,
  setDevUserId,
} from './lib/api';
import { IOSDevice } from './components/IOSDevice';
import { Icon } from './components/icons';
import { TweaksPanel } from './components/TweaksPanel';
import { Home } from './screens/employee/Home';
import { Upload } from './screens/employee/Upload';
import { RecordDetail } from './screens/employee/RecordDetail';
import { BundleBuilder } from './screens/employee/BundleBuilder';
import { BundleSubmitted } from './screens/employee/BundleSubmitted';
import { BundleDetail } from './screens/employee/BundleDetail';
import { Inbox } from './screens/approver/Inbox';
import { Review } from './screens/approver/Review';
import { Pay } from './screens/approver/Pay';
import { DesktopApprover } from './screens/approver/Desktop';
import { DesktopEmployee } from './screens/employee/Desktop';
import { Login } from './screens/auth/Login';
import { ManageEmployees } from './screens/approver/ManageEmployees';
import { LedgerDashboard } from './screens/admin/LedgerDashboard';
import { ExpenseWizard } from './screens/admin/ExpenseWizard';
import { PlReportScreen } from './screens/admin/PlReportScreen';
import { BottomNav } from './components/BottomNav';
import type { BottomNavRoute } from './components/BottomNav';

const TWEAK_DEFAULTS: Tweaks = {
  role: 'employee',
  platform: 'mobile',
  accent: '#262626',
  dark: false,
};

const EMPTY_STATE: AppState = { receipts: [], bundles: [] };
const IS_DEV = import.meta.env.DEV;

function initialRouteFromUrl(): Route {
  if (typeof window === 'undefined') return { name: 'home' };
  const path = window.location.pathname;
  if (path === '/login') return { name: 'login' };
  if (path === '/admin/employees') return { name: 'admin-employees' };
  if (path === '/my-requests') return { name: 'my-requests' };
  if (path === '/ledger/entry') return { name: 'ledger-entry' };
  if (path === '/ledger/report') return { name: 'ledger-report' };
  if (path === '/ledger') return { name: 'ledger' };
  return { name: 'home' };
}

function isPublicAuthRoute(route: Route): boolean {
  return route.name === 'login';
}

/** Maps a failed silent `api.auth.cfLogin()` exchange to the Thai message
 *  shown on the login screen. Login's own retry button uses the same mapping. */
function cfLoginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.status === 403) return error.message;
    if (error.status === 503) return 'ระบบเข้าสู่ระบบยังไม่พร้อมใช้งาน — ติดต่อผู้ดูแลระบบ';
  }
  return 'เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่อีกครั้ง';
}

export function App() {
  const [tweaks, setTweaks] = useState<Tweaks>(TWEAK_DEFAULTS);
  const theme = getTheme(tweaks.dark, tweaks.accent);

  // Production picks the layout from the viewport; the dev tweaks panel can
  // still force a platform for previewing.
  const viewportPlatform = useViewportPlatform();
  const platform = IS_DEV ? tweaks.platform : viewportPlatform;

  const [route, setRoute] = useState<Route>(initialRouteFromUrl);
  const nav = (r: Route) => setRoute(r);

  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const currentUserRef = useRef<User | null>(null);
  const [state, setState] = useState<AppState>(EMPTY_STATE);
  const [myState, setMyState] = useState<AppState>(EMPTY_STATE); // approver's own requests
  const [loading, setLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cfError, setCfError] = useState<string | null>(null);

  // ── Bootstrap auth + initial data load ──────────────────────────
  const refetch = useCallback(async (): Promise<void> => {
    setErrorMessage(null);
    try {
      const [receipts, bundles] = await Promise.all([
        api.receipts.list(),
        api.bundles.list(),
      ]);
      setState({ receipts, bundles });
      if (currentUserRef.current?.role === 'approver') {
        const [myReceipts, myBundles] = await Promise.all([
          api.receipts.list({ mine: true }),
          api.bundles.list(undefined, { mine: true }),
        ]);
        setMyState({ receipts: myReceipts, bundles: myBundles });
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
    }
  }, []);

  useEffect(() => {
    if (isPublicAuthRoute(route)) {
      setLoading(false);
      return;
    }

    // Bootstrap once per identity: skip when the user is already resolved so
    // in-app navigation doesn't re-run auth + refetch (which blanked the app
    // with a spinner and could drop just-mutated data mid-flow).
    if (currentUserRef.current !== null) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        // (1) Stored token (from a prior CF-login or card-login) → resolve
        // identity via /api/me. The JWT itself is opaque to the client.
        if (getAuthToken() !== null) {
          try {
            const me = await api.me();
            if (cancelled) return;
            currentUserRef.current = me;
            setCurrentUser(me);
            await refetch();
            return;
          } catch (error) {
            if (cancelled) return;
            if (!(error instanceof ApiError && (error.status === 401 || error.status === 403))) {
              throw error;
            }
            // Stale/invalid token — clear it and fall through to dev
            // impersonation (dev) or the silent CF Access exchange (prod).
            setAuthToken(null);
          }
        }

        // (2) Dev impersonation path: skip real auth, hit /api/me directly.
        if (IS_DEV) {
          if (getDevUserId() === null) {
            setDevUserId(DEV_USER_ID_BY_ROLE[tweaks.role]);
          }
          const me = await api.me();
          if (cancelled) return;
          currentUserRef.current = me;
          setCurrentUser(me);
          await refetch();
          return;
        }

        // (3) Production, no valid token → silent Cloudflare Access exchange.
        // The edge already injected Cf-Access-Jwt-Assertion on this request;
        // the server reads it and mints an app JWT with no user interaction.
        try {
          const response = await api.auth.cfLogin();
          if (cancelled) return;
          setAuthToken(response.token);
          currentUserRef.current = response.user;
          setCurrentUser(response.user);
          await refetch();
        } catch (error) {
          if (cancelled) return;
          setCfError(cfLoginErrorMessage(error));
          setRoute({ name: 'login' });
        }
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
          setAuthToken(null);
          setRoute({ name: 'login' });
          return;
        }
        setErrorMessage(error instanceof Error ? error.message : 'Unknown error');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [route, refetch, tweaks.role]);

  // ── Silent refresh on top-level screens ──────────────────────────
  // Bootstrap runs once, so returning to a list screen re-syncs server truth
  // in the background (no spinner, no unmount) to pick up status changes.
  useEffect(() => {
    const REFRESH_ROUTES: ReadonlySet<Route['name']> = new Set(['home', 'approver-home', 'my-requests']);
    if (!REFRESH_ROUTES.has(route.name)) return;
    if (currentUserRef.current === null) return;
    void refetch();
  }, [route, refetch]);

  // ── URL sync — keep the address bar in step with the route name ─
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const path = pathForRoute(route);
    if (window.location.pathname !== path) {
      window.history.replaceState(null, '', path + window.location.search + window.location.hash);
    }
  }, [route]);

  // ── Dev role-tweak swap → switch dev user id, reload ─────────────
  const prevRoleRef = useRef(tweaks.role);
  useEffect(() => {
    if (prevRoleRef.current === tweaks.role) return;
    prevRoleRef.current = tweaks.role;
    if (IS_DEV && getAuthToken() === null) {
      setDevUserId(DEV_USER_ID_BY_ROLE[tweaks.role]);
      // Clear the resolved identity so the bootstrap effect runs again for
      // the new dev user (it skips whenever currentUserRef is set).
      currentUserRef.current = null;
      setCurrentUser(null);
      setLoading(true);
      setRoute(
        tweaks.role === 'employee'
          ? { name: 'home' }
          : tweaks.role === 'admin'
            ? { name: 'ledger' }
            : { name: 'approver-home' },
      );
    }
  }, [tweaks.role]);

  const setTweak = <K extends keyof Tweaks>(key: K, value: Tweaks[K]) => {
    setTweaks((prev) => ({ ...prev, [key]: value }));
  };

  const onJump = (target: string) => {
    const [name, id] = target.split(':');
    if (!name) return;
    if (name === 'home') setRoute({ name: 'home' });
    else if (name === 'upload') setRoute({ name: 'upload' });
    else if (name === 'bundle-new') setRoute({ name: 'bundle-new' });
    else if (name === 'bundle' && id) setRoute({ name: 'bundle', id });
    else if (name === 'approver-home') setRoute({ name: 'approver-home' });
    else if (name === 'approver-review' && id) setRoute({ name: 'approver-review', id });
    else if (name === 'approver-pay' && id) setRoute({ name: 'approver-pay', id });
    else if (name === 'admin-employees') setRoute({ name: 'admin-employees' });
    else if (name === 'my-requests') setRoute({ name: 'my-requests' });
    else if (name === 'ledger') setRoute({ name: 'ledger' });
    else if (name === 'ledger-entry') setRoute({ name: 'ledger-entry' });
    else if (name === 'ledger-report') setRoute({ name: 'ledger-report' });
    else if (name === 'logout') handleLogout();
  };

  const handleLogout = () => {
    setAuthToken(null);
    setDevUserId(null);
    currentUserRef.current = null;
    setCurrentUser(null);
    setState(EMPTY_STATE);
    setMyState(EMPTY_STATE);
    setRoute({ name: 'login' });
  };

  // ── Public auth screen — no IOSDevice frame, no tweaks panel ─────
  if (route.name === 'login') {
    const inner = <Login theme={theme} cfError={cfError} />;

    // On desktop: center a ~420px column on the paper background.
    if (viewportPlatform === 'desktop') {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: theme.paper,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            style={{
              width: 420,
              maxHeight: '90vh',
              background: theme.surface,
              borderRadius: 24,
              border: `0.5px solid ${theme.hairline}`,
              boxShadow: '0 24px 64px rgba(0,0,0,0.12)',
              overflow: 'hidden',
              display: 'flex',
              flexDirection: 'column',
              minHeight: 540,
            }}
          >
            {inner}
          </div>
        </div>
      );
    }

    return (
      <div
        style={{
          position: 'fixed',
          top: 'var(--hf-band-offset, 0px)',
          right: 0,
          bottom: 0,
          left: 0,
          background: theme.paper,
          overflow: 'auto',
        }}
      >
        {/* HF One shell band, portal-only mode — real mobile flow, not the
            dev-only IOSDevice preview (this branch never uses that frame). */}
        <script
          defer
          src="https://erp.thehfhotel.org/shell/hf-bar.js"
          data-app="Reimbursement"
          data-module="finance"
          data-portal-only="1"
        />
        {inner}
      </div>
    );
  }

  if (route.name === 'admin-employees') {
    const adminRole = currentUser?.role ?? tweaks.role;
    const showAdminBottomNav = platform === 'mobile';
    const adminMobileShell = (
      <>
        <div
          style={{
            position: 'absolute',
            inset: 0,
            background: theme.paper,
            overflow: 'auto',
            paddingBottom: showAdminBottomNav ? 56 : 0,
          }}
        >
          <ManageEmployees
            theme={theme}
            onBack={() => setRoute({ name: 'approver-home' })}
          />
        </div>
        {showAdminBottomNav && (
          <BottomNav
            role={adminRole}
            activeRoute="admin-employees"
            theme={theme}
            onNavigate={(r) => setRoute({ name: r } as Route)}
          />
        )}
      </>
    );
    if (platform !== 'mobile') {
      return (
        <>
          <ManageEmployees
            theme={theme}
            onBack={() => setRoute({ name: 'approver-home' })}
          />
          {IS_DEV && <TweaksPanel tweaks={tweaks} onChange={setTweak} onJump={onJump} />}
        </>
      );
    }
    return (
      <>
        {IS_DEV ? (
          <IOSDevice dark={tweaks.dark} width={402} height={874}>
            {adminMobileShell}
          </IOSDevice>
        ) : (
          <div
            style={{
              position: 'fixed',
              top: 'var(--hf-band-offset, 0px)',
              right: 0,
              bottom: 0,
              left: 0,
              background: theme.paper,
              overflow: 'hidden',
            }}
          >
            {/* HF One shell band, portal-only mode — real mobile flow, not
                the dev-only IOSDevice preview. */}
            <script
              defer
              src="https://erp.thehfhotel.org/shell/hf-bar.js"
              data-app="Reimbursement"
              data-module="finance"
              data-portal-only="1"
            />
            {adminMobileShell}
          </div>
        )}
        {IS_DEV && <TweaksPanel tweaks={tweaks} onChange={setTweak} onJump={onJump} />}
      </>
    );
  }

  if (loading) {
    return <CenteredSpinner background={theme.paper} accent={theme.accent} />;
  }

  if (errorMessage) {
    return (
      <CenteredError
        background={theme.paper}
        ink={theme.ink}
        inkSoft={theme.inkSoft}
        accent={theme.accent}
        message={errorMessage}
        onRetry={() => {
          setLoading(true);
          refetch().finally(() => setLoading(false));
        }}
      />
    );
  }

  const role = currentUser?.role ?? tweaks.role;
  // Company expense ledger — API-authorized for admin and approver alike
  // (apps/api/src/routes/expenses.ts, pl.ts). Approvers reach it only while
  // on one of these routes; outside them they keep their normal desktop/
  // mobile approver experience.
  const LEDGER_ROUTE_NAMES = new Set<Route['name']>(['ledger', 'ledger-entry', 'ledger-report']);
  const isApproverLedger = role === 'approver' && LEDGER_ROUTE_NAMES.has(route.name);
  const REQUESTOR_ROUTES = new Set(['upload', 'record', 'bundle-new', 'bundle-submitted', 'bundle']);
  const inRequestorMode = role === 'employee' || route.name === 'my-requests' || REQUESTOR_ROUTES.has(route.name);
  const reqState = role === 'approver' ? myState : state;
  const reqSetState = role === 'approver' ? setMyState : setState;

  // For an approver working in requestor mode, "back to home" from a requestor
  // sub-screen should land on their own requests, not the approver inbox.
  const reqNav: typeof nav =
    role === 'approver' ? (r) => nav(r.name === 'home' ? { name: 'my-requests' } : r) : nav;

  const screen = renderScreen({
    route,
    theme,
    state,
    setState,
    reqState,
    reqSetState,
    nav,
    reqNav,
    role,
    currentUser,
    onLogout: handleLogout,
  });

  // Bottom nav is visible on top-level screens only (not sub-screens or auth).
  // Admins get it on desktop too — their screens render in the phone-width
  // column shell regardless of platform.
  const BOTTOM_NAV_ROUTES = new Set<Route['name']>(['home', 'approver-home', 'my-requests', 'ledger', 'ledger-report']);
  const showBottomNav =
    (platform === 'mobile' || role === 'admin' || isApproverLedger) && BOTTOM_NAV_ROUTES.has(route.name);
  const handleBottomNav = (r: BottomNavRoute) => setRoute({ name: r } as Route);
  // An approver landing at '/' sits on route 'home' but sees the Inbox —
  // highlight the matching bottom-nav item.
  const activeBottomRoute: BottomNavRoute =
    route.name === 'home' && role === 'approver' ? 'approver-home' : (route.name as BottomNavRoute);

  // FAB is mobile-only; desktop home has the explicit + button in the AppBar.
  // Hide the FAB when the bottom nav is visible (it includes the "เพิ่ม" entry).
  const showFab =
    platform === 'mobile' &&
    !showBottomNav &&
    inRequestorMode &&
    (route.name === 'home' || route.name === 'my-requests' || route.name === 'record');

  // Admin (expense ledger) — no dedicated desktop layout; the kiosk-style
  // screens render in a centered phone-width column on desktop viewports.
  // Approvers share this same shell, but only while on a ledger route (their
  // sidebar dashboard sends them here); every other route keeps their normal
  // desktop shell below unchanged.
  if (platform === 'desktop' && (role === 'admin' || isApproverLedger)) {
    return (
      <>
        <div style={{ position: 'fixed', inset: 0, background: theme.paper }} />
        <div
          style={{
            position: 'fixed',
            top: 'var(--hf-band-offset, 0px)',
            bottom: 0,
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(480px, 100vw)',
            background: theme.paper,
            overflow: 'hidden',
            borderLeft: `0.5px solid ${theme.hairline}`,
            borderRight: `0.5px solid ${theme.hairline}`,
          }}
        >
          {!IS_DEV && (
            <script
              defer
              src="https://erp.thehfhotel.org/shell/hf-bar.js"
              data-app="Reimbursement"
              data-module="finance"
              data-portal-only="1"
            />
          )}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background: theme.paper,
              overflow: 'auto',
              paddingBottom: showBottomNav ? 56 : 0,
            }}
          >
            {screen}
          </div>
          {showBottomNav && (
            <BottomNav
              // Approvers borrow the admin ledger nav (รายจ่าย/บันทึกบิล/งบเดือน)
              // while in this shell so "บันทึกบิล" (new entry) stays reachable —
              // identical to what admin sees on this same route.
              role={isApproverLedger ? 'admin' : role}
              activeRoute={route.name as BottomNavRoute}
              theme={theme}
              onNavigate={handleBottomNav}
            />
          )}
        </div>
        {IS_DEV && <TweaksPanel tweaks={tweaks} onChange={setTweak} onJump={onJump} />}
      </>
    );
  }

  if (platform === 'desktop') {
    return (
      <>
        {role === 'approver' && route.name !== 'my-requests' ? (
          <DesktopApprover
            theme={theme}
            state={state}
            setState={setState}
            onNavigate={(target) => {
              if (target === 'my-requests') setRoute({ name: 'my-requests' });
              else if (target === 'ledger') setRoute({ name: 'ledger' });
              else setRoute({ name: 'admin-employees' });
            }}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        ) : role === 'approver' ? (
          <DesktopEmployee
            theme={theme}
            state={myState}
            setState={setMyState}
            currentUser={currentUser}
            onBackToInbox={() => setRoute({ name: 'approver-home' })}
            onLogout={handleLogout}
          />
        ) : (
          <DesktopEmployee
            theme={theme}
            state={state}
            setState={setState}
            currentUser={currentUser}
            onLogout={handleLogout}
          />
        )}
        {IS_DEV && <TweaksPanel tweaks={tweaks} onChange={setTweak} onJump={onJump} />}
      </>
    );
  }

  const mobileShell = (
    <>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: theme.paper,
          overflow: 'auto',
          paddingBottom: showBottomNav ? 56 : 0,
        }}
      >
        {screen}
      </div>
      {showBottomNav && (
        <BottomNav
          role={role}
          activeRoute={activeBottomRoute}
          theme={theme}
          onNavigate={handleBottomNav}
        />
      )}
      {showFab && (
        <button
          onClick={() => setRoute({ name: 'upload' })}
          style={{
            position: 'absolute',
            bottom: 28,
            right: 24,
            width: 60,
            height: 60,
            borderRadius: 30,
            background: theme.accent,
            border: 'none',
            cursor: 'pointer',
            boxShadow: '0 12px 28px rgba(0,0,0,0.28), 0 2px 6px rgba(0,0,0,0.18)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            zIndex: 50,
          }}
        >
          {Icon.camera('#fff')}
        </button>
      )}
    </>
  );

  return (
    <>
      {IS_DEV ? (
        // Dev-only phone preview frame (the tweaks panel toggles platform).
        <IOSDevice dark={tweaks.dark} width={402} height={874}>
          {mobileShell}
        </IOSDevice>
      ) : (
        // Production: render full-bleed at the device viewport.
        <div
          style={{
            position: 'fixed',
            top: 'var(--hf-band-offset, 0px)',
            right: 0,
            bottom: 0,
            left: 0,
            background: theme.paper,
            overflow: 'hidden',
          }}
        >
          {/* HF One shell band, portal-only mode — real mobile flow, not the
              dev-only IOSDevice preview above. */}
          <script
            defer
            src="https://erp.thehfhotel.org/shell/hf-bar.js"
            data-app="Reimbursement"
            data-module="finance"
            data-portal-only="1"
          />
          {mobileShell}
        </div>
      )}
      {IS_DEV && <TweaksPanel tweaks={tweaks} onChange={setTweak} onJump={onJump} />}
    </>
  );
}

interface RenderArgs {
  route: Route;
  theme: ReturnType<typeof getTheme>;
  state: AppState;
  setState: (updater: (s: AppState) => AppState) => void;
  reqState: AppState;
  reqSetState: (updater: (s: AppState) => AppState) => void;
  nav: (r: Route) => void;
  reqNav: (r: Route) => void;
  role: Tweaks['role'];
  currentUser: User | null;
  onLogout: () => void;
}

function renderScreen({ route, theme, state, setState, reqState, reqSetState, nav, reqNav, role, currentUser, onLogout }: RenderArgs) {
  // Requestor flow — available to any signed-in user (owner-scoped data)
  if (route.name === 'upload') return <Upload theme={theme} state={reqState} nav={reqNav} setState={reqSetState} editId={route.editId} />;
  if (route.name === 'record') return <RecordDetail theme={theme} state={reqState} setState={reqSetState} nav={reqNav} recordId={route.id} />;
  if (route.name === 'bundle-new') return <BundleBuilder theme={theme} state={reqState} nav={reqNav} setState={reqSetState} preselectId={route.id} />;
  if (route.name === 'bundle-submitted')
    return <BundleSubmitted theme={theme} state={reqState} nav={reqNav} bundleId={route.id} />;
  if (route.name === 'bundle') return <BundleDetail theme={theme} state={reqState} nav={reqNav} bundleId={route.id} />;
  if (route.name === 'my-requests')
    return <Home theme={theme} state={reqState} nav={nav} currentUser={currentUser} isApprover={role === 'approver'} />;

  // Approver inbox flow
  if (route.name === 'approver-review')
    return <Review theme={theme} state={state} nav={nav} bundleId={route.id} setState={setState} />;
  if (route.name === 'approver-pay')
    return <Pay theme={theme} state={state} nav={nav} bundleId={route.id} setState={setState} />;
  if (route.name === 'approver-home')
    return <Inbox theme={theme} state={state} nav={nav} currentUser={currentUser} onLogout={onLogout} />;

  // Company expense ledger (admin, also reachable by approvers)
  if (route.name === 'ledger')
    return (
      <LedgerDashboard
        theme={theme}
        nav={nav}
        initialMonth={route.month}
        onBack={role === 'approver' ? () => nav({ name: 'approver-home' }) : undefined}
      />
    );
  if (route.name === 'ledger-entry') return <ExpenseWizard theme={theme} nav={nav} edit={route.edit} />;
  if (route.name === 'ledger-report') return <PlReportScreen theme={theme} nav={nav} initialMonth={route.month} />;

  // 'home': employee → requestor Home; admin → ledger; approver → inbox
  if (role === 'employee')
    return <Home theme={theme} state={reqState} nav={nav} currentUser={currentUser} onLogout={onLogout} />;
  if (role === 'admin') return <LedgerDashboard theme={theme} nav={nav} />;
  return <Inbox theme={theme} state={state} nav={nav} currentUser={currentUser} onLogout={onLogout} />;
}

function pathForRoute(route: Route): string {
  switch (route.name) {
    case 'login':
      return '/login';
    case 'admin-employees':
      return '/admin/employees';
    case 'my-requests':
      return '/my-requests';
    case 'ledger':
      return '/ledger';
    case 'ledger-entry':
      return '/ledger/entry';
    case 'ledger-report':
      return '/ledger/report';
    default:
      return '/';
  }
}

function CenteredSpinner({ background, accent }: { background: string; accent: string }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: '50%',
          border: `2.5px solid ${accent}`,
          borderTopColor: 'transparent',
          animation: 'spin 0.8s linear infinite',
        }}
      />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } } *:focus-visible { outline: 2px solid #C8501A; outline-offset: 2px; border-radius: 2px; }`}</style>
    </div>
  );
}

interface CenteredErrorProps {
  background: string;
  ink: string;
  inkSoft: string;
  accent: string;
  message: string;
  onRetry: () => void;
}

function CenteredError({ background, ink, inkSoft, accent, message, onRetry }: CenteredErrorProps) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '0 28px',
        textAlign: 'center',
      }}
    >
      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 13, color: inkSoft, letterSpacing: 1.2, textTransform: 'uppercase', marginBottom: 8 }}>
        เกิดข้อผิดพลาด
      </div>
      <div style={{ fontFamily: 'Arial, sans-serif', fontSize: 16, color: ink, maxWidth: 380, lineHeight: 1.5, marginBottom: 20 }}>
        {message}
      </div>
      <button
        onClick={onRetry}
        style={{
          padding: '10px 22px',
          background: accent,
          color: '#fff',
          border: 'none',
          borderRadius: 12,
          fontFamily: 'Arial, sans-serif',
          fontSize: 14,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        ลองใหม่
      </button>
    </div>
  );
}
