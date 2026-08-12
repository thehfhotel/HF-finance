import type { Theme, User } from '../lib/types';
import { FONT_DISPLAY, FONT_UI } from '../lib/theme';
import { Icon } from './icons';

/**
 * The one desktop sidebar.
 *
 * Every desktop screen used to build its own: the approver console, the
 * requestor console and the employee admin page each had a different list, so
 * opening พนักงาน or คำขอของฉัน replaced the whole menu and the way back was a
 * "← กลับ" link. You could not see where you were in the app, only where you
 * had ended up.
 *
 * So the menu is now identical everywhere and only `active` changes. Every
 * destination stays on screen at all times, which is the entire point — a
 * sidebar that rearranges itself when clicked is not navigation, it is a series
 * of dead ends.
 */

export type SidebarKey =
  // Approval box — other people's requests, approver only.
  | 'pending'
  | 'approved'
  | 'paid'
  | 'rejected'
  // Your own requests. Laid out as their own four rows rather than collapsed
  // behind one "my requests" link: an approver is also an employee, and hiding
  // their own work one click deeper is the mode switch this menu exists to kill.
  | 'my-drafts'
  | 'my-pending'
  | 'my-approved'
  | 'my-paid'
  | 'my-rejected'
  | 'overview'
  | 'employees'
  | 'admin-settings';

export interface SidebarCounts {
  pending?: number;
  approved?: number;
  paid?: number;
  rejected?: number;
  myDrafts?: number;
  myPending?: number;
  myApproved?: number;
  myPaid?: number;
  myRejected?: number;
}

interface AppSidebarProps {
  theme: Theme;
  currentUser: User | null;
  /** Approvers additionally get the approval box and the employee admin page. */
  isApprover: boolean;
  active: SidebarKey | null;
  counts?: SidebarCounts;
  onSelect: (key: SidebarKey) => void;
  onLogout?: () => void;
}

interface ItemProps {
  theme: Theme;
  icon: (color: string) => React.ReactElement;
  label: string;
  active: boolean;
  count?: number;
  /** Draws the status dot in its own colour rather than the accent. */
  dot?: string;
  onClick?: () => void;
}

function Item({ theme, icon, label, active, count, dot, onClick }: ItemProps) {
  const color = active ? theme.accent : theme.inkSoft;
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      aria-current={active ? 'page' : undefined}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        width: 'calc(100% - 16px)',
        margin: '1px 8px',
        padding: '8px 10px',
        borderRadius: 8,
        border: 'none',
        background: active ? `${theme.accent}14` : 'transparent',
        color: active ? theme.accent : theme.ink,
        font: 'inherit',
        fontFamily: FONT_UI,
        fontSize: 13,
        fontWeight: active ? 600 : 400,
        textAlign: 'left',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{ display: 'grid', placeItems: 'center', width: 18, height: 18, flex: 'none' }}>
        {icon(dot && !active ? dot : color)}
      </span>
      <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      {count !== undefined && (
        <span
          style={{
            fontFamily: FONT_UI,
            fontSize: 11,
            color: active ? theme.accent : theme.inkSofter,
            fontVariantNumeric: 'tabular-nums',
          }}
        >
          {count}
        </span>
      )}
      {/* HF One marks the active row with a gold tick on the right. */}
      {active && (
        <span
          style={{
            position: 'absolute',
            right: 4,
            width: 2,
            height: 20,
            borderRadius: 2,
            background: theme.warn,
          }}
        />
      )}
    </button>
  );
}

function Section({ theme, label }: { theme: Theme; label: string }) {
  return (
    <div
      style={{
        padding: '14px 18px 5px',
        fontFamily: FONT_UI,
        fontSize: 10,
        fontWeight: 600,
        color: theme.inkSofter,
        letterSpacing: 1.2,
        textTransform: 'uppercase',
      }}
    >
      {label}
    </div>
  );
}

export function AppSidebar({
  theme,
  currentUser,
  isApprover,
  active,
  counts = {},
  onSelect,
  onLogout,
}: AppSidebarProps) {
  const item = (key: SidebarKey, label: string, icon: ItemProps['icon'], extra?: { count?: number; dot?: string }) => (
    <Item
      theme={theme}
      icon={icon}
      label={label}
      active={active === key}
      count={extra?.count}
      dot={extra?.dot}
      onClick={() => onSelect(key)}
    />
  );

  return (
    <>
      <div style={{ padding: '8px 18px 12px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 21, color: theme.ink, letterSpacing: -0.4 }}>
          เบิกค่าใช้จ่าย
        </div>
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, marginTop: 2 }}>
          {isApprover ? 'การเงิน · ผู้อนุมัติ' : 'พนักงาน'}
        </div>
      </div>

      {item('overview', 'ภาพรวม', Icon.chart)}

      {isApprover && (
        <>
          <Section theme={theme} label="กล่องอนุมัติ" />
          {item('pending', 'รออนุมัติ', Icon.clock, { count: counts.pending, dot: theme.statusPending })}
          {item('approved', 'อนุมัติแล้ว', Icon.checkCircle, { count: counts.approved, dot: theme.statusApproved })}
          {item('paid', 'จ่ายแล้ว', Icon.bank, { count: counts.paid, dot: theme.statusPaid })}
          {item('rejected', 'ปฏิเสธ', Icon.xCircle, { count: counts.rejected, dot: theme.statusRejected })}
        </>
      )}

      <Section theme={theme} label="คำขอของฉัน" />
      {item('my-drafts', 'รายการใหม่', Icon.draft, { count: counts.myDrafts })}
      {item('my-pending', 'รออนุมัติ', Icon.clock, { count: counts.myPending, dot: theme.statusPending })}
      {item('my-approved', 'อนุมัติแล้ว', Icon.checkCircle, { count: counts.myApproved, dot: theme.statusApproved })}
      {item('my-paid', 'จ่ายแล้ว', Icon.bank, { count: counts.myPaid, dot: theme.statusPaid })}
      {item('my-rejected', 'ปฏิเสธ', Icon.xCircle, { count: counts.myRejected, dot: theme.statusRejected })}

      {isApprover && (
        <>
          <Section theme={theme} label="การจัดการ" />
          {item('employees', 'พนักงาน', Icon.user)}
          {item('admin-settings', 'ตั้งค่า', Icon.bank)}
        </>
      )}
      {onLogout && (
        <Item theme={theme} icon={Icon.logout} label="ออกจากระบบ" active={false} onClick={onLogout} />
      )}

      <div style={{ flex: 1 }} />

      <div
        style={{
          margin: '0 8px 12px',
          padding: '8px 10px',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          borderTop: `0.5px solid ${theme.hairline}`,
          paddingTop: 12,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            background: theme.accent,
            color: theme.paper,
            display: 'grid',
            placeItems: 'center',
            fontFamily: FONT_UI,
            fontSize: 11,
            fontWeight: 600,
            flex: 'none',
          }}
        >
          {currentUser?.initials ?? ''}
        </div>
        <div style={{ minWidth: 0 }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12.5,
              fontWeight: 500,
              color: theme.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {currentUser?.name ?? ''}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 10.5, color: theme.inkSofter }}>
            {isApprover ? 'การเงิน' : 'พนักงาน'}
          </div>
        </div>
      </div>
    </>
  );
}
