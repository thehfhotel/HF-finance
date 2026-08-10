import { useState } from 'react';
import type { AppState, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmtN, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { AppBar } from '../../components/AppBar';
import { Card, DetailRow, GhostButton, IconBtn, PrimaryButton, SectionHeader } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { ReceiptPhoto } from '../../components/Receipts';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { api } from '../../lib/api';

interface RecordDetailProps {
  theme: Theme;
  state: AppState;
  setState: (updater: (s: AppState) => AppState) => void;
  nav: Nav;
  recordId: string;
}

export function RecordDetail({ theme, state, setState, nav, recordId }: RecordDetailProps) {
  const r = state.receipts.find((x) => x.id === recordId);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  if (!r) return null;
  const isDraft = r.bundleId === null;
  const parentBundle = r.bundleId ? state.bundles.find((b) => b.id === r.bundleId) ?? null : null;
  const backRoute: Parameters<Nav>[0] = parentBundle
    ? { name: 'bundle', id: parentBundle.id }
    : { name: 'home' };
  const [whole, frac] = fmtN(r.amount).split('.');

  const handleDelete = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.receipts.delete(r.id);
      setState((s) => ({ ...s, receipts: s.receipts.filter((x) => x.id !== r.id) }));
      nav({ name: 'home' });
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'เกิดข้อผิดพลาด');
      setDeleting(false);
    }
  };

  return (
    <div style={{ paddingBottom: 100 }}>
      <AppBar
        theme={theme}
        title="ใบเสร็จ"
        leading={
          <IconBtn theme={theme} onClick={() => nav(backRoute)}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
      />

      <div style={{ display: 'flex', justifyContent: 'center', padding: '8px 20px 28px' }}>
        <ReceiptPhoto receipt={r} height={300} />
      </div>

      <div style={{ padding: '0 20px', textAlign: 'center', marginBottom: 28 }}>
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
          {r.merchant}
        </div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 64,
            fontWeight: 400,
            letterSpacing: -1.8,
            color: theme.ink,
            lineHeight: 1,
          }}
        >
          <span style={{ fontSize: 36, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
          {whole}
          <span style={{ opacity: 0.5 }}>.{frac}</span>
        </div>
      </div>

      <div style={{ padding: '0 20px' }}>
        <Card theme={theme} padding={0}>
          <DetailRow theme={theme} label="หมวดหมู่" value={r.category} />
          <DetailRow theme={theme} label="วันที่" value={formatThaiDate(r.date)} />
          <DetailRow theme={theme} label="หมายเหตุ" value={r.note || '—'} />
          <DetailRow
            theme={theme}
            label="สถานะ"
            value={parentBundle ? `อยู่ในชุด · ${parentBundle.name}` : 'รายการใหม่ · ยังไม่ได้รวม'}
            last
          />
        </Card>

        {r.items.length > 0 && (
          <>
            <SectionHeader theme={theme} title="รายการ" />
            <Card theme={theme} padding={0}>
              {r.items.map(([label, val], i) => (
                <div
                  key={i}
                  style={{
                    padding: '14px 18px',
                    borderBottom: i < r.items.length - 1 ? `0.5px solid ${theme.hairline}` : 'none',
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontFamily: FONT_UI,
                  }}
                >
                  <span style={{ color: theme.ink, fontSize: 14 }}>{label}</span>
                  <span
                    style={{
                      color: theme.ink,
                      fontSize: 14,
                      fontVariantNumeric: 'tabular-nums',
                    }}
                  >
                    ฿{val}
                  </span>
                </div>
              ))}
            </Card>
          </>
        )}
      </div>

      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {isDraft && (
          <PrimaryButton theme={theme} onClick={() => nav({ name: 'bundle-new', id: r.id })}>
            เพิ่มในชุดเบิก
          </PrimaryButton>
        )}

        {isDraft && (
          <>
            <GhostButton theme={theme} full onClick={() => nav({ name: 'upload', editId: r.id })}>
              แก้ไข
            </GhostButton>
            <button
              onClick={() => { setDeleteError(null); setShowDeleteDialog(true); }}
              style={{
                width: '100%',
                padding: '14px 20px',
                borderRadius: 14,
                border: `1px solid ${theme.danger}`,
                background: 'transparent',
                color: theme.danger,
                fontFamily: FONT_UI,
                fontSize: 15,
                fontWeight: 500,
                cursor: 'pointer',
                letterSpacing: 0.1,
              }}
            >
              ลบรายการใหม่
            </button>
            {deleteError && (
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 13,
                  color: theme.danger,
                  textAlign: 'center',
                  marginTop: 4,
                }}
              >
                {deleteError}
              </div>
            )}
          </>
        )}
      </div>

      {showDeleteDialog && (
        <ConfirmDialog
          theme={theme}
          title="ลบรายการนี้?"
          message="ใบเสร็จนี้จะถูกลบถาวรและไม่สามารถกู้คืนได้"
          confirmLabel="ลบ"
          danger
          loading={deleting}
          onConfirm={handleDelete}
          onCancel={() => { if (!deleting) setShowDeleteDialog(false); }}
        />
      )}
    </div>
  );
}
