import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { AppState, BundleWithDetails, Receipt, Theme, User } from '../../lib/types';
import { fmt, fmt0, fmtN, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import { api, receiptFormFromFields } from '../../lib/api';
import { dataUrlToFile } from '../../lib/photoUpload';
import { AppSidebar } from '../../components/AppSidebar';
import type { SidebarCounts, SidebarKey } from '../../components/AppSidebar';
import { DesktopShell } from '../../components/DesktopShell';
import { Card, GhostButton, Money, PrimaryButton, StatusPill } from '../../components/primitives';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Icon } from '../../components/icons';
import { ReceiptPhoto, ReceiptThumb } from '../../components/Receipts';
import { EmptyState } from '../../components/EmptyState';
import { Toast, useToast } from '../../components/Toast';
import { MerchantAutocomplete } from './_shared';

// ── Constants for new (uploaded) receipts ────────────────────────────
const NEW_RECEIPT_COLOR = '#F5EBD9';
const NEW_RECEIPT_ACCENT = '#7E5E3A';
const NEW_RECEIPT_MERCHANT_FALLBACK = 'ใบเสร็จใหม่';
const DETAIL_MAX_WIDTH = 840;

function sanitizeAmountInput(raw: string): string {
  let v = raw.replace(/[^0-9.]/g, '');
  const dot = v.indexOf('.');
  if (dot !== -1) {
    v = v.slice(0, dot + 1) + v.slice(dot + 1).replace(/\./g, '').slice(0, 2);
  }
  return v;
}

// Pulled from `@reimbursement/shared` to stay in sync with the rest of the app.
import { useReceiptCategories } from '../../lib/useReceiptCategories';

type View = 'drafts' | 'bundle-detail' | 'bundle-list';
type BundleFilter = 'pending' | 'approved' | 'paid' | 'rejected';

interface DesktopEmployeeProps {
  theme: Theme;
  state: AppState;
  setState: (updater: (s: AppState) => AppState) => void;
  currentUser?: User | null;
  onBackToInbox?: () => void;
  onLogout?: () => void;
  /** Approvers see the approval box and พนักงาน in the shared sidebar; this
   *  carries those clicks back to the approver console. */
  onNavigateApprover?: (key: SidebarKey) => void;
  /** Open the share inbox (files sent in from a phone). Its own callback
   *  rather than a SidebarKey on onNavigateApprover, because a plain
   *  employee's shell is never given that prop. */
  onOpenShareInbox?: () => void;
  /** Which pane the click that brought us here actually meant. */
  initialView?: 'drafts' | 'pending' | 'approved' | 'paid' | 'rejected';
  /** Shared across every screen so the menu's numbers never change shape. */
  sidebarCounts?: SidebarCounts;
}

export function DesktopEmployee({ theme, state, setState, currentUser, onBackToInbox, onLogout, onNavigateApprover, onOpenShareInbox, initialView, sidebarCounts }: DesktopEmployeeProps): JSX.Element {
  // onBackToInbox is only supplied for approvers, so it doubles as the role flag.
  const isApprover = onBackToInbox !== undefined;
  const [view, setView] = useState<View>(
    initialView && initialView !== 'drafts' ? 'bundle-list' : 'drafts',
  );
  const [listFilter, setListFilter] = useState<BundleFilter>(
    initialView && initialView !== 'drafts' ? initialView : 'pending',
  );
  const [detailOrigin, setDetailOrigin] = useState<Exclude<View, 'bundle-detail'>>('drafts');
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bundleName, setBundleName] = useState<string>('');
  // Required-title violation — set on a submit attempt, cleared by typing.
  const [titleError, setTitleError] = useState(false);
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState<boolean>(false);
  const [editTarget, setEditTarget] = useState<Receipt | null>(null);
  const [savingReceipt, setSavingReceipt] = useState<boolean>(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleteInProgress, setDeleteInProgress] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { toast: submitToast, showToast: showSubmitToast } = useToast();
  const { toast: createToast, showToast: showCreateToast } = useToast();

  const { receipts, bundles } = state;
  const looseReceipts = receipts.filter((r) => r.bundleId === null);

  const selectedReceipts = looseReceipts.filter((r) => selected.has(r.id));
  const selectedTotal = selectedReceipts.reduce((sum, r) => sum + r.amount, 0);

  const totalsByStatus = {
    pending: bundles.filter((b) => b.status === 'pending').length,
    // 'paying' folds into 'approved' here — it's the same "not yet received"
    // bucket from the employee's side, and there is no separate my-paying tab.
    approved: bundles.filter((b) => b.status === 'approved' || b.status === 'paying').length,
    paid: bundles.filter((b) => b.status === 'paid').length,
    rejected: bundles.filter((b) => b.status === 'rejected').length,
  };

  const owed = bundles
    .filter((b) => b.status === 'pending' || b.status === 'approved' || b.status === 'paying')
    .reduce((sum, b) => sum + b.receipts.reduce((acc, r) => acc + r.amount, 0), 0);

  /** Select every loose receipt, or clear the selection when all are already on. */
  const allDraftsSelected =
    looseReceipts.length > 0 && looseReceipts.every((r) => selected.has(r.id));

  const toggleSelectAll = (): void => {
    setSelected(allDraftsSelected ? new Set() : new Set(looseReceipts.map((r) => r.id)));
  };

  const toggleReceipt = (id: string): void => {
    const next = new Set(selected);
    if (next.has(id)) {
      next.delete(id);
    } else {
      next.add(id);
    }
    setSelected(next);
  };

  const goToDrafts = (): void => {
    setView('drafts');
    setSelectedBundleId(null);
  };

  const openBundleList = (filter: BundleFilter): void => {
    setListFilter(filter);
    setView('bundle-list');
    setSelectedBundleId(null);
  };

  const openBundle = (id: string): void => {
    setDetailOrigin(view === 'bundle-list' ? 'bundle-list' : 'drafts');
    setSelectedBundleId(id);
    setView('bundle-detail');
  };

  const backFromDetail = (): void => {
    if (detailOrigin === 'bundle-list') {
      setView('bundle-list');
      setSelectedBundleId(null);
    } else {
      goToDrafts();
    }
  };

  const submitBundle = async (): Promise<void> => {
    if (submitting) return;
    if (!bundleName.trim()) {
      setTitleError(true);
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const created = await api.bundles.create({
        name: bundleName.trim(),
        receiptIds: [...selected],
      });
      setState((s) => ({
        ...s,
        bundles: [...s.bundles, created],
        receipts: s.receipts.map((r) =>
          created.receipts.some((cr) => cr.id === r.id) ? { ...r, bundleId: created.id } : r,
        ),
      }));
      setSelected(new Set());
      setBundleName('');
      showSubmitToast('ส่งขออนุมัติเรียบร้อย');
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSaveReceipt = async (input: NewReceiptInput): Promise<void> => {
    if (savingReceipt) return;
    setCreateError(null);
    setSavingReceipt(true);
    try {
      // `photo` is a data URL only when the user picked a (new) file.
      const photoFile = input.photo ? await dataUrlToFile(input.photo, 'receipt.jpg') : undefined;
      const form = receiptFormFromFields(
        {
          merchant: input.merchant.trim() || NEW_RECEIPT_MERCHANT_FALLBACK,
          category: input.category,
          property: input.property,
          quantity: input.quantity,
          amount: input.amount,
          date: input.date,
          note: input.note.trim() ? input.note.trim() : '',
          color: editTarget?.color ?? NEW_RECEIPT_COLOR,
          accent: editTarget?.accent ?? NEW_RECEIPT_ACCENT,
          items: editTarget?.items ?? [],
          tax: editTarget?.tax ?? '0',
        },
        photoFile,
      );
      if (editTarget) {
        const updated = await api.receipts.update(editTarget.id, form);
        setState((s) => ({
          ...s,
          receipts: s.receipts.map((r) => (r.id === updated.id ? updated : r)),
        }));
        showCreateToast('แก้ไขใบเสร็จแล้ว');
      } else {
        const created = await api.receipts.create(form);
        setState((s) => ({ ...s, receipts: [created, ...s.receipts] }));
        showCreateToast('บันทึกใบเสร็จแล้ว');
      }
      setCreateOpen(false);
      setEditTarget(null);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSavingReceipt(false);
    }
  };

  const openCreateModal = (): void => {
    setEditTarget(null);
    setCreateOpen(true);
  };
  const openEditModal = (receipt: Receipt): void => {
    setEditTarget(receipt);
    setCreateOpen(true);
  };
  const closeCreateModal = (): void => {
    if (savingReceipt) return;
    setCreateOpen(false);
    setEditTarget(null);
  };

  const openDeleteDialog = (id: string): void => {
    setDeleteError(null);
    setDeleteTargetId(id);
  };
  const closeDeleteDialog = (): void => {
    if (!deleteInProgress) setDeleteTargetId(null);
  };
  const confirmDeleteReceipt = async (): Promise<void> => {
    if (!deleteTargetId) return;
    setDeleteInProgress(true);
    setDeleteError(null);
    try {
      await api.receipts.delete(deleteTargetId);
      setState((s) => ({ ...s, receipts: s.receipts.filter((r) => r.id !== deleteTargetId) }));
      setSelected((prev) => { const next = new Set(prev); next.delete(deleteTargetId); return next; });
      setDeleteTargetId(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setDeleteInProgress(false);
    }
  };

  const selectedBundle = bundles.find((b) => b.id === selectedBundleId) ?? null;

  // ── Sidebar ─────────────────────────────────────────────────────────
  // The same menu every other desktop screen renders. This screen used to
  // build its own, which is why opening "คำขอของฉัน" replaced the whole menu.
  const sidebar = (
    <AppSidebar
      theme={theme}
      currentUser={currentUser ?? null}
      isApprover={isApprover}
      active={view === 'drafts' ? 'my-drafts' : (`my-${listFilter}` as SidebarKey)}
      counts={sidebarCounts}
      onSelect={(key) => {
        // Before the `my-` branch on purpose — see the SidebarKey comment. It
        // also needs its own callback rather than falling through to
        // onNavigateApprover, which a plain employee's shell never receives.
        if (key === 'share-inbox') return onOpenShareInbox?.();
        if (key === 'my-drafts') return goToDrafts();
        if (key.startsWith('my-')) return openBundleList(key.slice(3) as BundleFilter);
        // Everything else lives on the approver console.
        onNavigateApprover?.(key);
      }}
      onLogout={onLogout}
    />
  );

  // ── Main pane ───────────────────────────────────────────────────────
  const mainContent =
    view === 'bundle-detail' && selectedBundle ? (
      <BundleDetailPane
        theme={theme}
        bundle={selectedBundle}
        onBack={backFromDetail}
        backLabel={detailOrigin === 'bundle-list' ? '← รายการคำขอ' : '← รายการใหม่'}
      />
    ) : view === 'bundle-list' ? (
      <BundleListPane
        theme={theme}
        filter={listFilter}
        // Same fold as totalsByStatus above — an in-flight KBIZ transfer shows
        // up on "อนุมัติแล้ว" rather than vanishing from every tab.
        bundles={bundles.filter(
          (b) => b.status === listFilter || (listFilter === 'approved' && b.status === 'paying'),
        )}
        onOpenBundle={openBundle}
      />
    ) : (
      <DraftsPane
        theme={theme}
        looseReceipts={looseReceipts}
        onToggleSelectAll={toggleSelectAll}
        allSelected={allDraftsSelected}
        selected={selected}
        selectedReceipts={selectedReceipts}
        selectedTotal={selectedTotal}
        bundleName={bundleName}
        onBundleNameChange={(next) => {
          setBundleName(next);
          if (titleError && next.trim()) setTitleError(false);
        }}
        titleError={titleError}
        owed={owed}
        outstandingCount={totalsByStatus.pending + totalsByStatus.approved}
        submitting={submitting}
        photoIdx={photoIdx}
        onPhotoIdxChange={setPhotoIdx}
        onToggleReceipt={toggleReceipt}
        onSubmitBundle={submitBundle}
        onCameraClick={openCreateModal}
        onDeleteReceipt={openDeleteDialog}
        onEditReceipt={openEditModal}
      />
    );

  return (
    <DesktopShell theme={theme} sidebar={sidebar}>
      <div style={{ height: '100%' }}>{mainContent}</div>
      {(submitError || createError) && (
        <div
          onClick={() => {
            setSubmitError(null);
            setCreateError(null);
          }}
          style={{
            position: 'fixed',
            top: 16,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 200,
            background: theme.danger,
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 10,
            fontFamily: FONT_UI,
            fontSize: 13,
            cursor: 'pointer',
            boxShadow: '0 6px 20px rgba(0,0,0,0.2)',
          }}
        >
          {submitError || createError}
        </div>
      )}
      <Toast toast={submitToast} theme={theme} />
      <Toast toast={createToast} theme={theme} />
      {createOpen && (
        <CreateReceiptModal
          theme={theme}
          initial={editTarget}
          saving={savingReceipt}
          onClose={closeCreateModal}
          onSave={handleSaveReceipt}
        />
      )}
      {deleteTargetId !== null && (
        <ConfirmDialog
          theme={theme}
          title="ลบรายการนี้?"
          message={deleteError ?? 'ใบเสร็จนี้จะถูกลบถาวรและไม่สามารถกู้คืนได้'}
          confirmLabel="ลบ"
          danger
          loading={deleteInProgress}
          onConfirm={confirmDeleteReceipt}
          onCancel={closeDeleteDialog}
        />
      )}
    </DesktopShell>
  );
}


// ── Drafts pane (middle gallery + right composer + lightbox) ──────────
interface DraftsPaneProps {
  theme: Theme;
  looseReceipts: Receipt[];
  selected: Set<string>;
  selectedReceipts: Receipt[];
  selectedTotal: number;
  bundleName: string;
  onBundleNameChange: (next: string) => void;
  titleError: boolean;
  owed: number;
  outstandingCount: number;
  submitting: boolean;
  photoIdx: number | null;
  onPhotoIdxChange: (next: number | null) => void;
  onToggleReceipt: (id: string) => void;
  onToggleSelectAll: () => void;
  allSelected: boolean;
  onSubmitBundle: () => void;
  onCameraClick: () => void;
  onDeleteReceipt: (id: string) => void;
  onEditReceipt: (receipt: Receipt) => void;
}

function DraftsPane({
  theme,
  looseReceipts,
  selected,
  selectedReceipts,
  selectedTotal,
  bundleName,
  onBundleNameChange,
  titleError,
  owed,
  outstandingCount,
  submitting,
  photoIdx,
  onPhotoIdxChange,
  onToggleReceipt,
  onToggleSelectAll,
  allSelected,
  onSubmitBundle,
  onCameraClick,
  onDeleteReceipt,
  onEditReceipt,
}: DraftsPaneProps) {
  const lightboxReceipt = photoIdx !== null ? looseReceipts[photoIdx] : null;

  return (
    <div style={{ display: 'flex', height: '100%', background: theme.paper }}>
      {/* MIDDLE — receipts gallery */}
      <div style={{ flex: 1, overflow: 'auto', padding: '40px 40px 56px' }}>
        <div style={{ maxWidth: 1040, margin: '0 auto' }}>
        {owed > 0 && <OwedBanner theme={theme} owed={owed} outstandingCount={outstandingCount} />}

        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            justifyContent: 'space-between',
            marginBottom: 18,
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
                fontWeight: 500,
              }}
            >
              ใบเสร็จที่ยังไม่ได้ส่ง
            </div>
            <h1
              style={{
                margin: '4px 0 0',
                fontFamily: FONT_DISPLAY,
                fontWeight: 400,
                fontSize: 32,
                lineHeight: 1.1,
                letterSpacing: -0.5,
                color: theme.ink,
              }}
            >
              รายการใหม่ · {looseReceipts.length}
            </h1>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Bundling a month of receipts one tick at a time is the slowest part
              of submitting; the common case is "all of them". */}
          {looseReceipts.length > 0 && (
            <button
              onClick={onToggleSelectAll}
              style={{
                padding: '10px 16px',
                borderRadius: 100,
                background: 'transparent',
                border: `0.5px solid ${theme.hairlineStrong}`,
                fontFamily: FONT_UI,
                fontSize: 13,
                color: theme.ink,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                whiteSpace: 'nowrap',
              }}
            >
              {allSelected ? Icon.close(theme.ink) : Icon.check(theme.ink)}
              {allSelected ? 'ล้างที่เลือก' : `เลือกทั้งหมด · ${looseReceipts.length}`}
            </button>
          )}
          <button
            onClick={onCameraClick}
            style={{
              padding: '10px 16px',
              borderRadius: 100,
              background: theme.surface2,
              border: `0.5px solid ${theme.hairlineStrong}`,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.ink,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            {Icon.camera(theme.ink)} ถ่ายใบเสร็จ
          </button>
          </div>
        </div>

        {looseReceipts.length === 0 ? (
          <div style={{ minHeight: 320 }}>
            <EmptyState
              theme={theme}
              icon={Icon.camera}
              title="ยังไม่มีใบเสร็จที่รอส่ง"
              subtext="กดปุ่มถ่ายใบเสร็จเพื่อเริ่มเพิ่มค่าใช้จ่าย"
            />
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 16,
            }}
          >
            {looseReceipts.map((receipt, idx) => (
              <ReceiptCard
                key={receipt.id}
                theme={theme}
                receipt={receipt}
                isSelected={selected.has(receipt.id)}
                onToggle={() => onToggleReceipt(receipt.id)}
                onOpenPhoto={() => onPhotoIdxChange(idx)}
                onDelete={() => onDeleteReceipt(receipt.id)}
                onEdit={() => onEditReceipt(receipt)}
              />
            ))}
          </div>
        )}
        </div>
      </div>

      {/* RIGHT — selection / bundle composer */}
      <BundleComposer
        theme={theme}
        selectedCount={selected.size}
        selectedReceipts={selectedReceipts}
        selectedTotal={selectedTotal}
        bundleName={bundleName}
        onBundleNameChange={onBundleNameChange}
        titleError={titleError}
        submitting={submitting}
        onSubmit={onSubmitBundle}
        onRemoveReceipt={onToggleReceipt}
      />

      {lightboxReceipt && (
        <PhotoLightbox
          theme={theme}
          receipt={lightboxReceipt}
          onClose={() => onPhotoIdxChange(null)}
        />
      )}
    </div>
  );
}

// ── Bundle list pane (per-status request list) ───────────────────────
const BUNDLE_FILTER_LABELS: Record<BundleFilter, string> = {
  pending: 'รออนุมัติ',
  approved: 'อนุมัติแล้ว',
  paid: 'จ่ายแล้ว',
  rejected: 'ปฏิเสธ',
};

interface BundleListPaneProps {
  theme: Theme;
  filter: BundleFilter;
  bundles: BundleWithDetails[];
  onOpenBundle: (id: string) => void;
}

function BundleListPane({ theme, filter, bundles, onOpenBundle }: BundleListPaneProps) {
  return (
    <div style={{ height: '100%', overflow: 'auto', background: theme.paper }}>
      <div style={{ maxWidth: 760, margin: '0 auto', padding: '40px 48px 56px' }}>
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
          คำขอของฉัน
        </div>
        <h1
          style={{
            margin: '4px 0 24px',
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.1,
            letterSpacing: -0.5,
            color: theme.ink,
          }}
        >
          {BUNDLE_FILTER_LABELS[filter]} · {bundles.length}
        </h1>

        {bundles.length === 0 ? (
          <div style={{ minHeight: 280 }}>
            <EmptyState
              theme={theme}
              icon={Icon.bundle}
              title="ไม่มีรายการ"
              subtext="ไม่มีคำขอในสถานะนี้"
            />
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {bundles.map((b) => {
              const sum = b.receipts.reduce((acc, r) => acc + r.amount, 0);
              return (
                <Card key={b.id} theme={theme} padding={18} onClick={() => onOpenBundle(b.id)}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
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
                        {b.name}
                      </div>
                      <div
                        style={{
                          marginTop: 4,
                          fontFamily: FONT_UI,
                          fontSize: 12,
                          color: theme.inkSoft,
                          display: 'flex',
                          gap: 10,
                          alignItems: 'center',
                        }}
                      >
                        <StatusPill status={b.status} theme={theme} size="sm" />
                        <span>
                          {b.receipts.length} ใบเสร็จ · ส่งเมื่อ {formatThaiDate(b.submittedAt)}
                        </span>
                      </div>
                      {b.status === 'rejected' && b.rejectReason && (
                        <div
                          style={{
                            marginTop: 6,
                            fontFamily: FONT_UI,
                            fontSize: 12,
                            color: theme.danger,
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          เหตุผล: {b.rejectReason}
                        </div>
                      )}
                    </div>
                    <Money value={b.transferAmount ?? sum} theme={theme} size={18} weight={500} />
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Owed banner ───────────────────────────────────────────────────────
interface OwedBannerProps {
  theme: Theme;
  owed: number;
  outstandingCount: number;
}

function OwedBanner({ theme, owed, outstandingCount }: OwedBannerProps) {
  return (
    <div
      style={{
        padding: '14px 18px',
        borderRadius: 12,
        background: theme.surface2,
        marginBottom: 28,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        border: `0.5px solid ${theme.hairline}`,
      }}
    >
      <div
        style={{
          width: 40,
          height: 40,
          borderRadius: 20,
          background: theme.ink,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: theme.paper,
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
        }}
      >
        ฿
      </div>
      <div style={{ flex: 1 }}>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 11,
            color: theme.inkSoft,
            letterSpacing: 1.2,
            textTransform: 'uppercase',
            fontWeight: 500,
          }}
        >
          รอรับเงิน
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 24,
            color: theme.ink,
            lineHeight: 1.1,
            letterSpacing: -0.3,
          }}
        >
          ฿
          {owed.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </div>
      </div>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>
        {outstandingCount} คำขอที่ยังไม่ได้รับ
      </div>
    </div>
  );
}

// ── Receipt card ──────────────────────────────────────────────────────
interface ReceiptCardProps {
  theme: Theme;
  receipt: Receipt;
  isSelected: boolean;
  onToggle: () => void;
  onOpenPhoto: () => void;
  onDelete: () => void;
  onEdit: () => void;
}

function ReceiptCard({ theme, receipt, isSelected, onToggle, onOpenPhoto, onDelete, onEdit }: ReceiptCardProps) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={onToggle}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        padding: 14,
        borderRadius: 14,
        background: theme.surface,
        border: `1.5px solid ${isSelected ? theme.accent : theme.hairline}`,
        cursor: 'pointer',
        transition: 'border-color 0.15s, transform 0.15s',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 10,
          right: 10,
          width: 22,
          height: 22,
          borderRadius: 11,
          background: isSelected ? theme.accent : 'rgba(255,255,255,0.9)',
          border: `1.5px solid ${isSelected ? theme.accent : theme.hairlineStrong}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 2,
        }}
      >
        {isSelected && Icon.check('#fff')}
      </div>
      {hovered && (
        <>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(); }}
            title="ลบรายการใหม่"
            style={{
              position: 'absolute',
              top: 10,
              left: 10,
              width: 26,
              height: 26,
              borderRadius: 13,
              background: theme.danger,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              padding: 0,
            }}
          >
            <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
              <path d="M5 6h10M8 6V4h4v2M9 9v6M11 9v6M6 6l1 10h6l1-10" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(); }}
            title="แก้ไขใบเสร็จ"
            style={{
              position: 'absolute',
              top: 10,
              left: 42,
              width: 26,
              height: 26,
              borderRadius: 13,
              background: theme.ink,
              border: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              zIndex: 2,
              padding: 0,
            }}
          >
            <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
              <path d="M4 13.5V16h2.5l8-8L12 5.5l-8 8zM13.5 4l2.5 2.5" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </>
      )}
      <div
        onClick={(e) => {
          e.stopPropagation();
          onOpenPhoto();
        }}
        style={{
          display: 'flex',
          justifyContent: 'center',
          marginBottom: 12,
          cursor: 'zoom-in',
        }}
      >
        <ReceiptPhoto receipt={receipt} height={170} />
      </div>
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
        {receipt.merchant}
      </div>
      <div
        style={{
          fontFamily: FONT_UI,
          fontSize: 11,
          color: theme.inkSoft,
          marginTop: 3,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            flex: 1,
            marginRight: 8,
          }}
        >
          {formatThaiDate(receipt.date)}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 13, fontWeight: 500, color: theme.ink }}>
          ฿{fmt0(receipt.amount)}
        </span>
      </div>
    </div>
  );
}

// ── Right rail bundle composer ────────────────────────────────────────
interface BundleComposerProps {
  theme: Theme;
  selectedCount: number;
  selectedReceipts: Receipt[];
  selectedTotal: number;
  bundleName: string;
  onBundleNameChange: (next: string) => void;
  titleError: boolean;
  submitting: boolean;
  onSubmit: () => void;
  onRemoveReceipt: (id: string) => void;
}

function BundleComposer({
  theme,
  selectedCount,
  selectedReceipts,
  selectedTotal,
  bundleName,
  onBundleNameChange,
  titleError,
  submitting,
  onSubmit,
  onRemoveReceipt,
}: BundleComposerProps) {
  const sectionLabelStyle: CSSProperties = {
    fontFamily: FONT_UI,
    fontSize: 11,
    color: theme.inkSoft,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    marginBottom: 6,
    fontWeight: 500,
  };

  return (
    <div
      style={{
        width: 340,
        flexShrink: 0,
        borderLeft: `0.5px solid ${theme.hairline}`,
        display: 'flex',
        flexDirection: 'column',
        background: theme.surface2,
      }}
    >
      <div style={{ padding: '24px 22px 16px' }}>
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
          คำขอใหม่
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 4 }}>
          <div
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 26,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -0.4,
            }}
          >
            {selectedCount}
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>
            {selectedCount === 0 ? 'เลือกใบเสร็จ' : 'ใบเสร็จ'}
          </div>
        </div>
      </div>

      {selectedCount === 0 ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 28px',
            textAlign: 'center',
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.inkSoft,
            lineHeight: 1.5,
          }}
        >
          คลิกใบเสร็จด้านซ้ายเพื่อรวมเป็นคำขออนุมัติ
        </div>
      ) : (
        <>
          <div style={{ flex: 1, overflow: 'auto', padding: '0 22px' }}>
            <div style={{ marginBottom: 16 }}>
              <div style={{ ...sectionLabelStyle, color: titleError ? theme.danger : sectionLabelStyle.color }}>
                ชื่อคำขอ *
              </div>
              <input
                value={bundleName}
                onChange={(e) => onBundleNameChange(e.target.value)}
                placeholder="เช่น ค่าอุปกรณ์ซ่อมแอร์"
                style={{
                  width: '100%',
                  padding: '10px 12px',
                  borderRadius: 10,
                  background: theme.paper,
                  border: titleError ? `1.5px solid ${theme.danger}` : `0.5px solid ${theme.hairlineStrong}`,
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  color: theme.ink,
                  outline: 'none',
                  boxSizing: 'border-box',
                  fontWeight: 500,
                }}
              />
              <div
                style={{
                  marginTop: 6,
                  fontFamily: FONT_UI,
                  fontSize: 11,
                  fontWeight: titleError ? 600 : 400,
                  color: titleError ? theme.danger : theme.inkSofter,
                }}
              >
                {titleError
                  ? 'กรุณาตั้งชื่อคำขอก่อนส่ง'
                  : 'ตั้งชื่อให้สื่อความหมาย — ชื่อนี้จะไปอยู่ในสลิปโอนเงินด้วย'}
              </div>
            </div>

            <div style={{ marginBottom: 16 }}>
              <div style={{ ...sectionLabelStyle, marginBottom: 8 }}>รายการ</div>
              {selectedReceipts.map((receipt, i) => (
                <div
                  key={receipt.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 0',
                    borderBottom:
                      i < selectedReceipts.length - 1
                        ? `0.5px solid ${theme.hairline}`
                        : 'none',
                  }}
                >
                  <ReceiptThumb receipt={receipt} size={32} />
                  <div style={{ flex: 1, minWidth: 0 }}>
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
                      {receipt.merchant}
                    </div>
                    <div style={{ fontFamily: FONT_UI, fontSize: 10, color: theme.inkSoft }}>
                      {receipt.category}
                    </div>
                  </div>
                  <div
                    style={{
                      fontFamily: FONT_MONO,
                      fontSize: 12,
                      fontWeight: 500,
                      color: theme.ink,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    ฿{fmt0(receipt.amount)}
                  </div>
                  <button
                    onClick={() => onRemoveReceipt(receipt.id)}
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: 11,
                      border: 'none',
                      background: 'transparent',
                      color: theme.inkSofter,
                      cursor: 'pointer',
                      fontSize: 16,
                      padding: 0,
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              padding: '18px 22px',
              borderTop: `0.5px solid ${theme.hairline}`,
              background: theme.paper,
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'baseline',
                marginBottom: 14,
              }}
            >
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
                ยอดรวม
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 26,
                  color: theme.ink,
                  letterSpacing: -0.4,
                  lineHeight: 1,
                }}
              >
                ฿
                {selectedTotal.toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}
              </div>
            </div>
            <PrimaryButton theme={theme} disabled={submitting} onClick={onSubmit}>
              {submitting ? 'กำลังส่ง...' : `ส่งขออนุมัติ · ${selectedCount} ใบ`}
            </PrimaryButton>
          </div>
        </>
      )}
    </div>
  );
}

// ── Photo lightbox ────────────────────────────────────────────────────
interface PhotoLightboxProps {
  theme: Theme;
  receipt: Receipt;
  onClose: () => void;
}

function PhotoLightbox({ receipt, onClose }: PhotoLightboxProps) {
  return (
    <div
      onClick={onClose}
      style={{
        position: 'absolute',
        inset: 0,
        background: 'rgba(10,8,5,0.95)',
        zIndex: 50,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 18,
        }}
      >
        {receipt.photoPath ? (
          <img
            src={receipt.photoPath}
            alt={receipt.merchant}
            style={{
              maxWidth: '80vw',
              maxHeight: '78vh',
              objectFit: 'contain',
              borderRadius: 8,
              display: 'block',
              boxShadow: '0 8px 40px rgba(0,0,0,0.6)',
            }}
            draggable={false}
          />
        ) : (
          <ReceiptPhoto receipt={receipt} height={460} />
        )}
        <button
          onClick={onClose}
          style={{
            padding: '8px 14px',
            borderRadius: 100,
            background: 'rgba(255,255,255,0.12)',
            border: 'none',
            color: '#fff',
            fontFamily: FONT_UI,
            fontSize: 12,
            cursor: 'pointer',
          }}
        >
          ปิด
        </button>
      </div>
    </div>
  );
}

// ── Bundle detail pane ────────────────────────────────────────────────
interface BundleDetailPaneProps {
  theme: Theme;
  bundle: BundleWithDetails;
  onBack: () => void;
  backLabel?: string;
}

function BundleDetailPane({ theme, bundle, onBack, backLabel = '← รายการใหม่' }: BundleDetailPaneProps) {
  const items: Receipt[] = bundle.receipts;
  const total = items.reduce((sum, r) => sum + r.amount, 0);
  const [totalWhole, totalFrac] = fmtN(total).split('.');

  return (
    <div
      style={{
        maxWidth: DETAIL_MAX_WIDTH,
        margin: '0 auto',
        padding: '40px 48px 56px',
        overflow: 'auto',
        height: '100%',
        background: theme.paper,
        boxSizing: 'border-box',
      }}
    >
      <button
        onClick={onBack}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          fontFamily: FONT_UI,
          fontSize: 13,
          color: theme.inkSoft,
          padding: 0,
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {backLabel}
      </button>

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
          <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
            ส่งเมื่อ {formatThaiDate(bundle.submittedAt)} · {items.length} ใบเสร็จ
          </div>
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
              fontSize: 40,
              color: theme.ink,
              lineHeight: 1,
              letterSpacing: -0.8,
              marginTop: 4,
            }}
          >
            <span style={{ fontSize: 22, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
            {totalWhole}
            <span style={{ opacity: 0.5 }}>.{totalFrac}</span>
          </div>
        </div>
      </div>

      <Card theme={theme} padding={18} style={{ marginBottom: 28 }}>
        <BundleStatusBlock theme={theme} bundle={bundle} total={total} />
      </Card>

      {bundle.status === 'paid' && bundle.transferProofPath && (
        <div style={{ marginBottom: 28 }}>
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
            หลักฐานการโอน
          </div>
          <Card theme={theme} padding={16}>
            <img
              src={bundle.transferProofPath}
              alt="หลักฐานการโอน"
              style={{ width: '100%', borderRadius: 10, display: 'block' }}
            />
          </Card>
        </div>
      )}

      <div style={{ marginBottom: 28 }}>
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
          ใบเสร็จ
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
            gap: 14,
          }}
        >
          {items.map((receipt) => (
            <div
              key={receipt.id}
              style={{
                padding: 14,
                borderRadius: 12,
                background: theme.surface,
                border: `0.5px solid ${theme.hairline}`,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 10 }}>
                <ReceiptPhoto receipt={receipt} height={170} />
              </div>
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
                {receipt.merchant}
              </div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  marginTop: 3,
                  fontFamily: FONT_UI,
                  fontSize: 11,
                  color: theme.inkSoft,
                }}
              >
                <span>{formatThaiDate(receipt.date)}</span>
                <span style={{ fontFamily: FONT_MONO, color: theme.ink, fontWeight: 500 }}>
                  ฿{fmt0(receipt.amount)}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Bundle status block (inside the Card on bundle-detail) ────────────
interface BundleStatusBlockProps {
  theme: Theme;
  bundle: BundleWithDetails;
  total: number;
}

function BundleStatusBlock({ theme, bundle, total }: BundleStatusBlockProps) {
  if (bundle.status === 'pending') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: theme.warn,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontFamily: FONT_DISPLAY,
            fontSize: 16,
          }}
        >
          ⋯
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
            รออนุมัติจากการเงิน
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
            จะแจ้งเตือนเมื่อมีอัปเดต
          </div>
        </div>
      </div>
    );
  }

  if (bundle.status === 'approved') {
    return (
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
            อนุมัติแล้ว · รอโอนเงิน
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
            {bundle.approver?.name ?? ''} อนุมัติเมื่อ {formatThaiDate(bundle.approvedAt)}
          </div>
        </div>
      </div>
    );
  }

  if (bundle.status === 'paying') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: theme.statusPaying,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {Icon.bank('#fff')}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
            กำลังโอนผ่าน KBIZ
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
            {/* paymentError is whatever the bot/bank wrote back (often English,
                technical) — fine for the approver console, not for an employee
                who can't act on it. Keep the raw text off this screen. */}
            {bundle.paymentError
              ? 'ผู้อนุมัติกำลังตรวจสอบการโอน'
              : 'รอยืนยันการโอนบนมือถือของผู้อนุมัติ'}
          </div>
        </div>
      </div>
    );
  }

  if (bundle.status === 'paid') {
    return (
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
    );
  }

  if (bundle.status === 'rejected') {
    return (
      <div
        style={{
          padding: '14px 16px',
          borderRadius: 10,
          background: `${theme.danger}14`,
          border: `1px solid ${theme.danger}40`,
          display: 'flex',
          gap: 12,
          alignItems: 'flex-start',
        }}
      >
        <div
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: theme.danger,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
            fontFamily: FONT_UI,
            fontSize: 18,
            fontWeight: 700,
          }}
        >
          !
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.danger }}>
            ถูกปฏิเสธ
          </div>
          {bundle.rejectReason ? (
            <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.ink, marginTop: 4, lineHeight: 1.5 }}>
              เหตุผลที่ปฏิเสธ: {bundle.rejectReason}
            </div>
          ) : (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
              ไม่มีหมายเหตุเพิ่มเติม
            </div>
          )}
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 6, lineHeight: 1.5 }}>
            ใบเสร็จถูกส่งกลับไปยังรายการใหม่แล้ว — แก้ไขและส่งใหม่ได้จากหน้ารายการใหม่
          </div>
        </div>
      </div>
    );
  }

  return null;
}

// ── Create / edit receipt modal ──────────────────────────────────────
interface NewReceiptInput {
  /** Data URL of a newly picked photo; null when unchanged (edit) or absent. */
  photo: string | null;
  amount: number;
  merchant: string;
  category: string;
  property: 'hf-hotel' | 'hf-ville';
  quantity: number | null;
  note: string;
  date: string;
}

interface CreateReceiptModalProps {
  theme: Theme;
  /** When set, the modal edits this receipt instead of creating a new one. */
  initial?: Receipt | null;
  saving?: boolean;
  onClose: () => void;
  onSave: (input: NewReceiptInput) => void;
}

function CreateReceiptModal({ theme, initial, saving, onClose, onSave }: CreateReceiptModalProps): JSX.Element {
  const modalToday = new Date().toISOString().slice(0, 10);
  const [photo, setPhoto] = useState<string | null>(null);
  const [amount, setAmount] = useState<string>(initial ? String(initial.amount) : '');
  const [merchant, setMerchant] = useState<string>(initial?.merchant ?? '');
  const categories = useReceiptCategories();
  const [category, setCategory] = useState<string>(initial?.category ?? categories[0]);
  const [property, setProperty] = useState<'hf-hotel' | 'hf-ville'>(initial?.property ?? 'hf-hotel');
  const [quantity, setQuantity] = useState<string>(initial?.quantity != null ? String(initial.quantity) : '');
  const [date, setDate] = useState<string>(initial?.date ?? modalToday);
  const [note, setNote] = useState<string>(initial?.note ?? '');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isEdit = initial != null;
  // Preview: freshly picked photo wins; otherwise show the stored one on edit.
  const photoPreview = photo ?? (isEdit ? initial?.photoPath ?? null : null);
  const parsedAmount = parseFloat(amount);
  const hasValidAmount = !Number.isNaN(parsedAmount) && parsedAmount > 0;
  const canSave = (isEdit || !!photo) && hasValidAmount && !saving;

  useEffect(() => {
    const handleKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const handleFile = (file: File): void => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : null;
      if (dataUrl) setPhoto(dataUrl);
    };
    reader.readAsDataURL(file);
  };

  const handleSave = (): void => {
    if (!canSave) return;
    if (!isEdit && !photo) return;
    onSave({
      photo,
      amount: parsedAmount,
      merchant,
      category,
      property,
      quantity: quantity ? parseInt(quantity, 10) : null,
      note,
      date,
    });
  };

  const sectionLabelStyle: CSSProperties = {
    fontFamily: FONT_UI,
    fontSize: 11,
    color: theme.inkSoft,
    letterSpacing: 1.4,
    textTransform: 'uppercase',
    fontWeight: 500,
    marginBottom: 8,
  };

  const inputStyle: CSSProperties = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    background: theme.surface,
    border: `0.5px solid ${theme.hairlineStrong}`,
    fontFamily: FONT_UI,
    fontSize: 14,
    color: theme.ink,
    outline: 'none',
    boxSizing: 'border-box',
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,5,0.55)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        zIndex: 60,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 560,
          maxHeight: '90vh',
          overflow: 'auto',
          background: theme.paper,
          borderRadius: 18,
          padding: 32,
          boxShadow: '0 30px 80px rgba(0,0,0,0.4)',
          boxSizing: 'border-box',
          position: 'relative',
        }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
            e.target.value = '';
          }}
        />

        {/* Header */}
        <div style={{ marginBottom: 22 }}>
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
            {isEdit ? 'แก้ไขใบเสร็จ' : 'ใบเสร็จใหม่'}
          </div>
          <h2
            style={{
              margin: '4px 0 0',
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 26,
              lineHeight: 1.1,
              letterSpacing: -0.4,
              color: theme.ink,
            }}
          >
            {isEdit ? 'แก้ไขค่าใช้จ่าย' : 'เพิ่มค่าใช้จ่าย'}
          </h2>
          <button
            onClick={onClose}
            aria-label="ปิด"
            style={{
              position: 'absolute',
              top: 22,
              right: 22,
              width: 32,
              height: 32,
              borderRadius: 16,
              border: `0.5px solid ${theme.hairline}`,
              background: theme.surface,
              color: theme.inkSoft,
              fontFamily: FONT_UI,
              fontSize: 18,
              cursor: 'pointer',
              padding: 0,
              lineHeight: 1,
            }}
          >
            ×
          </button>
        </div>

        {/* Two-column body */}
        <div style={{ display: 'flex', gap: 22 }}>
          {/* Left — photo zone */}
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 240,
              height: 320,
              flexShrink: 0,
              background: theme.surface2,
              borderRadius: 14,
              border: photoPreview ? 'none' : `1.5px dashed ${theme.hairlineStrong}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              overflow: 'hidden',
              position: 'relative',
            }}
          >
            {photoPreview ? (
              <>
                <img
                  src={photoPreview}
                  alt="ใบเสร็จ"
                  style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
                <div
                  style={{
                    position: 'absolute',
                    bottom: 10,
                    right: 10,
                    fontFamily: FONT_UI,
                    fontSize: 11,
                    color: theme.inkSoft,
                    background: theme.surface,
                    padding: '4px 10px',
                    borderRadius: 8,
                    border: `0.5px solid ${theme.hairline}`,
                  }}
                >
                  เปลี่ยนรูป
                </div>
              </>
            ) : (
              <div style={{ textAlign: 'center', color: theme.inkSoft, padding: 16 }}>
                <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                  {Icon.camera(theme.inkSoft)}
                </div>
                <div
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 13,
                    fontWeight: 500,
                    color: theme.ink,
                  }}
                >
                  คลิกเพื่อเลือกรูป
                </div>
                <div style={{ fontFamily: FONT_UI, fontSize: 11, marginTop: 4 }}>
                  ใบเสร็จจากร้านค้า
                </div>
              </div>
            )}
          </div>

          {/* Right — form fields */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            {/* Amount hero */}
            <div style={{ marginBottom: 18 }}>
              <div style={sectionLabelStyle}>จำนวนเงิน</div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: 6,
                  borderBottom: `1px solid ${theme.hairlineStrong}`,
                  paddingBottom: 8,
                }}
              >
                <span
                  style={{ fontFamily: FONT_DISPLAY, fontSize: 30, color: theme.inkSoft }}
                >
                  ฿
                </span>
                <input
                  type="text"
                  value={amount}
                  onChange={(e) => setAmount(sanitizeAmountInput(e.target.value))}
                  placeholder="0.00"
                  inputMode="decimal"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: 'none',
                    outline: 'none',
                    background: 'transparent',
                    fontFamily: FONT_DISPLAY,
                    fontSize: 40,
                    fontWeight: 400,
                    letterSpacing: -1.2,
                    color: theme.ink,
                    padding: 0,
                    lineHeight: 1.1,
                  }}
                />
                <span
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 12,
                    color: theme.inkSoft,
                    fontWeight: 500,
                  }}
                >
                  THB
                </span>
              </div>
            </div>

            {/* Merchant */}
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>ร้านค้า</div>
              <MerchantAutocomplete theme={theme} value={merchant} onPick={setMerchant}>
                <input
                  value={merchant}
                  onChange={(e) => setMerchant(e.target.value)}
                  placeholder="เช่น โฮมโปร, แม็คโคร"
                  style={inputStyle}
                />
              </MerchantAutocomplete>
            </div>

            {/* Property chips */}
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>ที่พัก</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {(
                  [
                    ['hf-hotel', 'HF Hotel'],
                    ['hf-ville', 'HF Ville'],
                  ] as const
                ).map(([value, label]) => {
                  const active = property === value;
                  return (
                    <button
                      key={value}
                      onClick={() => setProperty(value)}
                      style={{
                        padding: '7px 13px',
                        borderRadius: 100,
                        background: active ? theme.ink : 'transparent',
                        color: active ? theme.paper : theme.ink,
                        border: `0.5px solid ${active ? theme.ink : theme.hairlineStrong}`,
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Category chips */}
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>หมวดหมู่</div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {categories.map((opt) => {
                  const active = category === opt;
                  return (
                    <button
                      key={opt}
                      onClick={() => setCategory(opt)}
                      style={{
                        padding: '7px 13px',
                        borderRadius: 100,
                        background: active ? theme.ink : 'transparent',
                        color: active ? theme.paper : theme.ink,
                        border: `0.5px solid ${active ? theme.ink : theme.hairlineStrong}`,
                        fontFamily: FONT_UI,
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: 'pointer',
                      }}
                    >
                      {opt}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Quantity */}
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>จำนวนชิ้น (ถ้ามี)</div>
              <input
                value={quantity}
                onChange={(e) => setQuantity(e.target.value.replace(/[^0-9]/g, ''))}
                placeholder="เช่น 4"
                style={inputStyle}
              />
            </div>

            {/* Date editable */}
            <div style={{ marginBottom: 16 }}>
              <div style={sectionLabelStyle}>วันที่</div>
              <input
                type="date"
                value={date}
                max={modalToday}
                onChange={(e) => setDate(e.target.value || modalToday)}
                style={inputStyle}
              />
            </div>

            {/* Note */}
            <div style={{ marginBottom: 4 }}>
              <div style={sectionLabelStyle}>หมายเหตุ</div>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="หมายเหตุ (ถ้ามี)"
                style={{
                  ...inputStyle,
                  minHeight: 60,
                  resize: 'none',
                  fontFamily: FONT_UI,
                }}
              />
            </div>
          </div>
        </div>

        {/* Footer */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginTop: 24,
            paddingTop: 18,
            borderTop: `0.5px solid ${theme.hairline}`,
          }}
        >
          <GhostButton theme={theme} onClick={onClose}>
            ยกเลิก
          </GhostButton>
          <div style={{ flex: 1 }} />
          <div style={{ minWidth: 220 }}>
            <PrimaryButton theme={theme} disabled={!canSave} onClick={handleSave}>
              {saving ? 'กำลังบันทึก...' : `บันทึก · ${hasValidAmount ? fmt(parsedAmount) : '฿0.00'}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}
