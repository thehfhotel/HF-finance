import { useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import type { BundleWithDetails, Receipt, Theme } from '../../lib/types';
import { formatThaiDate } from '../../lib/format';
import { FONT_MONO, FONT_UI } from '../../lib/theme';
import { Card, Money, StatusPill } from '../../components/primitives';
import { ReceiptThumb } from '../../components/Receipts';
import { Icon } from '../../components/icons';
import { useVendorSuggestions } from '../../lib/useVendorSuggestions';

interface MerchantAutocompleteProps {
  theme: Theme;
  /** The field's current text — the query, and what a pick replaces. */
  value: string;
  onPick: (name: string) => void;
  children: ReactNode;
}

/**
 * Merchant suggestions under whichever ร้านค้า field it wraps.
 *
 * It wraps the field rather than replacing it: the input stays exactly what it
 * was, free text included. Picking a suggestion only fills in the spelling the
 * team already uses — no vendor id is posted, because the server resolves the
 * vendor from the saved string and that is the only path to one. Typing a shop
 * nobody has used yet is expected, and creates the vendor on save.
 */
export function MerchantAutocomplete({ theme, value, onPick, children }: MerchantAutocompleteProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  /** The query Escape dismissed. Scoped to that text so the next keystroke
   *  brings the list back — a dismissal is about this query, not the field. */
  const [dismissed, setDismissed] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const suggestions = useVendorSuggestions(value, open);
  const visible = open && dismissed !== value && suggestions.length > 0;

  const pick = (name: string) => {
    onPick(name);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      setDismissed(value);
      setOpen(false);
      return;
    }
    if (!visible) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (event.key === 'Enter' && active >= 0) {
      event.preventDefault();
      pick(suggestions[active].name);
    }
  };

  return (
    <div
      ref={containerRef}
      style={{ position: 'relative' }}
      onFocus={() => setOpen(true)}
      // Typing reopens as well as focus does. Picking a suggestion and Escape
      // both close the list while the caret stays in the field, and clicking an
      // already-focused input fires no focus event — so without this the list
      // could only ever open once per visit to the field.
      onInput={() => setOpen(true)}
      onBlur={(event) => {
        // A click on a suggestion blurs the input first; only a focus move out
        // of the whole field closes the list.
        if (!containerRef.current?.contains(event.relatedTarget as Node | null)) setOpen(false);
      }}
      onKeyDown={onKeyDown}
    >
      {children}
      {visible && (
        <div
          role="listbox"
          aria-label="ร้านค้าที่เคยบันทึกไว้"
          style={{
            position: 'absolute',
            top: 'calc(100% + 6px)',
            left: 0,
            right: 0,
            zIndex: 30,
            background: theme.surface,
            border: `0.5px solid ${theme.hairlineStrong}`,
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
          }}
        >
          {suggestions.map((vendor, index) => (
            <button
              key={vendor.id}
              role="option"
              aria-selected={index === active}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(vendor.name)}
              onMouseEnter={() => setActive(index)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                width: '100%',
                minHeight: 44,
                padding: '11px 14px',
                background: index === active ? theme.surface2 : 'transparent',
                border: 'none',
                borderTop: index === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                textAlign: 'left',
                cursor: 'pointer',
              }}
            >
              <span
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 13.5,
                  color: theme.ink,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {vendor.name}
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter, whiteSpace: 'nowrap' }}>
                {vendor.receiptCount} ใบเสร็จ
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

interface BundleRowProps {
  bundle: BundleWithDetails;
  theme: Theme;
  onClick: () => void;
}

export function BundleRow({ bundle, theme, onClick }: BundleRowProps) {
  const items = bundle.receipts;
  const total = items.reduce((s, r) => s + r.amount, 0);

  return (
    <Card theme={theme} padding={16} onClick={onClick}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
        <div style={{ position: 'relative', width: 50, height: 50, flexShrink: 0 }}>
          {items.slice(0, 3).map((r, i) => (
            <div
              key={r.id}
              style={{
                position: 'absolute',
                top: i * 3,
                left: i * 3,
                transform: `rotate(${(i - 1) * 4}deg)`,
                zIndex: 3 - i,
              }}
            >
              <ReceiptThumb receipt={r} size={44} />
            </div>
          ))}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
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
            <Money value={total} theme={theme} size={15} weight={500} />
          </div>
          <div style={{ marginTop: 6, display: 'flex', gap: 10, alignItems: 'center' }}>
            <StatusPill status={bundle.status} theme={theme} size="sm" />
            <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>
              {items.length} · {formatThaiDate(bundle.submittedAt)}
            </span>
          </div>
        </div>
      </div>
    </Card>
  );
}

interface SelectableReceiptRowProps {
  receipt: Receipt;
  theme: Theme;
  selected: boolean;
  onToggle: () => void;
}

export function SelectableReceiptRow({ receipt, theme, selected, onToggle }: SelectableReceiptRowProps) {
  return (
    <div
      onClick={onToggle}
      style={{
        padding: 14,
        borderRadius: 14,
        background: theme.surface,
        border: `1.5px solid ${selected ? theme.accent : 'transparent'}`,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        cursor: 'pointer',
        transition: 'border-color 0.12s',
      }}
    >
      <div
        style={{
          width: 22,
          height: 22,
          borderRadius: 11,
          background: selected ? theme.accent : 'transparent',
          border: `1.5px solid ${selected ? theme.accent : theme.hairlineStrong}`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexShrink: 0,
        }}
      >
        {selected && Icon.check('#fff')}
      </div>
      <ReceiptThumb receipt={receipt} size={48} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>{receipt.merchant}</div>
        <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
          {receipt.category} · {formatThaiDate(receipt.date)}
        </div>
      </div>
      <Money value={receipt.amount} theme={theme} size={15} />
    </div>
  );
}

interface TimelineProps {
  theme: Theme;
  bundle: BundleWithDetails;
}

export function Timeline({ theme, bundle }: TimelineProps) {
  type Step = { label: string; date: string | null | undefined; done: boolean };

  const steps: Step[] = [
    { label: 'ส่งแล้ว', date: bundle.submittedAt, done: true },
    {
      label: 'รออนุมัติ',
      date: bundle.status === 'pending' ? 'pending' : bundle.approvedAt,
      done: bundle.status !== 'pending',
    },
    { label: 'อนุมัติแล้ว', date: bundle.approvedAt, done: ['approved', 'paying', 'paid'].includes(bundle.status) },
    { label: 'จ่ายแล้ว', date: bundle.paidAt, done: bundle.status === 'paid' },
  ];

  return (
    <div>
      {steps.map((s, i) => {
        const active = s.done;
        const next = steps[i + 1];
        return (
          <div key={s.label} style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', alignSelf: 'stretch' }}>
              <div
                style={{
                  width: 14,
                  height: 14,
                  borderRadius: 7,
                  background: active ? theme.accent : 'transparent',
                  border: `1.5px solid ${active ? theme.accent : theme.hairlineStrong}`,
                  marginTop: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {active && <div style={{ width: 4, height: 4, borderRadius: 2, background: '#fff' }} />}
              </div>
              {i < steps.length - 1 && (
                <div
                  style={{
                    width: 1.5,
                    flex: 1,
                    minHeight: 20,
                    background: active && next?.done ? theme.accent : theme.hairlineStrong,
                    marginTop: 4,
                    marginBottom: 4,
                  }}
                />
              )}
            </div>
            <div style={{ flex: 1, paddingBottom: i < steps.length - 1 ? 14 : 0 }}>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 14,
                  fontWeight: 500,
                  color: active ? theme.ink : theme.inkSofter,
                }}
              >
                {s.label}
              </div>
              <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                {s.date && s.date !== 'pending' ? formatThaiDate(s.date) : s.date === 'pending' ? 'รอผู้อนุมัติ' : '—'}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
