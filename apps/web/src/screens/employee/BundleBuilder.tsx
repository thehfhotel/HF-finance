import { useState } from 'react';
import type { AppState, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { FONT_UI } from '../../lib/theme';
import { formatThaiDate } from '../../lib/format';
import { api } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { IconBtn, Money, PrimaryButton, SectionHeader } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { FormRow } from '../../components/FormRow';
import { SelectableReceiptRow } from './_shared';
import { Toast, useToast } from '../../components/Toast';

function todayAutoName(): string {
  const today = new Date().toISOString().slice(0, 10);
  return `คำขอ ${formatThaiDate(today)}`;
}

interface BundleBuilderProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  setState: (updater: (s: AppState) => AppState) => void;
  preselectId?: string;
}

export function BundleBuilder({ theme, state, nav, setState, preselectId }: BundleBuilderProps) {
  const [name, setName] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast, showToast } = useToast();

  const loose = state.receipts.filter((r) => r.bundleId === null);
  const [selected, setSelected] = useState<Set<string>>(() =>
    preselectId ? new Set([preselectId]) : new Set(),
  );

  // Only loose receipts are submittable — a stale preselect (e.g. a receipt
  // that got bundled elsewhere) must not poison the request.
  const selectedLoose = loose.filter((r) => selected.has(r.id));
  // Ticking a month of receipts one at a time is the slowest part of submitting,
  // and the common case is "all of them".
  const allSelected = loose.length > 0 && loose.every((r) => selected.has(r.id));
  const toggleSelectAll = (): void => {
    setSelected(allSelected ? new Set() : new Set(loose.map((r) => r.id)));
  };
  const total = selectedLoose.reduce((s, r) => s + r.amount, 0);

  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelected(next);
  };

  const submit = async () => {
    if (selectedLoose.length === 0 || !name.trim() || submitting) return;
    setError(null);
    setSubmitting(true);
    try {
      const created = await api.bundles.create({
        name: name.trim(),
        receiptIds: selectedLoose.map((r) => r.id),
        note,
      });
      setState((s) => ({
        ...s,
        bundles: [created, ...s.bundles],
        receipts: s.receipts.map((r) =>
          created.receipts.some((cr) => cr.id === r.id) ? { ...r, bundleId: created.id } : r,
        ),
      }));
      showToast('ส่งขออนุมัติเรียบร้อย');
      nav({ name: 'bundle-submitted', id: created.id });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <AppBar
        theme={theme}
        large
        subtitle="คำขอใหม่"
        title="สร้างชุด & ส่ง"
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'home' })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
      />

      <div style={{ padding: '20px 20px 0' }}>
        <FormRow theme={theme} label="ชื่อ" value={name} onChange={setName} placeholder={todayAutoName()} />
        <div
          style={{
            marginTop: -12,
            marginBottom: 18,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.inkSofter,
          }}
        >
          กรุณาตั้งชื่อคำขอ เช่น ค่าอุปกรณ์ซ่อมแอร์
        </div>
        <FormRow
          theme={theme}
          label="หมายเหตุถึงผู้อนุมัติ"
          value={note}
          onChange={setNote}
          placeholder="ระบุที่มาหรือรหัสโปรเจกต์ (ถ้ามี)"
          multiline
        />
      </div>

      <div style={{ padding: '0 20px' }}>
        <SectionHeader
          theme={theme}
          title={`ใบเสร็จ · ${selectedLoose.length} จาก ${loose.length}`}
          action={
            loose.length > 0 ? (
              <span
                onClick={toggleSelectAll}
                style={{ color: theme.accent, fontWeight: 600, cursor: 'pointer' }}
              >
                {allSelected ? 'ล้างที่เลือก' : 'เลือกทั้งหมด'}
              </span>
            ) : null
          }
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {loose.map((r) => (
            <SelectableReceiptRow
              key={r.id}
              receipt={r}
              theme={theme}
              selected={selected.has(r.id)}
              onToggle={() => toggle(r.id)}
            />
          ))}
        </div>
      </div>

      <div
        style={{
          position: 'sticky',
          bottom: 0,
          background: `linear-gradient(180deg, transparent, ${theme.paper} 25%)`,
          padding: '24px 20px 28px',
        }}
      >
        <div
          style={{
            background: theme.surface,
            borderRadius: 18,
            padding: '14px 18px',
            border: `0.5px solid ${theme.hairline}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: 12,
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
              ยอดรวมชุด
            </div>
            <div style={{ marginTop: 4 }}>
              <Money value={total} theme={theme} size={26} accent />
            </div>
          </div>
          <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, textAlign: 'right' }}>
            {selectedLoose.length} ใบเสร็จ
            <br />
            <span style={{ color: theme.inkSofter }}>→ ฝ่ายการเงิน</span>
          </div>
        </div>
        {error && (
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.danger,
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            {error}
          </div>
        )}
        <PrimaryButton theme={theme} disabled={selectedLoose.length === 0 || !name.trim() || submitting} onClick={submit}>
          {submitting ? 'กำลังส่ง...' : 'ส่งขออนุมัติ'}
        </PrimaryButton>
      </div>
      <Toast toast={toast} theme={theme} />
    </div>
  );
}

