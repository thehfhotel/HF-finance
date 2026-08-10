import type { AppState, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmtN, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { AppBar } from '../../components/AppBar';
import { Card, IconBtn, Money, SectionHeader, StatusPill } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { ReceiptThumb } from '../../components/Receipts';
import { Timeline } from './_shared';

interface BundleDetailProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  bundleId: string;
}

export function BundleDetail({ theme, state, nav, bundleId }: BundleDetailProps) {
  const b = state.bundles.find((x) => x.id === bundleId);
  if (!b) return null;
  const items = b.receipts;
  const total = items.reduce((s, r) => s + r.amount, 0);
  const [whole, frac] = fmtN(total).split('.');

  return (
    <div style={{ paddingBottom: 60 }}>
      <AppBar
        theme={theme}
        leading={
          <IconBtn theme={theme} onClick={() => nav({ name: 'home' })}>
            {Icon.back(theme.ink)}
          </IconBtn>
        }
        title={null}
      />

      <div style={{ padding: '0 20px 18px' }}>
        <StatusPill status={b.status} theme={theme} />
        <h1
          style={{
            margin: '10px 0 6px',
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 36,
            lineHeight: 1.05,
            letterSpacing: -0.6,
            color: theme.ink,
          }}
        >
          {b.name}
        </h1>
        <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSoft }}>
          ส่งเมื่อ {formatThaiDate(b.submittedAt)} · {items.length} ใบเสร็จ
        </div>
      </div>

      {b.status === 'rejected' && (
        <div style={{ padding: '0 20px 16px' }}>
          <div
            style={{
              padding: '14px 16px',
              borderRadius: 12,
              background: `${theme.danger}14`,
              border: `1px solid ${theme.danger}40`,
              display: 'flex',
              gap: 10,
              alignItems: 'flex-start',
            }}
          >
            <div
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                background: theme.danger,
                flexShrink: 0,
                marginTop: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#fff',
                fontSize: 11,
                fontFamily: FONT_UI,
                fontWeight: 700,
              }}
            >
              !
            </div>
            <div>
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  fontWeight: 600,
                  color: theme.danger,
                  letterSpacing: 0.2,
                  marginBottom: b.rejectReason ? 4 : 0,
                }}
              >
                ถูกปฏิเสธ
              </div>
              {b.rejectReason && (
                <div
                  style={{
                    fontFamily: FONT_UI,
                    fontSize: 13,
                    color: theme.ink,
                    lineHeight: 1.5,
                  }}
                >
                  เหตุผลที่ปฏิเสธ: {b.rejectReason}
                </div>
              )}
              <div
                style={{
                  fontFamily: FONT_UI,
                  fontSize: 12,
                  color: theme.inkSoft,
                  lineHeight: 1.5,
                  marginTop: 6,
                }}
              >
                ใบเสร็จถูกส่งกลับไปยังรายการใหม่แล้ว — แก้ไขและส่งใหม่ได้จากหน้าหลัก
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{ padding: '0 20px 20px' }}>
        <Card theme={theme} padding={20}>
          <Timeline theme={theme} bundle={b} />
        </Card>
      </div>

      <div style={{ padding: '0 20px 8px' }}>
        <SectionHeader theme={theme} title="ยอดรวม" />
        <Card theme={theme} padding={20}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 44,
                fontWeight: 400,
                letterSpacing: -1.2,
                color: theme.ink,
                lineHeight: 1,
              }}
            >
              <span style={{ fontSize: 26, opacity: 0.5, marginRight: 4, verticalAlign: 'top' }}>฿</span>
              {whole}
              <span style={{ opacity: 0.5 }}>.{frac}</span>
            </div>
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, textAlign: 'right' }}>
              บาท
              <br />
              {items.length} รายการ
            </div>
          </div>
          {b.status === 'paid' && b.transferRef && (
            <div
              style={{
                marginTop: 14,
                paddingTop: 14,
                borderTop: `0.5px solid ${theme.hairline}`,
                display: 'flex',
                justifyContent: 'space-between',
                fontFamily: FONT_UI,
                fontSize: 13,
              }}
            >
              <span style={{ color: theme.inkSoft }}>โอนผ่านธนาคาร</span>
              <span style={{ color: theme.ink }}>{b.transferRef}</span>
            </div>
          )}
          {b.status === 'paid' && b.transferProofPath && (
            <div style={{ marginTop: 14 }}>
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
                หลักฐานการโอน
              </div>
              <img
                src={b.transferProofPath}
                alt="หลักฐานการโอน"
                style={{ width: '100%', borderRadius: 10, display: 'block' }}
              />
            </div>
          )}
        </Card>
      </div>

      <div style={{ padding: '0 20px' }}>
        <SectionHeader theme={theme} title={`ใบเสร็จ · ${items.length}`} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map((r) => (
            <Card key={r.id} theme={theme} padding={14} onClick={() => nav({ name: 'record', id: r.id })}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <ReceiptThumb receipt={r} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontFamily: FONT_UI, fontSize: 14, fontWeight: 500, color: theme.ink }}>
                    {r.merchant}
                  </div>
                  <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft, marginTop: 2 }}>
                    {r.category} · {formatThaiDate(r.date)}
                  </div>
                </div>
                <Money value={r.amount} theme={theme} size={16} weight={500} />
              </div>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
