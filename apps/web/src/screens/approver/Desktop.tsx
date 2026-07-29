import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, CSSProperties, ReactNode } from 'react';
import type { AppState, BundleStatus, BundleWithDetails, Receipt, Theme, User } from '../../lib/types';
import { fmt, fmt0, fmtN, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import { api, payFormFromFields } from '../../lib/api';
import { dataUrlToFile } from '../../lib/photoUpload';
import { DesktopShell, SidebarItem } from '../../components/DesktopShell';
import { Card, GhostButton, Money, PrimaryButton, StatusPill } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { ReceiptPhoto, ReceiptThumb } from '../../components/Receipts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState } from '../../components/EmptyState';
import { Toast, useToast } from '../../components/Toast';

const TABLE_GRID_COLUMNS = '1.2fr 1fr 1fr 100px';
const DETAIL_MAX_WIDTH = 840;

type FilterKey = Exclude<BundleStatus, 'draft'>;

interface DesktopApproverProps {
  theme: Theme;
  state: AppState;
  setState: (updater: (s: AppState) => AppState) => void;
  onNavigate?: (target: 'admin-employees' | 'my-requests') => void;
  currentUser: User | null;
  onLogout?: () => void;
}

export function DesktopApprover({ theme, state, setState, onNavigate, currentUser, onLogout }: DesktopApproverProps): JSX.Element {
  const [filter, setFilter] = useState<FilterKey>('pending');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);
  const [payOpen, setPayOpen] = useState(false);
  const [transferRefInput, setTransferRefInput] = useState('');
  const [proof, setProof] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [confirmState, setConfirmState] = useState<{ open: boolean; kind: 'approve' | 'pay' | 'reject' }>({
    open: false,
    kind: 'approve',
  });
  const { toast, showToast } = useToast();

  const allBundles: BundleWithDetails[] = state.bundles;

  const pendingBundles = allBundles.filter((b) => b.status === 'pending');
  const approvedBundles = allBundles.filter((b) => b.status === 'approved');
  const paidBundles = allBundles.filter((b) => b.status === 'paid');
  const rejectedBundles = allBundles.filter((b) => b.status === 'rejected');

  const visibleList: BundleWithDetails[] =
    filter === 'pending'
      ? pendingBundles
      : filter === 'approved'
        ? approvedBundles
        : filter === 'paid'
          ? paidBundles
          : rejectedBundles;

  const selectedBundle: BundleWithDetails | undefined =
    allBundles.find((b) => b.id === selectedId) ?? visibleList[0];

  const sumOfBundle = (bundle: BundleWithDetails): number =>
    bundle.receipts.reduce((acc, r) => acc + r.amount, 0);

  const totalPending = pendingBundles.reduce((acc, b) => acc + sumOfBundle(b), 0);

  const items: Receipt[] = selectedBundle ? selectedBundle.receipts : [];
  const total = items.reduce((acc, r) => acc + r.amount, 0);

  const applyServerUpdate = (updated: BundleWithDetails): void => {
    setState((s) => ({
      ...s,
      bundles: s.bundles.map((x) => (x.id === updated.id ? updated : x)),
    }));
  };

  const handleApprove = async (): Promise<void> => {
    if (!selectedBundle || submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.approve(selectedBundle.id);
      applyServerUpdate(updated);
      setConfirmState((s) => ({ ...s, open: false }));
      showToast('อนุมัติคำขอแล้ว');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setConfirmState((s) => ({ ...s, open: false }));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReject = async (reason: string): Promise<void> => {
    if (!selectedBundle || submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.reject(selectedBundle.id, reason.trim() || undefined);
      applyServerUpdate(updated);
      setConfirmState((s) => ({ ...s, open: false }));
      showToast('ปฏิเสธคำขอแล้ว');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setConfirmState((s) => ({ ...s, open: false }));
    } finally {
      setSubmitting(false);
      setRejectReason('');
    }
  };

  const closePaySheet = (): void => {
    setPayOpen(false);
    setTransferRefInput('');
    setProof(null);
    setActionError(null);
  };

  const confirmPay = async (): Promise<void> => {
    if (!selectedBundle || !proof || !transferRefInput.trim() || submitting) return;
    setActionError(null);
    setSubmitting(true);
    try {
      const proofFile = await dataUrlToFile(proof, 'proof.jpg');
      const updated = await api.bundles.pay(
        selectedBundle.id,
        payFormFromFields(transferRefInput.trim(), proofFile),
      );
      applyServerUpdate(updated);
      setConfirmState((s) => ({ ...s, open: false }));
      closePaySheet();
      showToast('บันทึกการจ่ายสำเร็จ');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setConfirmState((s) => ({ ...s, open: false }));
    } finally {
      setSubmitting(false);
    }
  };

  const selectFilter = (next: FilterKey): void => {
    setFilter(next);
    setSelectedId(null);
    setActionError(null);
  };

  const selectBundle = (id: string): void => {
    setSelectedId(id);
    setActionError(null);
  };

  const sidebar = (
    <SidebarContent
      theme={theme}
      filter={filter}
      pendingCount={pendingBundles.length}
      approvedCount={approvedBundles.length}
      paidCount={paidBundles.length}
      rejectedCount={rejectedBundles.length}
      onSelectFilter={selectFilter}
      onNavigate={onNavigate}
      currentUser={currentUser}
      onLogout={onLogout}
    />
  );

  return (
    <DesktopShell theme={theme} sidebar={sidebar}>
      <div style={{ display: 'flex', height: '100%', background: theme.paper }}>
        <BundleListColumn
          theme={theme}
          filter={filter}
          list={visibleList}
          selected={selectedBundle}
          totalPending={totalPending}
          sumOfBundle={sumOfBundle}
          onSelect={selectBundle}
        />

        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {selectedBundle ? (
            <DesktopDetail
              theme={theme}
              bundle={selectedBundle}
              items={items}
              total={total}
              onApprove={() => setConfirmState({ open: true, kind: 'approve' })}
              onReject={() => setConfirmState({ open: true, kind: 'reject' })}
              onPay={() => setPayOpen(true)}
              onPhoto={(i) => setPhotoIdx(i)}
              submitting={submitting}
              actionError={actionError}
            />
          ) : (
            <EmptyState
              theme={theme}
              icon={Icon.bundle}
              title="เลือกคำขอเพื่อดูรายละเอียด"
              subtext="เลือกรายการจากด้านซ้ายเพื่อดูใบเสร็จ ยอดรวม และดำเนินการอนุมัติ"
            />
          )}

          {photoIdx !== null && items[photoIdx] && (
            <PhotoLightbox
              theme={theme}
              items={items}
              index={photoIdx}
              onClose={() => setPhotoIdx(null)}
              onPrev={() => setPhotoIdx(Math.max(0, photoIdx - 1))}
              onNext={() => setPhotoIdx(Math.min(items.length - 1, photoIdx + 1))}
            />
          )}

          {payOpen && selectedBundle && (
            <PaySheet
              theme={theme}
              bundle={selectedBundle}
              total={total}
              transferRefInput={transferRefInput}
              setTransferRefInput={setTransferRefInput}
              proof={proof}
              setProof={setProof}
              onClose={closePaySheet}
              onConfirm={() => setConfirmState({ open: true, kind: 'pay' })}
              submitting={submitting}
              actionError={actionError}
            />
          )}
        </div>
      </div>

      {confirmState.open && selectedBundle && (
        <ConfirmDialog
          theme={theme}
          title={
            confirmState.kind === 'approve'
              ? `อนุมัติคำขอนี้?`
              : confirmState.kind === 'reject'
                ? `ปฏิเสธคำขอนี้?`
                : `ยืนยันการจ่าย ฿${fmtN(total)}?`
          }
          message={
            confirmState.kind === 'approve'
              ? `อนุมัติ ${fmt(total)} ให้ ${selectedBundle.submitter.name}`
              : confirmState.kind === 'reject'
                ? (
                  <span>
                    <span style={{ display: 'block', marginBottom: 12 }}>
                      {`คำขอของ ${selectedBundle.submitter.name} จะถูกปฏิเสธ`}
                    </span>
                    <label
                      style={{
                        display: 'block',
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        color: theme.inkSoft,
                        marginBottom: 6,
                      }}
                    >
                      เหตุผล (ถ้ามี)
                    </label>
                    <textarea
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="ระบุเหตุผล..."
                      rows={3}
                      style={{
                        width: '100%',
                        padding: '8px 10px',
                        borderRadius: 8,
                        background: theme.surface,
                        border: `0.5px solid ${theme.hairlineStrong}`,
                        fontFamily: FONT_UI,
                        fontSize: 13,
                        color: theme.ink,
                        outline: 'none',
                        resize: 'vertical',
                        boxSizing: 'border-box',
                      }}
                    />
                  </span>
                )
                : `จ่ายให้ ${selectedBundle.submitter.name} — การดำเนินการนี้ไม่สามารถยกเลิกได้`
          }
          confirmLabel={confirmState.kind === 'approve' ? 'อนุมัติ' : confirmState.kind === 'reject' ? 'ปฏิเสธ' : 'ยืนยัน'}
          danger={confirmState.kind === 'reject'}
          loading={submitting}
          onConfirm={() => {
            if (confirmState.kind === 'approve') {
              void handleApprove();
            } else if (confirmState.kind === 'reject') {
              void handleReject(rejectReason);
            } else {
              void confirmPay();
            }
          }}
          onCancel={() => { setConfirmState((s) => ({ ...s, open: false })); setRejectReason(''); }}
        />
      )}

      <Toast toast={toast} theme={theme} />
    </DesktopShell>
  );
}

// ── Sidebar ─────────────────────────────────────────────────────────

interface SidebarContentProps {
  theme: Theme;
  filter: FilterKey;
  pendingCount: number;
  approvedCount: number;
  paidCount: number;
  rejectedCount: number;
  onSelectFilter: (next: FilterKey) => void;
  onNavigate?: (target: 'admin-employees' | 'my-requests') => void;
  currentUser: User | null;
  onLogout?: () => void;
}

function SidebarContent({
  theme,
  filter,
  pendingCount,
  approvedCount,
  paidCount,
  rejectedCount,
  onSelectFilter,
  onNavigate,
  currentUser,
  onLogout,
}: SidebarContentProps): JSX.Element {
  return (
    <>
      <div style={{ padding: '8px 16px 14px' }}>
        <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, color: theme.ink, letterSpacing: -0.4 }}>
          เบิกค่าใช้จ่าย
        </div>
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, marginTop: 2 }}>
          การเงิน · ผู้อนุมัติ
        </div>
      </div>

      <SidebarItem
        theme={theme}
        label="รออนุมัติ"
        count={pendingCount}
        active={filter === 'pending'}
        accent
        onClick={() => onSelectFilter('pending')}
      />
      <SidebarItem
        theme={theme}
        label="อนุมัติแล้ว"
        count={approvedCount}
        active={filter === 'approved'}
        onClick={() => onSelectFilter('approved')}
      />
      <SidebarItem
        theme={theme}
        label="จ่ายแล้ว"
        count={paidCount}
        active={filter === 'paid'}
        onClick={() => onSelectFilter('paid')}
      />
      <SidebarItem
        theme={theme}
        label="ปฏิเสธ"
        count={rejectedCount}
        active={filter === 'rejected'}
        onClick={() => onSelectFilter('rejected')}
      />

      <div style={{ height: 16 }} />
      <div
        style={{
          padding: '6px 16px 6px',
          fontFamily: FONT_UI,
          fontSize: 10,
          fontWeight: 600,
          color: theme.inkSofter,
          letterSpacing: 1.2,
          textTransform: 'uppercase',
        }}
      >
        การจัดการ
      </div>
      <SidebarItem
        theme={theme}
        label="พนักงาน"
        onClick={onNavigate ? () => onNavigate('admin-employees') : undefined}
      />
      <SidebarItem
        theme={theme}
        label="คำขอของฉัน"
        onClick={onNavigate ? () => onNavigate('my-requests') : undefined}
      />
      {onLogout && <SidebarItem theme={theme} label="ออกจากระบบ" onClick={onLogout} />}

      <div style={{ flex: 1 }} />

      <div
        style={{
          margin: '0 8px 12px',
          padding: '8px 10px',
          borderRadius: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div
          style={{
            width: 28,
            height: 28,
            borderRadius: 14,
            background: theme.accent,
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: FONT_UI,
            fontSize: 11,
            fontWeight: 600,
          }}
        >
          {currentUser?.initials ?? ''}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.ink, fontWeight: 500 }}>{currentUser?.name ?? ''}</div>
          <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft }}>การเงิน</div>
        </div>
      </div>
    </>
  );
}

// ── Middle list column ─────────────────────────────────────────────

interface BundleListColumnProps {
  theme: Theme;
  filter: FilterKey;
  list: BundleWithDetails[];
  selected: BundleWithDetails | undefined;
  totalPending: number;
  sumOfBundle: (b: BundleWithDetails) => number;
  onSelect: (id: string) => void;
}

function BundleListColumn({
  theme,
  filter,
  list,
  selected,
  totalPending,
  sumOfBundle,
  onSelect,
}: BundleListColumnProps): JSX.Element {
  const filterLabel: Record<FilterKey, string> = {
    pending: 'รออนุมัติ',
    approved: 'อนุมัติแล้ว',
    paid: 'จ่ายแล้ว',
    rejected: 'ปฏิเสธ',
  };

  return (
    <div
      style={{
        width: 360,
        borderRight: `0.5px solid ${theme.hairline}`,
        display: 'flex',
        flexDirection: 'column',
        background: theme.paper,
        flexShrink: 0,
      }}
    >
      <div style={{ padding: '20px 22px 14px', borderBottom: `0.5px solid ${theme.hairline}` }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 11,
            color: theme.inkSoft,
            letterSpacing: 1.4,
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          {filterLabel[filter]}
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginTop: 4 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 30,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -0.5,
            }}
          >
            {list.length}
          </div>
          {filter === 'pending' && (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>
              · {fmt(totalPending)} ค้าง
            </div>
          )}
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: '8px 0' }}>
        {list.length === 0 && (
          <EmptyState
            theme={theme}
            icon={Icon.receipt}
            title="ไม่มีรายการ"
            subtext="ไม่มีรายการในสถานะนี้"
          />
        )}
        {list.map((b) => {
          const sum = sumOfBundle(b);
          const isSelected = selected?.id === b.id;
          return (
            <BundleListRow
              key={b.id}
              theme={theme}
              bundle={b}
              sum={sum}
              isSelected={isSelected}
              onClick={() => onSelect(b.id)}
            />
          );
        })}
      </div>
    </div>
  );
}

interface BundleListRowProps {
  theme: Theme;
  bundle: BundleWithDetails;
  sum: number;
  isSelected: boolean;
  onClick: () => void;
}

function BundleListRow({ theme, bundle, sum, isSelected, onClick }: BundleListRowProps): JSX.Element {
  return (
    <div
      onClick={onClick}
      style={{
        padding: '12px 22px',
        cursor: 'pointer',
        background: isSelected ? theme.surface2 : 'transparent',
        borderLeft: `2px solid ${isSelected ? theme.accent : 'transparent'}`,
        transition: 'background 0.1s',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
        <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, fontWeight: 500 }}>
          {bundle.submitter.name}
        </div>
        <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter }}>
          {formatThaiDate(bundle.submittedAt)}
        </div>
      </div>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 14,
          fontWeight: 500,
          color: theme.ink,
          marginTop: 3,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {bundle.name}
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
        <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft }}>
          {bundle.receipts.length} ใบเสร็จ
        </span>
        <Money value={sum} theme={theme} size={14} weight={500} />
      </div>
    </div>
  );
}

// ── Detail pane ────────────────────────────────────────────────────

interface DesktopDetailProps {
  theme: Theme;
  bundle: BundleWithDetails;
  items: Receipt[];
  total: number;
  onApprove: () => void;
  onReject: () => void;
  onPay: () => void;
  onPhoto: (i: number) => void;
  submitting: boolean;
  actionError: string | null;
}

function DesktopDetail({
  theme,
  bundle,
  items,
  total,
  onApprove,
  onReject,
  onPay,
  onPhoto,
  submitting,
  actionError,
}: DesktopDetailProps): JSX.Element {
  const [whole, frac] = fmtN(total).split('.');
  const initials = bundle.submitter.name
    .split(' ')
    .map((s) => s[0] ?? '')
    .filter(Boolean)
    .slice(0, 2)
    .join('');

  return (
    <div style={{ maxWidth: DETAIL_MAX_WIDTH, margin: '0 auto', padding: '40px 48px 100px' }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 24,
          marginBottom: 28,
        }}
      >
        <div style={{ flex: 1 }}>
          <StatusPill status={bundle.status} theme={theme} />
          <h1
            style={{
              margin: '8px 0 6px',
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 36,
              lineHeight: 1.05,
              letterSpacing: -0.6,
              color: theme.ink,
            }}
          >
            {bundle.name}
          </h1>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.inkSoft,
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div
              style={{
                width: 22,
                height: 22,
                borderRadius: 11,
                background: theme.accent,
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontFamily: FONT_UI,
                fontSize: 9,
                fontWeight: 600,
              }}
            >
              {initials}
            </div>
            {bundle.submitter.name} · ส่งเมื่อ {formatThaiDate(bundle.submittedAt)}
          </div>
          {bundle.status === 'rejected' && bundle.rejectReason && (
            <div
              style={{
                marginTop: 10,
                padding: '8px 12px',
                borderRadius: 8,
                background: `${theme.danger}18`,
                borderLeft: `3px solid ${theme.danger}`,
                fontFamily: FONT_UI,
                fontSize: 13,
                color: theme.ink,
                lineHeight: 1.5,
              }}
            >
              <span style={{ fontWeight: 600, color: theme.danger, marginRight: 6 }}>เหตุผลที่ปฏิเสธ:</span>
              {bundle.rejectReason}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
            }}
          >
            ยอดรวม
          </div>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 44,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -1,
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 26, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
            {whole}
            <span style={{ opacity: 0.5 }}>.{frac}</span>
          </div>
        </div>
      </div>

      {bundle.note && (
        <div
          style={{
            padding: '12px 16px',
            background: theme.surface2,
            borderRadius: 10,
            marginBottom: 24,
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.ink,
            lineHeight: 1.5,
          }}
        >
          <span style={{ color: theme.inkSoft, fontWeight: 500, marginRight: 8 }}>หมายเหตุ:</span>
          {bundle.note}
        </div>
      )}

      {/* Photo gallery */}
      <div style={{ marginBottom: 30 }}>
        <SectionLabel theme={theme}>ใบเสร็จ · {items.length}</SectionLabel>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
            gap: 14,
          }}
        >
          {items.map((r, i) => (
            <div
              key={r.id}
              onClick={() => onPhoto(i)}
              style={{
                cursor: 'zoom-in',
                padding: 12,
                borderRadius: 12,
                background: theme.surface,
                border: `0.5px solid ${theme.hairline}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <ReceiptPhoto receipt={r} height={150} />
              </div>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  fontWeight: 500,
                  color: theme.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {r.merchant}
              </div>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 11,
                  color: theme.inkSoft,
                  marginTop: 2,
                  display: 'flex',
                  justifyContent: 'space-between',
                }}
              >
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.category}
                </span>
                <span style={{ fontFamily: FONT_MONO, color: theme.ink }}>฿{fmt0(r.amount)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Line items table */}
      <div style={{ marginBottom: 30 }}>
        <SectionLabel theme={theme}>รายละเอียด</SectionLabel>
        <Card theme={theme} padding={0}>
          <div
            style={{
              padding: '10px 18px',
              display: 'grid',
              gridTemplateColumns: TABLE_GRID_COLUMNS,
              gap: 16,
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 0.6,
              textTransform: 'uppercase',
              borderBottom: `0.5px solid ${theme.hairline}`,
              fontWeight: 500,
            }}
          >
            <span>ร้านค้า</span>
            <span>หมวดหมู่</span>
            <span>วันที่</span>
            <span style={{ textAlign: 'right' }}>จำนวน</span>
          </div>
          {items.map((r, i) => (
            <div
              key={r.id}
              style={{
                padding: '14px 18px',
                display: 'grid',
                gridTemplateColumns: TABLE_GRID_COLUMNS,
                gap: 16,
                alignItems: 'center',
                borderBottom: i < items.length - 1 ? `0.5px solid ${theme.hairline}` : 'none',
                fontFamily: FONT_UI,
                fontSize: 13,
                color: theme.ink,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <ReceiptThumb receipt={r} size={32} />
                <span style={{ fontWeight: 500 }}>{r.merchant}</span>
              </div>
              <span style={{ color: theme.inkSoft }}>{r.category}</span>
              <span style={{ color: theme.inkSoft, fontFamily: FONT_MONO, fontSize: 12 }}>
                {formatThaiDate(r.date)}
              </span>
              <span
                style={{
                  textAlign: 'right',
                  fontFamily: FONT_MONO,
                  fontVariantNumeric: 'tabular-nums',
                  fontWeight: 500,
                }}
              >
                ฿{fmtN(r.amount)}
              </span>
            </div>
          ))}
          <div
            style={{
              padding: '14px 18px',
              background: theme.surface2,
              display: 'grid',
              gridTemplateColumns: TABLE_GRID_COLUMNS,
              gap: 16,
              alignItems: 'center',
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.ink,
              fontWeight: 600,
              borderRadius: '0 0 18px 18px',
            }}
          >
            <span>รวม</span>
            <span />
            <span />
            <span
              style={{
                textAlign: 'right',
                fontFamily: FONT_MONO,
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              ฿{fmtN(total)}
            </span>
          </div>
        </Card>
      </div>

      {bundle.status === 'paid' && (
        <div style={{ marginBottom: 30 }}>
          <SectionLabel theme={theme}>หลักฐานการโอน</SectionLabel>
          <Card theme={theme} padding={20}>
            {bundle.transferProofPath && (
              <img
                src={bundle.transferProofPath}
                alt="หลักฐานการโอน"
                style={{
                  width: '100%',
                  borderRadius: 10,
                  marginBottom: 16,
                  display: 'block',
                }}
              />
            )}
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 18,
                  background: theme.success,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {Icon.check('#fff')}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
                  จ่ายแล้ว {formatThaiDate(bundle.paidAt)}
                </div>
                <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                  อ้างอิง · {bundle.transferRef}
                </div>
              </div>
              <Money value={bundle.transferAmount ?? total} theme={theme} size={18} accent weight={600} />
            </div>
          </Card>
        </div>
      )}

      {bundle.status === 'pending' && (
        <ActionBar theme={theme}>
          <GhostButton theme={theme} onClick={onReject}>
            ปฏิเสธ
          </GhostButton>
          <div style={{ flex: 1 }} />
          {actionError && (
            <span style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.danger }}>{actionError}</span>
          )}
          <div style={{ minWidth: 220 }}>
            <PrimaryButton theme={theme} onClick={onApprove} disabled={submitting}>
              {submitting ? 'กำลังดำเนินการ...' : `อนุมัติ · ${fmt(total)}`}
            </PrimaryButton>
          </div>
        </ActionBar>
      )}

      {bundle.status === 'approved' && (
        <ActionBar theme={theme}>
          <div style={{ flex: 1, fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
            อนุมัติเมื่อ {formatThaiDate(bundle.approvedAt)} โดย {bundle.approver?.name ?? ''} — รอโอนเงิน
          </div>
          <div style={{ minWidth: 240 }}>
            <PrimaryButton theme={theme} onClick={onPay}>
              บันทึกจ่าย & แนบสลิป
            </PrimaryButton>
          </div>
        </ActionBar>
      )}
    </div>
  );
}

// ── Small detail-pane subcomponents ────────────────────────────────

interface SectionLabelProps {
  theme: Theme;
  children: ReactNode;
}

function SectionLabel({ theme, children }: SectionLabelProps): JSX.Element {
  return (
    <div
      style={{
        fontFamily: FONT_UI,
        fontSize: 11,
        color: theme.inkSoft,
        letterSpacing: 1.4,
        textTransform: 'uppercase',
        fontWeight: 500,
        marginBottom: 12,
      }}
    >
      {children}
    </div>
  );
}

interface ActionBarProps {
  theme: Theme;
  children: ReactNode;
}

function ActionBar({ theme, children }: ActionBarProps): JSX.Element {
  const style: CSSProperties = {
    position: 'sticky',
    bottom: 0,
    background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
    paddingTop: 24,
    paddingBottom: 12,
    marginLeft: -48,
    marginRight: -48,
    paddingLeft: 48,
    paddingRight: 48,
    borderTop: `0.5px solid ${theme.hairline}`,
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  };
  return <div style={style}>{children}</div>;
}

// ── Photo lightbox ─────────────────────────────────────────────────

interface PhotoLightboxProps {
  theme: Theme;
  items: Receipt[];
  index: number;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}

function PhotoLightbox({ theme: _theme, items, index, onClose, onPrev, onNext }: PhotoLightboxProps): JSX.Element {
  const current = items[index];
  const [zoomed, setZoomed] = useState(false);
  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  // Reset zoom when slide changes
  useEffect(() => {
    setZoomed(false);
  }, [index]);

  // Keyboard navigation: Esc closes, ← / → navigates
  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowLeft' && hasPrev) onPrev();
      if (e.key === 'ArrowRight' && hasNext) onNext();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose, onPrev, onNext, hasPrev, hasNext]);

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,5,0.95)',
        zIndex: 200,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {/* Close button — top right */}
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        style={{
          position: 'absolute',
          top: 20,
          right: 20,
          width: 40,
          height: 40,
          borderRadius: 20,
          background: 'rgba(255,255,255,0.15)',
          border: 'none',
          color: '#fff',
          fontSize: 20,
          lineHeight: 1,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 10,
        }}
      >
        ×
      </button>

      {/* Prev button */}
      {hasPrev && (
        <button
          onClick={(e) => { e.stopPropagation(); onPrev(); }}
          style={navButtonStyle('left')}
        >
          ‹
        </button>
      )}

      {/* Image / no-photo area */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
          maxWidth: '90vw',
          maxHeight: '90vh',
        }}
      >
        {current ? (
          current.photoPath ? (
            <div
              onClick={() => setZoomed((z) => !z)}
              style={{
                cursor: zoomed ? 'zoom-out' : 'zoom-in',
                transition: 'transform 0.25s ease',
                transform: zoomed ? 'scale(2)' : 'scale(1)',
                transformOrigin: 'center center',
                maxWidth: '80vw',
                maxHeight: '80vh',
              }}
            >
              <img
                src={current.photoPath}
                alt={current.merchant}
                style={{
                  maxWidth: '80vw',
                  maxHeight: '80vh',
                  objectFit: 'contain',
                  borderRadius: 8,
                  display: 'block',
                  boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
                }}
              />
            </div>
          ) : (
            <div
              onClick={() => setZoomed((z) => !z)}
              style={{
                cursor: zoomed ? 'zoom-out' : 'zoom-in',
                transition: 'transform 0.25s ease',
                transform: zoomed ? 'scale(1.5)' : 'scale(1)',
                transformOrigin: 'center center',
              }}
            >
              <ReceiptPhoto receipt={current} height={460} />
            </div>
          )
        ) : (
          // No-photo fallback
          <div
            style={{
              width: 220,
              height: 300,
              borderRadius: 12,
              background: 'rgba(255,255,255,0.08)',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              color: 'rgba(255,255,255,0.5)',
            }}
          >
            <div style={{ fontSize: 40, opacity: 0.4 }}>🧾</div>
            <div style={{ fontFamily: FONT_UI, fontSize: 13, textAlign: 'center' }}>
              ไม่มีรูปใบเสร็จ
            </div>
          </div>
        )}

        {/* Counter + merchant label */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: 'rgba(255,255,255,0.7)',
          }}
        >
          <span style={{ fontFamily: FONT_MONO }}>
            {index + 1} / {items.length}
          </span>
          {current && (
            <>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{current.merchant}</span>
            </>
          )}
        </div>
      </div>

      {/* Next button */}
      {hasNext && (
        <button
          onClick={(e) => { e.stopPropagation(); onNext(); }}
          style={navButtonStyle('right')}
        >
          ›
        </button>
      )}
    </div>
  );
}

function navButtonStyle(side: 'left' | 'right'): CSSProperties {
  return {
    position: 'absolute',
    top: '50%',
    [side]: 20,
    transform: 'translateY(-50%)',
    width: 48,
    height: 48,
    borderRadius: 24,
    background: 'rgba(255,255,255,0.15)',
    border: 'none',
    color: '#fff',
    fontSize: 28,
    lineHeight: 1,
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  };
}

// ── Pay sheet ──────────────────────────────────────────────────────

interface PaySheetProps {
  theme: Theme;
  bundle: BundleWithDetails;
  total: number;
  transferRefInput: string;
  setTransferRefInput: (next: string) => void;
  proof: string | null;
  setProof: (next: string | null) => void;
  onClose: () => void;
  onConfirm: () => void;
  submitting: boolean;
  actionError: string | null;
}

function PaySheet({
  theme,
  bundle,
  total,
  transferRefInput,
  setTransferRefInput,
  proof,
  setProof,
  onClose,
  onConfirm,
  submitting,
  actionError,
}: PaySheetProps): JSX.Element {
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>): void => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setProof(typeof reader.result === 'string' ? reader.result : null);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(10,8,5,0.55)',
        backdropFilter: 'blur(6px)',
        zIndex: 40,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          background: theme.paper,
          borderRadius: 18,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          padding: 32,
          fontFamily: FONT_UI,
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: 20,
          }}
        >
          <div>
            <div
              style={{
                fontFamily: FONT_UI,
                fontSize: 11,
                color: theme.inkSoft,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
              }}
            >
              บันทึกการจ่าย
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                color: theme.ink,
                marginTop: 4,
                letterSpacing: -0.4,
              }}
            >
              โอนให้ {bundle.submitter.name}
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
            }}
          >
            ×
          </button>
        </div>

        <Card theme={theme} padding={16} style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div>
              <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft }}>ยอดที่ต้องโอน</div>
              <div
                style={{
                  marginTop: 2,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 28,
                  color: theme.ink,
                  lineHeight: 1,
                  letterSpacing: -0.5,
                }}
              >
                ฿{fmtN(total)}
              </div>
            </div>
          </div>
        </Card>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        <div
          onClick={() => fileInputRef.current?.click()}
          style={{
            height: 180,
            borderRadius: 12,
            marginBottom: 16,
            background: proof ? theme.surface2 : theme.surface,
            border: proof ? 'none' : `1.5px dashed ${theme.hairlineStrong}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            overflow: 'hidden',
            padding: 14,
          }}
        >
          {proof ? (
            <img
              src={proof}
              alt="สลิปโอน"
              style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: theme.inkSoft }}>
              <div style={{ marginBottom: 10 }}>{Icon.attach(theme.inkSoft)}</div>
              <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 500, color: theme.ink }}>
                แนบสลิปจากแอปธนาคาร
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 11, marginTop: 2 }}>คลิกเพื่อแนบไฟล์</div>
            </div>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              marginBottom: 6,
            }}
          >
            เลขอ้างอิง
          </div>
          <input
            value={transferRefInput}
            onChange={(e) => setTransferRefInput(e.target.value)}
            placeholder="SCB-887214-AB"
            style={{
              width: '100%',
              padding: '10px 14px',
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

        {actionError && (
          <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.danger, marginBottom: 10 }}>
            {actionError}
          </div>
        )}
        <div style={{ display: 'flex', gap: 10 }}>
          <GhostButton theme={theme} onClick={onClose}>
            ยกเลิก
          </GhostButton>
          <div style={{ flex: 1 }}>
            <PrimaryButton theme={theme} disabled={!proof || !transferRefInput.trim() || submitting} onClick={onConfirm}>
              {submitting ? 'กำลังบันทึก...' : `ยืนยันการจ่าย · ฿${fmtN(total)}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
