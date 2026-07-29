import type { AppState, Theme, User } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { fmt, fmtN } from '../../lib/format';
import { FONT_DISPLAY, FONT_UI } from '../../lib/theme';
import { AppBar } from '../../components/AppBar';
import { Avatar, Card, Money, SectionHeader } from '../../components/primitives';
import { Icon } from '../../components/icons';
import { FONT_UI as FONT } from '../../lib/theme';
import { ReceiptPhoto } from '../../components/Receipts';
import { BundleRow } from './_shared';
import { EmptyState } from '../../components/EmptyState';

interface HomeProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  currentUser: User | null;
  isApprover?: boolean;
  onLogout?: () => void;
}

export function Home({ theme, state, nav, currentUser, isApprover, onLogout }: HomeProps) {
  const { receipts, bundles } = state;

  const loose = receipts.filter((r) => r.bundleId === null);
  const looseTotal = loose.reduce((s, r) => s + r.amount, 0);

  const pending = bundles.filter((b) => b.status === 'pending');
  const approved = bundles.filter((b) => b.status === 'approved');
  const paid = bundles.filter((b) => b.status === 'paid');
  const sumBundle = (b: { receipts: { amount: number }[] }) =>
    b.receipts.reduce((a, r) => a + r.amount, 0);
  const ytd = paid.reduce((s, b) => s + sumBundle(b), 0);

  // Money not yet received: drafts + submitted + approved-but-unpaid.
  const outstandingTotal =
    looseTotal +
    pending.reduce((s, b) => s + sumBundle(b), 0) +
    approved.reduce((s, b) => s + sumBundle(b), 0);

  const [outstandingWhole, outstandingFrac] = fmtN(outstandingTotal).split('.');

  return (
    <div style={{ paddingBottom: 100 }}>
      <AppBar
        theme={theme}
        large
        subtitle="ใบเบิกค่าใช้จ่าย"
        title={currentUser ? `สวัสดีค่ะ ${currentUser.name}` : 'สวัสดีค่ะ'}
        leading={<Avatar theme={theme} initials={currentUser?.initials ?? ''} />}
        trailing={
          <>
            {onLogout && !isApprover && (
              <button
                onClick={onLogout}
                title="ออกจากระบบ"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '8px 10px',
                  borderRadius: 100,
                  background: 'transparent',
                  color: theme.inkSoft,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 13,
                }}
              >
                ออก
              </button>
            )}
            {isApprover && (
              <button
                onClick={() => nav({ name: 'approver-home' })}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '8px 14px',
                  borderRadius: 100,
                  background: 'transparent',
                  color: theme.inkSoft,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: FONT,
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                กล่องอนุมัติ
              </button>
            )}
            <button
              onClick={() => nav({ name: 'upload' })}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 100,
                background: theme.accent,
                color: '#fff',
                border: 'none',
                cursor: 'pointer',
                fontFamily: FONT,
                fontSize: 13,
                fontWeight: 600,
                letterSpacing: 0.2,
              }}
            >
              {Icon.plus('#fff')}
              <span>ใหม่</span>
            </button>
          </>
        }
      />

      {/* Hero card */}
      <div style={{ padding: '14px 20px 0' }}>
        <div
          style={{
            background: theme.ink,
            color: theme.paper,
            borderRadius: 22,
            padding: '22px 22px 20px',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              position: 'absolute',
              right: -40,
              top: -40,
              width: 180,
              height: 180,
              borderRadius: '50%',
              background: theme.accent,
              opacity: 0.85,
            }}
          />
          <div
            style={{
              position: 'absolute',
              right: 30,
              top: 30,
              width: 120,
              height: 120,
              borderRadius: '50%',
              background: 'transparent',
              border: `1px solid ${theme.paper}`,
              opacity: 0.15,
            }}
          />
          <div style={{ position: 'relative' }}>
            <div
              style={{
                fontFamily: FONT_UI,
                fontSize: 11,
                letterSpacing: 1.4,
                textTransform: 'uppercase',
                opacity: 0.55,
                fontWeight: 500,
              }}
            >
              ยังไม่ได้เบิก
            </div>
            <div
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 56,
                fontWeight: 400,
                letterSpacing: -1.5,
                lineHeight: 1,
                marginTop: 8,
              }}
            >
              <span style={{ fontSize: 32, opacity: 0.55, marginRight: 6, verticalAlign: 'top' }}>฿</span>
              {outstandingWhole}
              <span style={{ opacity: 0.5 }}>.{outstandingFrac}</span>
            </div>
            <div
              style={{
                marginTop: 18,
                display: 'flex',
                gap: 18,
                fontFamily: FONT_UI,
                fontSize: 12,
                opacity: 0.7,
              }}
            >
              <span>
                {loose.length} ฉบับร่าง · {fmt(looseTotal)}
              </span>
              <span style={{ opacity: 0.4 }}>·</span>
              <span>{pending.length} รออนุมัติ</span>
            </div>
          </div>
        </div>
      </div>

      {/* Drafts */}
      <div style={{ padding: '0 20px' }}>
        <SectionHeader
          theme={theme}
          title={`ฉบับร่าง · ${loose.length}`}
          action={loose.length >= 1 ? <span onClick={() => nav({ name: 'bundle-new' })}>รวมชุด →</span> : null}
        />

        {loose.length === 0 && (
          <Card theme={theme} padding={28}>
            <EmptyState
              theme={theme}
              icon={Icon.camera}
              title="จัดการครบแล้ว"
              subtext="แตะปุ่มกล้องเพื่อเริ่มเบิกค่าใช้จ่ายใหม่"
            />
          </Card>
        )}

        {loose.length > 0 && (
          <div
            style={{
              display: 'flex',
              gap: 14,
              overflowX: 'auto',
              padding: '4px 0 8px',
              margin: '0 -20px',
              paddingLeft: 20,
              paddingRight: 20,
            }}
          >
            {loose.map((r, i) => (
              <div
                key={r.id}
                onClick={() => nav({ name: 'record', id: r.id })}
                style={{ cursor: 'pointer', flexShrink: 0 }}
              >
                <ReceiptPhoto receipt={r} height={216} slim rotate={i % 2 === 0 ? -1.5 : 1.5} />
                <div style={{ marginTop: 12, paddingLeft: 4 }}>
                  <div style={{ fontFamily: FONT_UI, fontSize: 13, fontWeight: 500, color: theme.ink }}>
                    {r.merchant}
                  </div>
                  <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSoft, marginTop: 2 }}>
                    {r.category} · {fmt(r.amount)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bundles */}
      <div style={{ padding: '0 20px' }}>
        <SectionHeader theme={theme} title="คำขอ" />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {bundles.map((b) => (
            <BundleRow
              key={b.id}
              bundle={b}
              theme={theme}
              onClick={() => nav({ name: 'bundle', id: b.id })}
            />
          ))}
        </div>
      </div>

      {/* YTD */}
      <div style={{ padding: '0 20px', marginTop: 24 }}>
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
                จ่ายแล้วตั้งแต่ต้นปี
              </div>
              <div style={{ marginTop: 6 }}>
                <Money value={ytd} theme={theme} size={28} weight={400} />
              </div>
            </div>
            <div style={{ fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>{paid.length} รายการ</div>
          </div>
        </Card>
      </div>
    </div>
  );
}
