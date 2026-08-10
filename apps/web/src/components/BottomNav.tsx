import type { Theme } from '../lib/types';
import { FONT_UI } from '../lib/theme';
import { Icon } from './icons';

/** Routes the bottom nav can navigate to — all are parameter-free. */
export type BottomNavRoute =
  | 'home'
  | 'upload'
  | 'approver-home'
  | 'overview'
  | 'my-requests'
  | 'admin-employees';

interface NavItem {
  label: string;
  route: BottomNavRoute;
  icon: (color: string) => React.ReactElement;
}

const EMPLOYEE_ITEMS: NavItem[] = [
  { label: 'คำขอ', route: 'home', icon: Icon.receipt },
];

const APPROVER_ITEMS: NavItem[] = [
  { label: 'ภาพรวม', route: 'overview', icon: Icon.filter },
  { label: 'กล่องอนุมัติ', route: 'approver-home', icon: Icon.bundle },
  { label: 'คำขอของฉัน', route: 'my-requests', icon: Icon.receipt },
  { label: 'พนักงาน', route: 'admin-employees', icon: Icon.user },
];

interface BottomNavProps {
  role: 'employee' | 'approver';
  activeRoute: BottomNavRoute;
  theme: Theme;
  onNavigate: (route: BottomNavRoute) => void;
}

export function BottomNav({ role, activeRoute, theme, onNavigate }: BottomNavProps) {
  const items = role === 'approver' ? APPROVER_ITEMS : EMPLOYEE_ITEMS;
  // Split around the camera. Both halves are flex:1, so the button stays dead
  // centre even when one side has fewer items than the other.
  const half = Math.ceil(items.length / 2);
  const leftItems = items.slice(0, half);
  const rightItems = items.slice(half);

  const renderItem = (item: NavItem) => {
    const isActive = item.route === activeRoute;
    const color = isActive ? theme.accent : theme.inkSoft;
    return (
      <button
        key={item.route}
        onClick={() => onNavigate(item.route)}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 3,
          padding: '10px 4px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          color,
          minHeight: 56,
        }}
      >
        {item.icon(color)}
        <span
          style={{
            fontSize: 10,
            fontFamily: FONT_UI,
            fontWeight: isActive ? 600 : 400,
            color,
            letterSpacing: 0,
            lineHeight: 1.2,
          }}
        >
          {item.label}
        </span>
      </button>
    );
  };

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
        background: theme.surface,
        borderTop: `0.5px solid ${theme.hairline}`,
        display: 'flex',
        alignItems: 'stretch',
        paddingBottom: 'env(safe-area-inset-bottom)',
        zIndex: 40,
      }}
    >
      <div style={{ flex: 1, display: 'flex' }}>{leftItems.map(renderItem)}</div>

      {/* Taking the photo is the first step of every expense and the thing done
          most often on a phone, so it gets the thumb-reachable centre and a
          bigger target than a nav item can offer. Raised above the bar so it
          reads as an action, not a destination. */}
      <button
        onClick={() => onNavigate('upload')}
        aria-label="ถ่ายใบเสร็จ"
        style={{
          flex: 'none',
          width: 62,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'flex-start',
          gap: 2,
          paddingTop: 4,
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        <span
          style={{
            width: 52,
            height: 52,
            marginTop: -18,
            borderRadius: 26,
            background: theme.accent,
            color: theme.paper,
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 6px 16px rgba(38,34,30,0.28)',
            border: `3px solid ${theme.surface}`,
          }}
        >
          {Icon.camera(theme.paper)}
        </span>
        <span
          style={{
            fontSize: 10,
            fontFamily: FONT_UI,
            fontWeight: 600,
            color: theme.accent,
            lineHeight: 1.2,
          }}
        >
          รายการใหม่
        </span>
      </button>

      <div style={{ flex: 1, display: 'flex' }}>{rightItems.map(renderItem)}</div>
    </div>
  );
}
