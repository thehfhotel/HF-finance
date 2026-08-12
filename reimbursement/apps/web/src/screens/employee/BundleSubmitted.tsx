import type { AppState, Theme } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmt } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { GhostButton, PrimaryButton } from '../../components/primitives';
import { ReceiptPhoto } from '../../components/Receipts';

interface BundleSubmittedProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  bundleId: string;
}

export function BundleSubmitted({ theme, state, nav, bundleId }: BundleSubmittedProps) {
  const b = state.bundles.find((x) => x.id === bundleId);
  if (!b) return null;
  const items = b.receipts;
  const total = items.reduce((s, r) => s + r.amount, 0);

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
        <div style={{ position: 'relative', width: 180, height: 220, marginBottom: 36 }}>
          {items.slice(0, 3).map((r, i) => (
            <div
              key={r.id}
              style={{
                position: 'absolute',
                inset: 0,
                transform: `rotate(${(i - 1) * 6}deg) translateY(${i * 4}px)`,
                transformOrigin: 'bottom center',
                zIndex: items.length - i,
              }}
            >
              <ReceiptPhoto receipt={r} height={220} slim />
            </div>
          ))}
        </div>
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
          ส่งแล้ว
        </div>
        <h1
          style={{
            margin: 0,
            fontFamily: FONT_DISPLAY,
            fontWeight: 400,
            fontSize: 38,
            lineHeight: 1.1,
            letterSpacing: -0.6,
            color: theme.ink,
            textAlign: 'center',
          }}
        >
          ส่งให้
          <br />
          ฝ่ายการเงินแล้ว
        </h1>
        <div
          style={{
            fontFamily: FONT_UI,
            fontSize: 14,
            color: theme.inkSoft,
            marginTop: 14,
            textAlign: 'center',
            maxWidth: 280,
            lineHeight: 1.5,
          }}
        >
          {fmt(total)} จาก {items.length} ใบเสร็จ — จะแจ้งเตือนเมื่อมีการตรวจสอบ
        </div>
      </div>
      <div style={{ padding: '0 20px 30px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <PrimaryButton theme={theme} onClick={() => nav({ name: 'bundle', id: b.id })}>
          ดูคำขอ
        </PrimaryButton>
        <GhostButton theme={theme} full onClick={() => nav({ name: 'home' })}>
          กลับหน้าหลัก
        </GhostButton>
      </div>
    </div>
  );
}
