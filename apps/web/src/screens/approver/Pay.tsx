import { useEffect, useRef, useState } from 'react';
import type { AppState, BundleWithDetails, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { MissingBundle } from './Review';
import { fmt } from '../../lib/format';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import { api, payFormFromFields } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { Card, IconBtn, Money, PrimaryButton, SectionHeader } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { FormRow } from '../../components/FormRow';
import { ConfirmDialog } from '../../components/ConfirmDialog';

interface PayProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  bundleId: string;
  setState: (updater: (s: AppState) => AppState) => void;
}

export function Pay({ theme, state, nav, bundleId, setState }: PayProps) {
  const found = state.bundles.find((x) => x.id === bundleId);
  const [fetched, setFetched] = useState<BundleWithDetails | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [step, setStep] = useState<'attach' | 'done'>('attach');
  const [ref, setRef] = useState('');
  const [proofPreview, setProofPreview] = useState<string | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const b = found ?? fetched ?? undefined;

  // Fetch directly when the bundle is missing from client state instead of
  // dead-ending on a blank screen.
  useEffect(() => {
    if (b) return;
    let cancelled = false;
    api.bundles
      .get(bundleId)
      .then((loaded) => {
        if (!cancelled) setFetched(loaded);
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [b, bundleId]);

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

  const onFile = (file: File) => {
    setProofFile(file);
    const reader = new FileReader();
    reader.onload = () => setProofPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  const handleConfirmPay = async () => {
    if (!proofFile || !ref.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      // Closing a 'paying' bundle by hand overrules the automation: either it
      // came back needing verification, or it is stranded with no result at
      // all. The API audits it as an override and refuses it on any other
      // status, so sending the flag whenever the bundle is in flight is safe.
      const updated = await api.bundles.pay(
        b.id,
        payFormFromFields(ref.trim(), proofFile, { force: b.status === 'paying' }),
      );
      setState((s) => ({
        ...s,
        bundles: s.bundles.some((x) => x.id === updated.id)
          ? s.bundles.map((x) => (x.id === updated.id ? updated : x))
          : [updated, ...s.bundles],
      }));
      setFetched(updated);
      setConfirmOpen(false);
      setStep('done');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setConfirmOpen(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (step === 'done') {
    return (
      <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '0 36px',
          }}
        >
          <div
            style={{
              width: 72,
              height: 72,
              borderRadius: 36,
              background: theme.success,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              marginBottom: 28,
            }}
          >
            <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
              <path
                d="M7 16l6 6 12-13"
                stroke="#fff"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </div>
          <h1
            style={{
              margin: 0,
              fontFamily: FONT_DISPLAY,
              fontWeight: 400,
              fontSize: 36,
              letterSpacing: -0.6,
              color: theme.ink,
              textAlign: 'center',
              lineHeight: 1.1,
            }}
          >
            ปิดงานแล้ว
          </h1>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 14,
              color: theme.inkSoft,
              marginTop: 12,
              textAlign: 'center',
              maxWidth: 280,
              lineHeight: 1.5,
            }}
          >
            จ่าย {fmt(total)} ให้ {b.submitter.name} เรียบร้อย แนบสลิปไว้แล้ว
          </div>
          <div
            style={{
              marginTop: 28,
              padding: '12px 18px',
              background: theme.surface,
              borderRadius: 100,
              border: `0.5px solid ${theme.hairline}`,
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: theme.ink,
            }}
          >
            {ref}
          </div>
        </div>
        <div style={{ padding: '0 20px 30px' }}>
          <PrimaryButton theme={theme} onClick={() => nav({ name: 'approver-home' })}>
            เสร็จ
          </PrimaryButton>
        </div>
      </div>
    );
  }

  return (
    <div>
      <AppBar
        theme={theme}
        large
        subtitle="ปิดงานคำขอ"
        title="โอนเงินจ่าย"
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'approver-review', id: b.id })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
      />

      <div style={{ padding: '14px 20px 0' }}>
        <Card theme={theme} padding={20}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
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
                ส่งให้
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 15, fontWeight: 500, color: theme.ink, marginTop: 4 }}>
                {b.submitter.name}
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
                จำนวนเงิน
              </div>
              <div style={{ marginTop: 4 }}>
                <Money value={total} theme={theme} size={20} accent weight={600} />
              </div>
            </div>
          </div>
        </Card>
      </div>

      <SectionHeader theme={theme} title="หลักฐานการโอน" />

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />

      <div style={{ padding: '0 20px' }}>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            height: 240,
            borderRadius: 18,
            padding: 14,
            background: theme.surface,
            border: proofPreview ? 'none' : `1.5px dashed ${theme.hairlineStrong}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          {proofPreview ? (
            <img
              src={proofPreview}
              alt="สลิปโอน"
              style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 12 }}
            />
          ) : (
            <div style={{ textAlign: 'center', color: theme.inkSoft }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                {Icon.attach(theme.inkSoft)}
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
                แตะเพื่อแนบสลิป
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, marginTop: 4 }}>จากแอปธนาคาร</div>
            </div>
          )}
        </div>

        <div style={{ marginTop: 16 }}>
          <FormRow theme={theme} label="เลขอ้างอิง" value={ref} onChange={setRef} placeholder="SCB-887214-AB" />
        </div>

        <Card theme={theme} padding={16} style={{ marginTop: 4 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 14,
                background: theme.surface2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {Icon.bank(theme.inkSoft)}
            </div>
            <div>
              <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 500, color: theme.ink, marginBottom: 4 }}>
                ปิดการอนุมัติ
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, lineHeight: 1.5 }}>
                {b.submitter.name} จะเห็นสลิปในคำขอและได้รับการแจ้งเตือน
              </div>
            </div>
          </div>
        </Card>
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '24px 20px 28px',
          background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {error && (
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.danger, textAlign: 'center' }}>
            {error}
          </div>
        )}
        <PrimaryButton
          theme={theme}
          disabled={!proofFile || !ref.trim() || submitting}
          onClick={() => setConfirmOpen(true)}
        >
          {submitting ? 'กำลังบันทึก...' : `ยืนยันการจ่าย · ${fmt(total)}`}
        </PrimaryButton>
      </div>

      {confirmOpen && (
        <ConfirmDialog
          theme={theme}
          title={`ยืนยันว่าโอนแล้ว ${fmt(total)}?`}
          message={
            b.status === 'paying' && !b.paymentError ? (
              <span>
                <span style={{ display: 'block', marginBottom: 8 }}>
                  จ่ายให้ {b.submitter.name} — การดำเนินการนี้ไม่สามารถยกเลิกได้
                </span>
                <span style={{ display: 'block', color: theme.warn }}>
                  คำขอนี้ยังค้างอยู่ที่ KBIZ — ยืนยันเฉพาะเมื่อเห็นสลิปจริงในแอป K BIZ แล้วเท่านั้น
                </span>
              </span>
            ) : (
              `จ่ายให้ ${b.submitter.name} — การดำเนินการนี้ไม่สามารถยกเลิกได้`
            )
          }
          confirmLabel="ยืนยัน"
          loading={submitting}
          onConfirm={() => { void handleConfirmPay(); }}
          onCancel={() => setConfirmOpen(false)}
        />
      )}
    </div>
  );
}

