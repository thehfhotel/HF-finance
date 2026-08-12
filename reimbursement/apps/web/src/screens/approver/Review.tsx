import { useEffect, useState } from 'react';
import type { AppState, BundleWithDetails, Receipt, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmt, fmtN, formatThaiDate } from '../../lib/format';
import { isPaymentStuck } from '../../lib/stats';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { api } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import {
  Avatar,
  Card,
  GhostButton,
  IconBtn,
  Money,
  PrimaryButton,
  SectionHeader,
  StatusPill,
} from '../../components/primitives';
import { Icon } from '../../components/icons';
import { ReceiptPhoto, ReceiptThumb } from '../../components/Receipts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Toast, useToast } from '../../components/Toast';
import { KbizDestinationPicker } from '../../components/KbizDestinationPicker';
import type { KbizChosenDestination } from '../../components/KbizDestinationPicker';

interface ReviewProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  bundleId: string;
  setState: (updater: (s: AppState) => AppState) => void;
}

type ConfirmKind = 'approve' | 'reject' | 'pay-kbiz' | 'retry' | 'force-retry';

/** How often to re-fetch the bundle while it's 'paying' — the panel promises
 *  to update itself once the transfer settles, so it has to poll. */
const PAYMENT_POLL_MS = 8000;

export function Review({ theme, state, nav, bundleId, setState }: ReviewProps) {
  const found = state.bundles.find((x) => x.id === bundleId);
  const [b, setB] = useState<BundleWithDetails | undefined>(found);
  const [loadFailed, setLoadFailed] = useState(false);
  const [photoIdx, setPhotoIdx] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmKind, setConfirmKind] = useState<ConfirmKind | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [kbizPickerOpen, setKbizPickerOpen] = useState(false);
  // Set by the destination picker's own "ยืนยัน" step; the pay-kbiz confirm
  // dialog below reads it for the summary line and payViaKbiz sends it — no
  // destination change once that confirm dialog is open.
  const [chosenDestination, setChosenDestination] = useState<KbizChosenDestination | null>(null);
  const { toast, showToast } = useToast();

  // The bundle may be absent from client state (deep link, stale list) —
  // fetch it directly instead of rendering a blank screen.
  useEffect(() => {
    if (b) return;
    let cancelled = false;
    api.bundles
      .get(bundleId)
      .then((fetched) => {
        if (!cancelled) setB(fetched);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [b, bundleId]);

  // The in-flight banner tells the approver this page updates itself once the
  // KBIZ transfer settles — poll while that's true, or the promise is a lie
  // until they back out and reopen the request.
  useEffect(() => {
    if (b?.status !== 'paying') return;
    const id = b.id;
    const timer = window.setInterval(() => {
      api.bundles
        .get(id)
        .then((updated) => {
          setB(updated);
          setState((s) => ({
            ...s,
            bundles: s.bundles.some((x) => x.id === updated.id)
              ? s.bundles.map((x) => (x.id === updated.id ? updated : x))
              : [updated, ...s.bundles],
          }));
        })
        .catch(() => {
          // Transient network hiccup — the next tick tries again.
        });
    }, PAYMENT_POLL_MS);
    return () => window.clearInterval(timer);
  }, [b?.id, b?.status, setState]);

  if (!b) {
    return (
      <MissingBundle
        theme={theme}
        failed={loadFailed}
        onBack={() => nav({ name: 'approver-home' })}
      />
    );
  }
  const items = b.receipts;
  const total = items.reduce((s, r) => s + r.amount, 0);
  const [whole, frac] = fmtN(total).split('.');

  const applyServerUpdate = (updated: BundleWithDetails) => {
    setB(updated);
    setState((s) => ({
      ...s,
      bundles: s.bundles.some((x) => x.id === updated.id)
        ? s.bundles.map((x) => (x.id === updated.id ? updated : x))
        : [updated, ...s.bundles],
    }));
  };

  const handleApprove = async () => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.approve(b.id);
      applyServerUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
      setConfirmKind(null);
    }
  };

  const handleReject = async (reason: string) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.reject(b.id, reason.trim() || undefined);
      applyServerUpdate(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
      setConfirmKind(null);
      setRejectReason('');
    }
  };

  const handlePayViaKbiz = async () => {
    if (submitting || !chosenDestination) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.payViaKbiz(b.id, chosenDestination.destination);
      applyServerUpdate(updated);
      setChosenDestination(null);
      showToast('ส่งคำสั่งโอนแล้ว — ยืนยันบนแอป K BIZ ในมือถือ');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
      setConfirmKind(null);
    }
  };

  // `force` is only sent from the stuck-payment actions, where the approver has
  // just been told to check K BIZ first: it overrules an intent kbiz-bot still
  // owns. Without it the API releases only what the queue proves never armed.
  const handlePaymentRetry = async (force = false) => {
    if (submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const updated = await api.bundles.paymentRetry(b.id, { force });
      applyServerUpdate(updated);
      showToast('ย้อนกลับไปสถานะอนุมัติแล้ว — ลองโอนผ่าน KBIZ ใหม่ได้');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
      setConfirmKind(null);
    }
  };

  return (
    <div style={{ position: 'relative' }}>
      <AppBar
        theme={theme}
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'approver-home' })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
        title="ตรวจสอบ"
      />

      <div style={{ padding: '0 20px 18px' }}>
        <StatusPill status={b.status} theme={theme} />
        <h1
          style={{
            margin: '10px 0 6px',
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 32,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            color: theme.ink,
          }}
        >
          {b.name}
        </h1>
        <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Avatar theme={theme} initials={b.submitter.initials} size={22} />
          {b.submitter.name}
        </div>
        {b.status === 'rejected' && b.rejectReason && (
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
            {b.rejectReason}
          </div>
        )}
        {b.status === 'paying' && !b.paymentError && (
          <div
            style={{
              marginTop: 10,
              padding: '8px 12px',
              borderRadius: 8,
              background: `${theme.statusPaying}18`,
              borderLeft: `3px solid ${theme.statusPaying}`,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: theme.ink,
              lineHeight: 1.5,
            }}
          >
            <span style={{ fontWeight: 600, marginRight: 6 }}>กำลังโอนผ่าน KBIZ — รอยืนยันบนมือถือ</span>
            <span style={{ display: 'block', color: theme.inkSoft, marginTop: 2 }}>
              หน้าจะอัปเดตให้อัตโนมัติเมื่อโอนสำเร็จ — ลองรีเฟรชอีกครั้งภายหลังหากรอนาน
            </span>
          </div>
        )}
        {b.status === 'paying' && b.paymentError && (
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
            <span style={{ fontWeight: 600, color: theme.danger, marginRight: 6 }}>
              โอนผ่าน KBIZ ไม่สำเร็จ / ไม่ทราบผล:
            </span>
            {b.paymentError}
          </div>
        )}
        {/* A confirmed-failed KBIZ attempt returns the bundle to 'approved'
            with paymentError set (kbiz-poller.ts) — surface it here too, or
            the phone-based approver re-fires a transfer that already failed
            with no idea why (desktop console shows this at Desktop.tsx:1018). */}
        {b.status === 'approved' && b.paymentError && (
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
            <span style={{ fontWeight: 600, color: theme.danger, marginRight: 6 }}>
              โอนผ่าน KBIZ ครั้งก่อนไม่สำเร็จ:
            </span>
            {b.paymentError}
          </div>
        )}
      </div>

      <div style={{ padding: '0 20px 8px' }}>
        <Card theme={theme} padding={20}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
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
                ยอดเบิก
              </div>
              <div
                style={{
                  marginTop: 4,
                  fontFamily: FONT_DISPLAY,
                  fontSize: 44,
                  color: theme.ink,
                  lineHeight: 1,
                  letterSpacing: -1.2,
                }}
              >
                <span style={{ fontSize: 26, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
                {whole}
                <span style={{ opacity: 0.5 }}>.{frac}</span>
              </div>
            </div>
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, textAlign: 'right' }}>
              {items.length} รายการ
              <br />
              ส่ง {formatThaiDate(b.submittedAt)}
            </div>
          </div>
          {b.note && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: `0.5px solid ${theme.hairline}`,
                fontFamily: FONT_DISPLAY,
                fontSize: 16,
                color: theme.ink,
                fontStyle: 'italic',
              }}
            >
              "{b.note}"
            </div>
          )}
        </Card>
      </div>

      <SectionHeader theme={theme} title={`ใบเสร็จ · ${items.length}`} />
      <div style={{ display: 'flex', gap: 14, overflowX: 'auto', padding: '4px 20px 16px' }}>
        {items.map((r, i) => (
          <div
            key={r.id}
            onClick={() => setPhotoIdx(i)}
            style={{ cursor: 'pointer', flexShrink: 0 }}
          >
            <ReceiptPhoto receipt={r} height={216} slim rotate={i % 2 === 0 ? -1.5 : 1.5} />
          </div>
        ))}
      </div>

      <div style={{ padding: '0 20px' }}>
        <SectionHeader theme={theme} title="รายละเอียด" />
        <Card theme={theme} padding={0}>
          {items.map((r, i) => (
            <div
              key={r.id}
              onClick={() => setPhotoIdx(i)}
              style={{
                padding: '14px 18px',
                borderBottom: i < items.length - 1 ? `0.5px solid ${theme.hairline}` : 'none',
                display: 'flex',
                alignItems: 'center',
                gap: 14,
                cursor: 'pointer',
              }}
            >
              <ReceiptThumb receipt={r} size={42} />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
                  {r.merchant}
                </div>
                <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                  {r.category} · {formatThaiDate(r.date)} {r.note && `· ${r.note}`}
                </div>
              </div>
              <Money value={r.amount} theme={theme} size={15} weight={500} />
            </div>
          ))}
          <div
            style={{
              padding: '14px 18px',
              display: 'flex',
              justifyContent: 'space-between',
              background: theme.surface2,
              borderRadius: '0 0 18px 18px',
            }}
          >
            <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 600, color: theme.ink }}>รวม</span>
            <Money value={total} theme={theme} size={18} accent weight={600} />
          </div>
        </Card>
      </div>

      {photoIdx !== null && (
        <PhotoLightbox
          items={items}
          index={photoIdx}
          onClose={() => setPhotoIdx(null)}
          setIndex={setPhotoIdx}
        />
      )}

      {b.status === 'pending' && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '24px 20px 28px',
            background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {error && (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', gap: 10 }}>
            <GhostButton theme={theme} onClick={() => setConfirmKind('reject')}>
              ปฏิเสธ
            </GhostButton>
            <div style={{ flex: 1 }}>
              <PrimaryButton theme={theme} onClick={() => setConfirmKind('approve')} disabled={submitting}>
                {`อนุมัติ · ${fmt(total)}`}
              </PrimaryButton>
            </div>
          </div>
        </div>
      )}

      {b.status === 'approved' && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '24px 20px 28px',
            background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {error && (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}
          <GhostButton theme={theme} onClick={() => setConfirmKind('reject')}>
            ปฏิเสธ (อนุมัติผิด)
          </GhostButton>
          {/* Manual pay always stays available; KBIZ appears once this host is
              wired up for it — the destination itself is chosen in the picker. */}
          {b.kbizPayable && (
            <PrimaryButton theme={theme} onClick={() => setKbizPickerOpen(true)} disabled={submitting}>
              โอนผ่าน KBIZ
            </PrimaryButton>
          )}
          {b.kbizPayable ? (
            <GhostButton theme={theme} full onClick={() => nav({ name: 'approver-pay', id: b.id })}>
              บันทึกจ่ายเงิน &amp; แนบสลิปเอง
            </GhostButton>
          ) : (
            <PrimaryButton theme={theme} onClick={() => nav({ name: 'approver-pay', id: b.id })}>
              บันทึกจ่ายเงิน &amp; แนบสลิป
            </PrimaryButton>
          )}
        </div>
      )}

      {b.status === 'paying' && b.paymentError && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '24px 20px 28px',
            background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {error && (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}
          <PrimaryButton theme={theme} onClick={() => nav({ name: 'approver-pay', id: b.id })}>
            ยืนยันว่าโอนแล้ว (แนบสลิป)
          </PrimaryButton>
          <GhostButton theme={theme} full onClick={() => setConfirmKind('retry')}>
            ยังไม่ได้โอน — ลองใหม่
          </GhostButton>
        </div>
      )}

      {/* Nobody is coming back for this one. kbiz-bot can die without ever
          writing a result — and a result is the only thing that flags a bundle
          — so after a while the approver gets the same two ways out by hand,
          rather than a request stuck in "กำลังโอน" that no screen can close. */}
      {isPaymentStuck(b) && (
        <div
          style={{
            position: 'sticky',
            bottom: 0,
            padding: '24px 20px 28px',
            background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          {error && (
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, textAlign: 'center' }}>
              {error}
            </div>
          )}
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.inkSoft,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            ค้างนานผิดปกติ — เปิดแอป K BIZ เพื่อดูว่าโอนไปแล้วหรือยัง แล้วเลือกด้านล่าง
          </div>
          <GhostButton theme={theme} full onClick={() => nav({ name: 'approver-pay', id: b.id })}>
            โอนไปแล้ว — แนบสลิปเอง
          </GhostButton>
          <GhostButton theme={theme} full onClick={() => setConfirmKind('force-retry')}>
            ยังไม่ได้โอน — ปล่อยกลับไปอนุมัติ
          </GhostButton>
        </div>
      )}

      {b.status === 'paid' && (
        <div style={{ padding: '12px 20px 28px' }}>
          <Card theme={theme} padding={18}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <div
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: 12,
                  background: theme.success,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {Icon.check('#fff')}
              </div>
              <span style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 600, color: theme.ink }}>
                จ่ายแล้ว {formatThaiDate(b.paidAt)}
              </span>
            </div>
            <BankReceipt theme={theme} bundle={b} />
          </Card>
        </div>
      )}

      {confirmKind === 'approve' && (
        <ConfirmDialog
          theme={theme}
          title="อนุมัติคำขอนี้?"
          message={`ยืนยันการอนุมัติยอด ${fmt(total)}`}
          confirmLabel="อนุมัติ"
          loading={submitting}
          onConfirm={handleApprove}
          onCancel={() => setConfirmKind(null)}
        />
      )}

      {confirmKind === 'reject' && (
        <ConfirmDialog
          theme={theme}
          title="ปฏิเสธคำขอนี้?"
          message={
            <span>
              <span style={{ display: 'block', marginBottom: 12 }}>
                คำขอนี้จะถูกปฏิเสธและแจ้งผู้ยื่น
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
          }
          confirmLabel="ปฏิเสธ"
          danger
          loading={submitting}
          onConfirm={() => void handleReject(rejectReason)}
          onCancel={() => { setConfirmKind(null); setRejectReason(''); }}
        />
      )}

      {confirmKind === 'pay-kbiz' && (
        <ConfirmDialog
          theme={theme}
          title={`โอน ${fmt(total)} ผ่าน KBIZ?`}
          message={
            <span>
              <span style={{ display: 'block', marginBottom: 8 }}>
                โอนเข้า <strong>{chosenDestination?.summary ?? 'บัญชีที่เลือก'}</strong> ให้ {b.submitter.name}
              </span>
              <span style={{ display: 'block', color: theme.warn }}>
                ต้องกดยืนยันในแอป K BIZ บนมือถือ — หากไม่ยืนยัน การโอนจะไม่สำเร็จ
              </span>
            </span>
          }
          confirmLabel="โอนผ่าน KBIZ"
          loading={submitting}
          onConfirm={() => void handlePayViaKbiz()}
          onCancel={() => { setConfirmKind(null); setChosenDestination(null); }}
        />
      )}

      {kbizPickerOpen && (
        <KbizDestinationPicker
          theme={theme}
          bundle={b}
          onClose={() => setKbizPickerOpen(false)}
          onConfirm={(chosen) => {
            setChosenDestination(chosen);
            setKbizPickerOpen(false);
            setConfirmKind('pay-kbiz');
          }}
          onGotoSettings={() => {
            setKbizPickerOpen(false);
            nav({ name: 'admin-kbiz' });
          }}
        />
      )}

      {confirmKind === 'retry' && (
        <ConfirmDialog
          theme={theme}
          title="ลองโอนใหม่?"
          message="ตรวจสอบในแอป K BIZ แล้วว่ารายการก่อนหน้าไม่สำเร็จ"
          confirmLabel="ลองใหม่"
          loading={submitting}
          onConfirm={() => void handlePaymentRetry()}
          onCancel={() => setConfirmKind(null)}
        />
      )}

      {confirmKind === 'force-retry' && (
        <ConfirmDialog
          theme={theme}
          title="ปล่อยกลับไปสถานะอนุมัติ?"
          message="ยืนยันว่าเปิดแอป K BIZ ดูแล้วและยังไม่มีการโอนออกจริง — ถ้าโอนไปแล้วให้เลือก “โอนไปแล้ว — แนบสลิปเอง” แทน ไม่อย่างนั้นอาจโอนซ้ำ"
          confirmLabel="ยังไม่ได้โอน"
          danger
          loading={submitting}
          onConfirm={() => void handlePaymentRetry(true)}
          onCancel={() => setConfirmKind(null)}
        />
      )}

      <Toast toast={toast} theme={theme} />
    </div>
  );
}

interface MissingBundleProps {
  theme: Theme;
  failed: boolean;
  onBack: () => void;
}

/** Shown while a bundle absent from client state is being fetched (or failed to load). */
export function MissingBundle({ theme, failed, onBack }: MissingBundleProps) {
  return (
    <div
      style={{
        minHeight: 320,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        padding: '60px 28px',
        textAlign: 'center',
      }}
    >
      {failed ? (
        <>
          <div style={{ fontFamily: FONT_UI, fontSize: 15, color: theme.ink, fontWeight: 500 }}>
            ไม่พบคำขอนี้
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft, lineHeight: 1.5 }}>
            คำขออาจถูกลบไปแล้ว หรือคุณไม่มีสิทธิ์เข้าถึง
          </div>
          <GhostButton theme={theme} onClick={onBack}>
            กลับกล่องอนุมัติ
          </GhostButton>
        </>
      ) : (
        <>
          <div
            style={{
              width: 26,
              height: 26,
              borderRadius: 13,
              border: `2.5px solid ${theme.accent}33`,
              borderTopColor: theme.accent,
              animation: 'review-load-spin 0.8s linear infinite',
            }}
          />
          <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>กำลังโหลด...</div>
          <style>{`@keyframes review-load-spin { to { transform: rotate(360deg); } }`}</style>
        </>
      )}
    </div>
  );
}

interface PhotoLightboxProps {
  items: Receipt[];
  index: number;
  onClose: () => void;
  setIndex: (i: number) => void;
}

function PhotoLightbox({ items, index, onClose, setIndex }: PhotoLightboxProps) {
  const [zoomed, setZoomed] = useState(false);
  const r = items[index];

  // Reset zoom when navigating
  useEffect(() => {
    setZoomed(false);
  }, [index]);

  // Esc to close, arrow keys to navigate
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { onClose(); return; }
      if (e.key === 'ArrowLeft' && index > 0) { setIndex(index - 1); return; }
      if (e.key === 'ArrowRight' && index < items.length - 1) { setIndex(index + 1); return; }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [index, items.length, onClose, setIndex]);

  if (!r) return null;

  const hasPrev = index > 0;
  const hasNext = index < items.length - 1;

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(10,8,5,0.96)',
        zIndex: 200,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Header: close + counter */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          padding: '54px 20px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexShrink: 0,
        }}
      >
        <div style={{ width: 36 }} />
        <div style={{ fontFamily: FONT_UI, fontSize: 13, color: '#fff', opacity: 0.7 }}>
          {index + 1} / {items.length}
        </div>
        {/* × close button top-right */}
        <button
          onClick={onClose}
          style={{
            width: 36,
            height: 36,
            borderRadius: 18,
            background: 'rgba(255,255,255,0.16)',
            border: 'none',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#fff',
          }}
        >
          {Icon.close('#fff')}
        </button>
      </div>

      {/* Image area — tap toggles zoom */}
      <div
        onClick={(e) => { e.stopPropagation(); setZoomed((z) => !z); }}
        style={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 20,
          overflow: 'hidden',
          cursor: zoomed ? 'zoom-out' : 'zoom-in',
        }}
      >
        {r.photoPath ? (
          <img
            src={r.photoPath}
            alt={r.merchant}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              objectFit: 'contain',
              borderRadius: 8,
              transform: zoomed ? 'scale(2)' : 'scale(1)',
              transition: 'transform 0.25s ease',
              transformOrigin: 'center',
            }}
            draggable={false}
          />
        ) : (
          // No-photo fallback
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 12,
              opacity: 0.5,
            }}
          >
            <ReceiptPhoto receipt={r} height={280} />
            <div style={{ fontFamily: FONT_UI, fontSize: 14, color: '#fff', marginTop: 8 }}>
              ไม่มีรูปใบเสร็จ
            </div>
          </div>
        )}
      </div>

      {/* Footer: merchant info + prev/next */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ padding: '0 20px 36px', flexShrink: 0 }}
      >
        <div style={{ textAlign: 'center', color: '#fff', marginBottom: 16 }}>
          <div style={{ fontFamily: FONT_DISPLAY, fontSize: 22, marginBottom: 4 }}>{r.merchant}</div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, opacity: 0.6 }}>
            {r.category} · {formatThaiDate(r.date)} · {fmt(r.amount)}
          </div>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10 }}>
          <button
            onClick={() => hasPrev && setIndex(index - 1)}
            disabled={!hasPrev}
            style={{
              padding: '10px 16px',
              borderRadius: 100,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              fontFamily: FONT_UI,
              fontSize: 13,
              cursor: hasPrev ? 'pointer' : 'default',
              opacity: hasPrev ? 1 : 0.3,
            }}
          >
            ← ก่อนหน้า
          </button>
          <button
            onClick={() => hasNext && setIndex(index + 1)}
            disabled={!hasNext}
            style={{
              padding: '10px 16px',
              borderRadius: 100,
              background: 'rgba(255,255,255,0.1)',
              border: 'none',
              color: '#fff',
              fontFamily: FONT_UI,
              fontSize: 13,
              cursor: hasNext ? 'pointer' : 'default',
              opacity: hasNext ? 1 : 0.3,
            }}
          >
            ถัดไป →
          </button>
        </div>
      </div>

    </div>
  );
}

interface BankReceiptProps {
  theme: Theme;
  bundle: BundleWithDetails;
}

function BankReceipt({ theme, bundle }: BankReceiptProps) {
  return (
    <div style={{ background: theme.surface2, borderRadius: 12, padding: 14, fontFamily: FONT_UI, fontSize: 13 }}>
      {bundle.transferProofPath && (
        <img
          src={bundle.transferProofPath}
          alt="หลักฐานการโอน"
          style={{ width: '100%', borderRadius: 8, marginBottom: 12, display: 'block' }}
        />
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
        <span style={{ color: theme.inkSoft }}>เลขอ้างอิง</span>
        <span style={{ color: theme.ink }}>{bundle.transferRef}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
        <span style={{ color: theme.inkSoft }}>จำนวนเงิน</span>
        <span style={{ color: theme.ink }}>฿{fmtN(bundle.transferAmount ?? 0)}</span>
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
        <span style={{ color: theme.inkSoft }}>วันที่จ่าย</span>
        <span style={{ color: theme.ink }}>{formatThaiDate(bundle.paidAt)}</span>
      </div>
    </div>
  );
}
