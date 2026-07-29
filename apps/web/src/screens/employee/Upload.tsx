import { useEffect, useRef, useState } from 'react';
import type { AppState, Property, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { RECEIPT_CATEGORIES } from '../../lib/types';
import { fmt } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { api, receiptFormFromFields } from '../../lib/api';
import { AppBar } from '../../components/AppBar';
import { IconBtn, PrimaryButton } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { FormRow } from '../../components/FormRow';
import { ReceiptPhoto } from '../../components/Receipts';

interface UploadProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  setState: (updater: (s: AppState) => AppState) => void;
  editId?: string;
}

const CATEGORIES = RECEIPT_CATEGORIES;

const PALETTE = [
  ['#F5EBD9', '#7E5E3A'],
  ['#FFE9D6', '#A04A1A'],
  ['#E8F0F4', '#1A4A6E'],
  ['#EDE3D2', '#5A3A1A'],
  ['#E6F4EA', '#0A6E40'],
] as const;

export function Upload({ theme, nav, state, setState, editId }: UploadProps) {
  const existing = editId ? (state.receipts.find((r) => r.id === editId) ?? null) : null;

  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(
    existing?.photoPath ?? null,
  );
  const [amount, setAmount] = useState(existing ? String(existing.amount) : '');
  const [merchant, setMerchant] = useState(existing?.merchant ?? '');
  const [category, setCategory] = useState<string>(existing?.category ?? CATEGORIES[0]);
  const [property, setProperty] = useState<Property>(existing?.property ?? 'hf-hotel');
  const [quantity, setQuantity] = useState(existing?.quantity != null ? String(existing.quantity) : '');
  const [note, setNote] = useState(existing?.note ?? '');
  const [date, setDate] = useState<string>(existing?.date ?? todayIso());
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const today = todayIso();

  // If the editId changes (e.g. navigation), re-sync state.
  useEffect(() => {
    if (!editId) return;
    const r = state.receipts.find((rec) => rec.id === editId);
    if (!r) return;
    setAmount(String(r.amount));
    setMerchant(r.merchant);
    setCategory(r.category);
    setProperty(r.property);
    setQuantity(r.quantity != null ? String(r.quantity) : '');
    setNote(r.note ?? '');
    setDate(r.date);
    setPhotoFile(null);
    setPhotoPreview(r.photoPath ?? null);
  // We only want to sync when editId changes, not on every state update.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editId]);

  const onFile = (file: File) => {
    setPhotoFile(file);
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(typeof reader.result === 'string' ? reader.result : null);
    reader.readAsDataURL(file);
  };

  // Create requires a photo; edit keeps whatever the receipt already has
  // (imported receipts may legitimately have none).
  const hasPhoto = !!photoFile || (editId != null && existing?.photoPath != null);
  const canSave = (editId != null || hasPhoto) && parseFloat(amount) > 0 && !submitting;

  const handleSave = async () => {
    if (!canSave) return;

    if (editId) {
      // Edit path — only include the photo field when the user picked a new file.
      const idx = Math.floor(Math.random() * PALETTE.length);
      const palette = PALETTE[idx];
      const form = receiptFormFromFields(
        {
          merchant: merchant || 'ใบเสร็จใหม่',
          category,
          property,
          quantity: quantity ? parseInt(quantity, 10) : null,
          amount: parseFloat(amount),
          date,
          note,
          color: existing?.color ?? palette[0],
          accent: existing?.accent ?? palette[1],
          items: existing?.items ?? [],
          tax: existing?.tax ?? '0',
        },
        photoFile ?? undefined,
      );
      setSubmitting(true);
      setSaveError(null);
      try {
        const updated = await api.receipts.update(editId, form);
        setState((s) => ({
          ...s,
          receipts: s.receipts.map((r) => (r.id === editId ? updated : r)),
        }));
        nav({ name: 'home' });
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      } finally {
        setSubmitting(false);
      }
      return;
    }

    // Create path (original logic)
    if (!photoFile) return;
    const idx = Math.floor(Math.random() * PALETTE.length);
    const palette = PALETTE[idx];
    const form = receiptFormFromFields(
      {
        merchant: merchant || 'ใบเสร็จใหม่',
        category,
        property,
        quantity: quantity ? parseInt(quantity, 10) : null,
        amount: parseFloat(amount),
        date: date,
        note,
        color: palette[0],
        accent: palette[1],
        items: [],
        tax: '0',
      },
      photoFile,
    );
    setSubmitting(true);
    setSaveError(null);
    try {
      const created = await api.receipts.create(form);
      setState((s) => ({ ...s, receipts: [created, ...s.receipts] }));
      nav({ name: 'home' });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <AppBar
        theme={theme}
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'home' })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
        title={editId ? 'แก้ไขใบเสร็จ' : 'ใบเสร็จใหม่'}
      />

      {/* Photo zone — file upload (real, not mock) */}
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

      <div style={{ padding: '8px 20px 24px' }}>
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            height: 240,
            background: theme.surface2,
            borderRadius: 18,
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
                  bottom: 12,
                  right: 14,
                  fontFamily: FONT_UI,
                  fontSize: 11,
                  color: theme.inkSoft,
                  background: theme.surface,
                  padding: '4px 10px',
                  borderRadius: 8,
                  border: `0.5px solid ${theme.hairline}`,
                }}
              >
                ถ่ายใหม่
              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', color: theme.inkSoft }}>
              <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'center' }}>
                {Icon.camera(theme.inkSoft)}
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
                แตะเพื่อถ่ายหรือเลือกรูป
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, marginTop: 4 }}>
                ใบเสร็จจากร้านค้า
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Amount hero */}
      <div style={{ padding: '0 20px' }}>
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
        <div
          style={{
            marginTop: 10,
            display: 'flex',
            alignItems: 'baseline',
            gap: 6,
            borderBottom: `1px solid ${theme.hairlineStrong}`,
            paddingBottom: 12,
          }}
        >
          <span style={{ fontFamily: FONT_DISPLAY, fontSize: 40, color: theme.inkSoft }}>฿</span>
          <input
            type="text"
            value={amount}
            onChange={(e) => {
              const raw = e.target.value.replace(/[^0-9.]/g, '');
              // Allow at most one decimal point and at most 2 fraction digits
              const parts = raw.split('.');
              const cleaned =
                parts.length <= 1
                  ? raw
                  : parts[0] + '.' + parts.slice(1).join('').slice(0, 2);
              setAmount(cleaned);
            }}
            placeholder="0.00"
            inputMode="decimal"
            style={{
              flex: 1,
              border: 'none',
              outline: 'none',
              background: 'transparent',
              fontFamily: FONT_DISPLAY,
              fontSize: 56,
              fontWeight: 400,
              letterSpacing: -1.5,
              color: theme.ink,
              padding: 0,
              lineHeight: 1,
            }}
          />
          <span style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, fontWeight: 500 }}>THB</span>
        </div>
      </div>

      {/* Form */}
      <div style={{ padding: '24px 20px 0' }}>
        <FormRow theme={theme} label="ร้านค้า" value={merchant} onChange={setMerchant} placeholder="เช่น โฮมโปร, แม็คโคร" />
        <FormRow
          theme={theme}
          label="ที่พัก"
          value={property}
          onChange={(v) => setProperty(v === 'hf-ville' ? 'hf-ville' : 'hf-hotel')}
          select
          options={['hf-hotel', 'hf-ville']}
          optionLabels={{ 'hf-hotel': 'HF Hotel', 'hf-ville': 'HF Ville' }}
        />
        <FormRow
          theme={theme}
          label="หมวดหมู่"
          value={category}
          onChange={setCategory}
          select
          options={CATEGORIES}
        />
        <FormRow
          theme={theme}
          label="จำนวนชิ้น (ถ้ามี)"
          value={quantity}
          onChange={(v) => setQuantity(v.replace(/[^0-9]/g, ''))}
          placeholder="เช่น 4"
        />
        <div style={{ marginBottom: 18 }}>
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSoft,
              letterSpacing: 1.4,
              textTransform: 'uppercase',
              marginBottom: 8,
            }}
          >
            วันที่
          </div>
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value || today)}
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              background: theme.surface,
              border: `0.5px solid ${theme.hairlineStrong}`,
              fontFamily: FONT_UI,
              fontSize: 15,
              color: theme.ink,
              outline: 'none',
              boxSizing: 'border-box',
            }}
          />
        </div>
        <FormRow theme={theme} label="หมายเหตุ" value={note} onChange={setNote} placeholder="หมายเหตุ (ถ้ามี)" multiline />
      </div>

      {/* Save bar */}
      <div
        style={{
          position: 'sticky',
          bottom: 0,
          padding: '12px 20px 30px',
          background: `linear-gradient(180deg, transparent, ${theme.paper} 30%)`,
        }}
      >
        {saveError && (
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.danger,
              marginBottom: 8,
              textAlign: 'center',
            }}
          >
            {saveError}
          </div>
        )}
        <PrimaryButton theme={theme} disabled={!canSave} onClick={handleSave}>
          {submitting ? 'กำลังบันทึก...' : `บันทึก · ${amount ? fmt(parseFloat(amount) || 0) : '฿0.00'}`}
        </PrimaryButton>
      </div>

      {/* Hidden preview reference (so the SVG variant can still show if no photo set on a draft) */}
      {amount && parseFloat(amount) > 0 && photoPreview && (
        <div style={{ display: 'none' }}>
          <ReceiptPhoto
            receipt={{
              id: 'preview',
              userId: '',
              merchant: merchant || '—',
              category,
              property: 'hf-hotel',
              quantity: null,
              amount: parseFloat(amount),
              date: today,
              note: null,
              color: '#F5EBD9',
              accent: '#7E5E3A',
              items: [['—', amount]],
              tax: '0',
              photoPath: null,
              bundleId: null,
              createdAt: today,
            }}
          />
        </div>
      )}
    </div>
  );
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = (d.getMonth() + 1).toString().padStart(2, '0');
  const day = d.getDate().toString().padStart(2, '0');
  return `${y}-${m}-${day}`;
}
