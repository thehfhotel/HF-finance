import { useState } from 'react';
import type { AppState, BundleStatus, BundleWithDetails, Theme, User } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmt, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { AppBar } from '../../components/AppBar';
import { Avatar, Card, Money, StatusPill } from '../../components/primitives';
import { ReceiptThumb } from '../../components/Receipts';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/icons';

interface InboxProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  currentUser: User | null;
  onLogout?: () => void;
}

type TabKey = Extract<BundleStatus, 'pending' | 'approved' | 'paid' | 'rejected'>;

export function Inbox({ theme, state, nav, currentUser, onLogout }: InboxProps) {
  const allBundles: BundleWithDetails[] = state.bundles;
  const pending = allBundles.filter((b) => b.status === 'pending');
  const approved = allBundles.filter((b) => b.status === 'approved');
  const paid = allBundles.filter((b) => b.status === 'paid');
  const rejected = allBundles.filter((b) => b.status === 'rejected');
  const [tab, setTab] = useState<TabKey>('pending');

  const list =
    tab === 'pending'
      ? pending
      : tab === 'approved'
        ? approved
        : tab === 'paid'
          ? paid
          : rejected;
  const totalPending = pending.reduce(
    (s, b) => s + b.receipts.reduce((a, r) => a + r.amount, 0),
    0,
  );

  const tabs: ReadonlyArray<readonly [TabKey, string, number]> = [
    ['pending', 'รออนุมัติ', pending.length],
    ['approved', 'อนุมัติแล้ว', approved.length],
    ['paid', 'จ่ายแล้ว', paid.length],
    ['rejected', 'ปฏิเสธ', rejected.length],
  ];

  return (
    <div style={{ paddingBottom: 60 }}>
      <AppBar
        theme={theme}
        large
        subtitle="การเงิน · ผู้อนุมัติ"
        title="กล่องอนุมัติ"
        leading={<Avatar theme={theme} initials={currentUser?.initials ?? ''} />}
        trailing={
          <>
            <button
              onClick={() => nav({ name: 'my-requests' })}
              style={{
                background: 'transparent',
                border: 'none',
                fontFamily: FONT_UI,
                fontSize: 14,
                color: theme.inkSoft,
                cursor: 'pointer',
                padding: '4px 8px',
              }}
            >
              คำขอของฉัน
            </button>
            {onLogout && (
              <button
                onClick={onLogout}
                title="ออกจากระบบ"
                style={{
                  background: 'transparent',
                  border: 'none',
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: theme.inkSoft,
                  cursor: 'pointer',
                  padding: '4px 8px',
                }}
              >
                ออก
              </button>
            )}
          </>
        }
      />

      {/* Stats */}
      <div style={{ padding: '8px 20px 0', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <Card theme={theme} padding={16} onClick={() => setTab('pending')} style={{ cursor: 'pointer' }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            รออนุมัติ
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -0.6,
            }}
          >
            {pending.length}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 6 }}>
            {fmt(totalPending)}
          </div>
        </Card>
        <Card theme={theme} padding={16} onClick={() => setTab('approved')} style={{ cursor: 'pointer' }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            พร้อมจ่าย
          </div>
          <div
            style={{
              marginTop: 6,
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -0.6,
            }}
          >
            {approved.length}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.warn, marginTop: 6 }}>ต้องดำเนินการ →</div>
        </Card>
      </div>

      {/* Tabs */}
      <div
        style={{
          padding: '24px 20px 0',
          display: 'flex',
          gap: 4,
          borderBottom: `0.5px solid ${theme.hairline}`,
        }}
      >
        {tabs.map(([k, l, n]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            style={{
              padding: '12px 14px',
              background: 'transparent',
              border: 'none',
              fontFamily: FONT_UI,
              fontSize: 13,
              fontWeight: 500,
              color: tab === k ? theme.ink : theme.inkSoft,
              borderBottom: `2px solid ${tab === k ? (k === 'rejected' ? theme.statusRejected : theme.accent) : 'transparent'}`,
              cursor: 'pointer',
              marginBottom: -0.5,
            }}
          >
            {l} <span style={{ opacity: 0.5, marginLeft: 4 }}>{n}</span>
          </button>
        ))}
      </div>

      {/* List */}
      <div style={{ padding: '14px 20px' }}>
        {list.length === 0 && (
          <div style={{ paddingTop: 40, paddingBottom: 40 }}>
            <EmptyState
              theme={theme}
              icon={Icon.bundle}
              title="ว่างอยู่"
              subtext="ไม่มีรายการในแท็บนี้"
            />
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {list.map((b) => (
            <ApproverBundleRow
              key={b.id}
              bundle={b}
              theme={theme}
              onClick={() => nav({ name: 'approver-review', id: b.id })}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ApproverBundleRowProps {
  bundle: BundleWithDetails;
  theme: Theme;
  onClick: () => void;
}

function ApproverBundleRow({ bundle, theme, onClick }: ApproverBundleRowProps) {
  const items = bundle.receipts;
  const total = items.reduce((s, r) => s + r.amount, 0);

  return (
    <Card theme={theme} padding={16} onClick={onClick}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          marginBottom: 10,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, fontWeight: 500 }}>
            {bundle.submitter.name}
          </div>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 15,
              fontWeight: 500,
              color: theme.ink,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {bundle.name}
          </div>
        </div>
        <Money value={total} theme={theme} size={18} accent />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ display: 'flex' }}>
          {items.slice(0, 4).map((r, i) => (
            <div
              key={r.id}
              style={{ marginLeft: i === 0 ? 0 : -10, zIndex: 4 - i, position: 'relative' }}
            >
              <div style={{ borderRadius: 8, border: `2px solid ${theme.surface}`, lineHeight: 0 }}>
                <ReceiptThumb receipt={r} size={32} />
              </div>
            </div>
          ))}
        </div>
        <span style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginLeft: 8 }}>
          {items.length} ใบเสร็จ · {formatThaiDate(bundle.submittedAt)}
        </span>
        <div style={{ flex: 1 }} />
        <StatusPill status={bundle.status} theme={theme} size="sm" />
      </div>
    </Card>
  );
}
