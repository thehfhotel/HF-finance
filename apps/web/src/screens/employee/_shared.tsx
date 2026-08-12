import type { BundleWithDetails, Receipt, Theme } from '../../lib/types';
import { formatThaiDate } from '../../lib/format';
import { FONT_UI } from '../../lib/theme';
import { Card, Money, StatusPill } from '../../components/primitives';
import { ReceiptThumb } from '../../components/Receipts';
import { Icon } from '../../components/icons';

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
