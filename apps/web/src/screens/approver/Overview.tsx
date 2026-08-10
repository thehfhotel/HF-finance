import type { ReactNode } from 'react';
import type { AppState, BundleStatus, BundleWithDetails, Theme, User } from '../../lib/types';
import type { Nav } from '../../lib/router';
import { PROPERTY_LABELS } from '../../lib/types';
import { fmt, fmt0, formatThaiDate } from '../../lib/format';
import { FONT_DISPLAY, FONT_MONO, FONT_UI } from '../../lib/theme';
import { Avatar, Card, Money, StatusPill } from '../../components/primitives';
import { AppBar } from '../../components/AppBar';
import { EmptyState } from '../../components/EmptyState';
import { Icon } from '../../components/icons';
import {
  agingBuckets,
  ageBand,
  bundleTotal,
  byCategory,
  byProperty,
  bySubmitter,
  daysWaiting,
  oldestPending,
  paidByMonth,
  paidThisMonth,
  sumTotals,
} from '../../lib/stats';
import type { AgeBand, MonthPoint, NamedTotal } from '../../lib/stats';
import type { BundleStats } from '../../lib/api';

const THAI_MONTHS = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];

/** Server rows are sparse — a quiet month is simply absent — so fill the window
 *  to keep the line continuous rather than letting it skip. */
function monthPointsFrom(rows: Array<{ month: string; amount: number }>, months: number): MonthPoint[] {
  const byKey = new Map(rows.map((r) => [r.month, r.amount]));
  const now = new Date();
  const out: MonthPoint[] = [];
  for (let i = months - 1; i >= 0; i -= 1) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    out.push({ key, label: THAI_MONTHS[d.getMonth()], amount: byKey.get(key) ?? 0 });
  }
  return out;
}

/** Filters the sidebar/tabs understand — 'draft' is never a bundle status. */
export type OverviewFilter = Exclude<BundleStatus, 'draft'>;

const TRIAGE_LIMIT = 6;
const TREND_MONTHS = 12;

const bandColor = (theme: Theme, band: AgeBand): string =>
  band === 'hot' ? theme.danger : band === 'warm' ? theme.warn : theme.inkSofter;

// ── Small building blocks ───────────────────────────────────────────────────

function ZoneHeader({ theme, title }: { theme: Theme; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '26px 0 12px' }}>
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: 1.3,
          textTransform: 'uppercase',
          color: theme.inkSofter,
          whiteSpace: 'nowrap',
        }}
      >
        {title}
      </span>
      <span style={{ flex: 1, height: 0.5, background: theme.hairlineStrong }} />
    </div>
  );
}

function CardHeader({ theme, title, hint }: { theme: Theme; title: string; hint?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12 }}>
      <span style={{ fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 600, color: theme.ink }}>{title}</span>
      {hint && <span style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>{hint}</span>}
    </div>
  );
}

interface StatTileProps {
  theme: Theme;
  label: string;
  dot: string;
  value: string;
  sub: ReactNode;
  emphasis?: boolean;
  onClick?: () => void;
}

function StatTile({ theme, label, dot, value, sub, emphasis, onClick }: StatTileProps) {
  return (
    <button
      onClick={onClick}
      disabled={!onClick}
      style={{
        textAlign: 'left',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        background: theme.surface,
        border: `0.5px solid ${theme.hairline}`,
        borderRadius: 16,
        padding: '14px 15px',
        cursor: onClick ? 'pointer' : 'default',
        font: 'inherit',
      }}
    >
      <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
        <span style={{ width: 6, height: 6, borderRadius: 3, background: dot }} />
        <span style={{ fontFamily: FONT_UI, fontSize: 11.5, color: theme.inkSoft }}>{label}</span>
      </span>
      <span style={{ fontFamily: FONT_DISPLAY, fontSize: 30, fontWeight: 400, letterSpacing: -1, color: theme.ink, lineHeight: 1.1 }}>
        {value}
      </span>
      <span
        style={{
          fontFamily: FONT_UI,
          fontSize: 11.5,
          color: emphasis ? theme.warn : theme.inkSofter,
          fontWeight: emphasis ? 500 : 400,
        }}
      >
        {sub}
      </span>
    </button>
  );
}

/** Horizontal magnitude bar. One hue, length carries the value. */
function BarRow({
  theme,
  label,
  value,
  max,
  color,
  suffix,
}: {
  theme: Theme;
  label: string;
  value: number;
  max: number;
  color: string;
  suffix?: string;
}) {
  const pct = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, marginBottom: 5 }}>
        <span
          style={{
            fontFamily: FONT_UI,
            fontSize: 12,
            color: theme.inkSoft,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <span style={{ fontFamily: FONT_MONO, fontSize: 12, color: theme.ink, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
          {suffix ?? `฿${fmt0(value)}`}
        </span>
      </div>
      <div style={{ height: 9, borderRadius: 100, background: theme.hairline, overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 100, background: color }} />
      </div>
    </div>
  );
}

/** Trailing-12-month paid trend. Area + line, emphasized endpoint. */
function TrendChart({ theme, points }: { theme: Theme; points: MonthPoint[] }) {
  const W = 560;
  const H = 128;
  const PL = 6;
  const PR = 6;
  const PT = 12;
  const PB = 22;
  const iw = W - PL - PR;
  const ih = H - PT - PB;
  const max = Math.max(1, ...points.map((p) => p.amount)) * 1.12;
  const x = (i: number) => PL + (iw * i) / Math.max(1, points.length - 1);
  const y = (v: number) => PT + ih - (v / max) * ih;

  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)} ${y(p.amount).toFixed(1)}`).join(' ');
  const area = `${line} L${x(points.length - 1).toFixed(1)} ${(PT + ih).toFixed(1)} L${PL} ${(PT + ih).toFixed(1)} Z`;
  const lastX = x(points.length - 1);
  const lastY = y(points[points.length - 1]?.amount ?? 0);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }} role="img"
      aria-label={`ยอดจ่ายรายเดือน ${points.length} เดือนล่าสุด`}>
      <line x1={PL} y1={PT + ih} x2={W - PR} y2={PT + ih} stroke={theme.hairlineStrong} strokeWidth={0.5} />
      <path d={area} fill={theme.accent} opacity={0.07} />
      <path d={line} fill="none" stroke={theme.accent} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={lastX} cy={lastY} r={4} fill={theme.accent} stroke={theme.surface} strokeWidth={2} />
      {points.map((p, i) =>
        i % 2 === 0 ? (
          <text key={p.key} x={x(i).toFixed(1)} y={H - 6} fontSize={9} fill={theme.inkSofter}
            textAnchor="middle" fontFamily={FONT_MONO}>
            {p.label}
          </text>
        ) : null,
      )}
    </svg>
  );
}

// ── The overview body (shared by mobile and desktop) ────────────────────────

interface OverviewProps {
  theme: Theme;
  bundles: BundleWithDetails[];
  /** Server-computed totals and charts. The page used to derive these from the
   *  full bundle array, which is why the client downloaded the whole archive;
   *  `bundles` is now only a page and cannot answer them. */
  stats?: BundleStats | null;
  /** Open a bundle for review. */
  onOpenBundle: (id: string) => void;
  /** Jump the sidebar/tab to a status list. Omitted on mobile. */
  onSelectFilter?: (filter: OverviewFilter) => void;
  /** Horizontal padding; desktop pane wants more room than a phone. */
  padding?: string;
}

export function ApproverOverview({ theme, bundles, stats, onOpenBundle, onSelectFilter, padding = '24px 28px 48px' }: OverviewProps) {
  const pending = bundles.filter((b) => b.status === 'pending');
  const approved = bundles.filter((b) => b.status === 'approved');
  const paid = bundles.filter((b) => b.status === 'paid');
  const rejected = bundles.filter((b) => b.status === 'rejected');

  const totalPending = stats ? stats.pending.total : sumTotals(pending);
  const totalApproved = stats ? stats.approved.total : sumTotals(approved);
  const triage = oldestPending(pending, TRIAGE_LIMIT);
  const buckets = agingBuckets(pending);
  const bucketMax = Math.max(1, ...buckets.map((b) => b.count));
  const trend: MonthPoint[] = stats
    ? monthPointsFrom(stats.paidByMonth, TREND_MONTHS)
    : paidByMonth(bundles, TREND_MONTHS);
  const categories: NamedTotal[] = stats
    ? stats.byCategory.map((r) => ({ key: r.label, label: r.label, amount: r.amount }))
    : byCategory(bundles, 6);
  const people: NamedTotal[] = stats
    ? stats.bySubmitter.map((r) => ({ key: r.label, label: r.label, amount: r.amount }))
    : bySubmitter(bundles, 5);
  const props = stats ? stats.byProperty : byProperty(bundles);
  const propTotal = props['hf-hotel'] + props['hf-ville'];

  // Sequential ink ramp — darkest = largest. Magnitude, not identity.
  const seq = [theme.ink, theme.inkSoft, theme.inkSofter, theme.hairlineStrong, theme.hairlineStrong, theme.hairline];

  return (
    <div style={{ padding, maxWidth: 1080 }}>
      {/* KPI row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <StatTile
          theme={theme}
          label="รออนุมัติ"
          dot={theme.statusPending}
          value={String(stats ? stats.pending.count : pending.length)}
          sub={`${fmt(totalPending)} ค้าง`}
          emphasis={pending.length > 0}
          onClick={onSelectFilter ? () => onSelectFilter('pending') : undefined}
        />
        <StatTile
          theme={theme}
          label="พร้อมจ่าย"
          dot={theme.statusApproved}
          value={String(stats ? stats.approved.count : approved.length)}
          sub={approved.length > 0 ? `${fmt(totalApproved)} ต้องโอน` : 'ไม่มีค้าง'}
          emphasis={approved.length > 0}
          onClick={onSelectFilter ? () => onSelectFilter('approved') : undefined}
        />
        <StatTile
          theme={theme}
          label="จ่ายเดือนนี้"
          dot={theme.statusPaid}
          value={fmt0(paidThisMonth(bundles))}
          sub={`${stats ? stats.paid.count : paid.length} คำขอสะสม`}
          onClick={onSelectFilter ? () => onSelectFilter('paid') : undefined}
        />
        <StatTile
          theme={theme}
          label="ปฏิเสธ"
          dot={theme.statusRejected}
          value={String(stats ? stats.rejected.count : rejected.length)}
          sub="รอพนักงานส่งใหม่"
          onClick={onSelectFilter ? () => onSelectFilter('rejected') : undefined}
        />
      </div>

      {/* Triage */}
      <ZoneHeader theme={theme} title="ต้องจัดการก่อน" />
      <Card theme={theme} padding={16}>
        <CardHeader theme={theme} title="ค้างนานที่สุด" hint={pending.length ? 'เรียงจากรอนานสุด' : undefined} />
        {triage.length === 0 ? (
          <div style={{ padding: '18px 0', textAlign: 'center', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
            ไม่มีคำขอค้างอยู่ — เคลียร์หมดแล้ว
          </div>
        ) : (
          triage.map((b, i) => {
            const days = daysWaiting(b);
            const band = ageBand(days);
            const color = bandColor(theme, band);
            return (
              <button
                key={b.id}
                onClick={() => onOpenBundle(b.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '62px 1fr auto',
                  gap: 12,
                  alignItems: 'center',
                  width: '100%',
                  textAlign: 'left',
                  background: 'none',
                  border: 'none',
                  borderTop: i === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                  padding: '10px 0',
                  cursor: 'pointer',
                  font: 'inherit',
                }}
              >
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 11,
                    fontWeight: 600,
                    color,
                    background: `${color}1F`,
                    borderRadius: 100,
                    padding: '3px 0',
                    textAlign: 'center',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {days} วัน
                </span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter }}>
                    {b.submitter.name}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: FONT_UI,
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: theme.ink,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.name}
                  </span>
                </span>
                <Money value={bundleTotal(b)} theme={theme} size={15} />
              </button>
            );
          })
        )}
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title="คิวรออนุมัติ" hint={`${pending.length} รายการ`} />
          {buckets.map((b) => (
            <BarRow
              key={b.band}
              theme={theme}
              label={b.label}
              value={b.count}
              max={bucketMax}
              color={bandColor(theme, b.band)}
              suffix={String(b.count)}
            />
          ))}
        </Card>

        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title="ตามสาขา" hint="ยอดรวมทุกสถานะ" />
          <div style={{ display: 'flex', height: 26, borderRadius: 7, overflow: 'hidden', gap: 2, background: theme.hairline }}>
            {(['hf-hotel', 'hf-ville'] as const).map((key) => {
              const pct = propTotal > 0 ? (props[key] / propTotal) * 100 : 50;
              return (
                <div
                  key={key}
                  style={{
                    width: `${pct}%`,
                    background: key === 'hf-hotel' ? theme.statusApproved : theme.warn,
                    display: 'grid',
                    placeItems: 'center',
                    fontFamily: FONT_UI,
                    fontSize: 11,
                    fontWeight: 600,
                    color: '#fff',
                  }}
                >
                  {pct >= 12 ? `${Math.round(pct)}%` : ''}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginTop: 12 }}>
            {(['hf-hotel', 'hf-ville'] as const).map((key) => (
              <span key={key} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontFamily: FONT_UI, fontSize: 11.5, color: theme.inkSoft }}>
                <i
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 2.5,
                    display: 'inline-block',
                    background: key === 'hf-hotel' ? theme.statusApproved : theme.warn,
                  }}
                />
                {PROPERTY_LABELS[key]} · ฿{fmt0(props[key])}
              </span>
            ))}
          </div>
        </Card>
      </div>

      {/* Analytics */}
      <ZoneHeader theme={theme} title="สถิติการใช้จ่าย" />
      <Card theme={theme} padding={16}>
        <CardHeader theme={theme} title="ยอดจ่ายรายเดือน" hint={`${TREND_MONTHS} เดือนล่าสุด`} />
        <TrendChart theme={theme} points={trend} />
      </Card>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginTop: 12 }}>
        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title="ตามหมวดหมู่" hint="6 อันดับแรก" />
          {categories.length === 0 ? (
            <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>ยังไม่มีข้อมูล</div>
          ) : (
            categories.map((c, i) => (
              <BarRow key={c.key} theme={theme} label={c.label} value={c.amount} max={categories[0].amount} color={seq[i] ?? theme.hairline} />
            ))
          )}
        </Card>

        <Card theme={theme} padding={16}>
          <CardHeader theme={theme} title="ผู้เบิกสูงสุด" hint="5 อันดับแรก" />
          {people.length === 0 ? (
            <div style={{ fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>ยังไม่มีข้อมูล</div>
          ) : (
            people.map((p) => (
              <BarRow key={p.key} theme={theme} label={p.label} value={p.amount} max={people[0].amount} color={theme.inkSofter} />
            ))
          )}
        </Card>
      </div>

      {/* Recent activity — the newest movement across every status. */}
      <ZoneHeader theme={theme} title="ความเคลื่อนไหวล่าสุด" />
      <Card theme={theme} padding={0}>
        {[...bundles]
          .sort((a, b) => new Date(b.submittedAt).getTime() - new Date(a.submittedAt).getTime())
          .slice(0, 8)
          .map((b, i) => (
            <button
              key={b.id}
              onClick={() => onOpenBundle(b.id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 12,
                alignItems: 'center',
                width: '100%',
                textAlign: 'left',
                background: 'none',
                border: 'none',
                borderTop: i === 0 ? 'none' : `0.5px solid ${theme.hairline}`,
                padding: '12px 16px',
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              <span style={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 10 }}>
                <Avatar theme={theme} initials={b.submitter.initials} size={26} />
                <span style={{ minWidth: 0 }}>
                  <span
                    style={{
                      display: 'block',
                      fontFamily: FONT_UI,
                      fontSize: 13.5,
                      fontWeight: 500,
                      color: theme.ink,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.name}
                  </span>
                  <span style={{ display: 'block', fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter }}>
                    {b.submitter.name} · {formatThaiDate(b.submittedAt)}
                  </span>
                </span>
              </span>
              <StatusPill status={b.status} theme={theme} size="sm" />
              <Money value={bundleTotal(b)} theme={theme} size={14} />
            </button>
          ))}
      </Card>
    </div>
  );
}

// ── Mobile screen wrapper ───────────────────────────────────────────────────

interface OverviewScreenProps {
  theme: Theme;
  state: AppState;
  nav: Nav;
  currentUser: User | null;
  stats?: BundleStats | null;
}

export function Overview({ theme, state, nav, currentUser, stats }: OverviewScreenProps) {
  const bundles = state.bundles;
  return (
    <div style={{ position: 'absolute', inset: 0, overflowY: 'auto', paddingBottom: 72, background: theme.paper }}>
      <AppBar
        theme={theme}
        large
        subtitle="การเงิน · ผู้อนุมัติ"
        title="ภาพรวม"
        leading={<Avatar theme={theme} initials={currentUser?.initials ?? ''} />}
      />
      {bundles.length === 0 ? (
        <EmptyState theme={theme} icon={Icon.bundle} title="ยังไม่มีข้อมูล" subtext="เมื่อมีคำขอเข้ามา ภาพรวมจะแสดงที่นี่" />
      ) : (
        <ApproverOverview
          theme={theme}
          bundles={bundles}
          stats={stats}
          onOpenBundle={(id) => nav({ name: 'approver-review', id })}
          padding="4px 20px 32px"
        />
      )}
    </div>
  );
}
