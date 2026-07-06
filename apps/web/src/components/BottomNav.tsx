import type { Theme } from '../lib/types';
import { Icon } from './icons';

/** Routes the bottom nav can navigate to — all are parameter-free. */
export type BottomNavRoute =
  | 'home'
  | 'upload'
  | 'approver-home'
  | 'my-requests'
  | 'admin-employees'
  | 'ledger'
  | 'ledger-entry'
  | 'ledger-report';

interface NavItem {
  label: string;
  route: BottomNavRoute;
  icon: (color: string) => React.ReactElement;
}

const EMPLOYEE_ITEMS: NavItem[] = [
  { label: 'คำขอ', route: 'home', icon: Icon.receipt },
  { label: 'เพิ่ม', route: 'upload', icon: Icon.plus },
];

const APPROVER_ITEMS: NavItem[] = [
  { label: 'กล่องอนุมัติ', route: 'approver-home', icon: Icon.bundle },
  { label: 'คำขอของฉัน', route: 'my-requests', icon: Icon.receipt },
  { label: 'พนักงาน', route: 'admin-employees', icon: Icon.user },
];

const ADMIN_ITEMS: NavItem[] = [
  { label: 'รายจ่าย', route: 'ledger', icon: Icon.receipt },
  { label: 'บันทึกบิล', route: 'ledger-entry', icon: Icon.plus },
  { label: 'งบเดือน', route: 'ledger-report', icon: Icon.bank },
];

interface BottomNavProps {
  role: 'employee' | 'approver' | 'admin';
  activeRoute: BottomNavRoute;
  theme: Theme;
  onNavigate: (route: BottomNavRoute) => void;
}

export function BottomNav({ role, activeRoute, theme, onNavigate }: BottomNavProps) {
  const items = role === 'admin' ? ADMIN_ITEMS : role === 'approver' ? APPROVER_ITEMS : EMPLOYEE_ITEMS;

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
      {items.map((item) => {
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
                fontFamily: 'system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Helvetica, Arial, sans-serif',
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
      })}
    </div>
  );
}
