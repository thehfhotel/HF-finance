import type { OverviewStats } from '../../../lib/api';
import type { Theme } from '../../../lib/types';
import { FONT_UI } from '../../../lib/theme';
import { Card } from '../../../components/primitives';
import { BarRow, CardHeader, FootNote } from './_shared';
import { baht } from './format';
import type { DrillSelection } from './types';

/**
 * §9 ใครยังรอเงินอยู่ — ranked by LONGEST WAIT, not by amount.
 *
 * The order encodes the obligation, not the size of it: someone owed ฿600 for
 * eleven days outranks someone owed ฿9,000 since this morning. Window-immune
 * (a debt does not belong to a period) but branch-responsive like every other
 * baht figure. APPROVED only — money already in flight belongs to the กำลังโอน
 * tile and is never counted twice.
 */

interface OwedCardProps {
  theme: Theme;
  stats: OverviewStats;
  drill: DrillSelection | null;
  onDrill: (sel: DrillSelection) => void;
  drillId?: string;
}

export function OwedCard({ theme, stats, drill, onDrill, drillId }: OwedCardProps) {
  const list = stats.owed;
  const selected = drill?.t === 'owed' ? drill.key : null;
  const total = list.reduce((acc, person) => acc + person.total, 0);
  const oldest = list.length > 0 ? list[0].oldestDays : 0;
  const max = Math.max(1, ...list.map((person) => person.total));

  return (
    <Card theme={theme} padding={16}>
      <CardHeader
        theme={theme}
        title="ใครยังรอเงินอยู่"
        hint={list.length > 0 ? `${baht(total)} · เก่าสุด ${oldest} วัน` : undefined}
        scope
      />
      {list.length === 0 ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '12px 0',
            fontFamily: FONT_UI,
            fontSize: 13,
            color: theme.inkSoft,
          }}
        >
          <i style={{ width: 6, height: 6, borderRadius: 3, background: theme.success }} />
          จ่ายคืนครบทุกคนแล้ว
        </div>
      ) : (
        <>
          {list.map((person) => (
            <BarRow
              key={person.userId}
              theme={theme}
              label={person.name}
              value={person.total}
              max={max}
              valueText={baht(person.total)}
              sub={`รอ ${person.oldestDays} วัน`}
              avatarInitials={person.initials}
              selected={selected === person.userId}
              dimmed={selected !== null && selected !== person.userId}
              onClick={() => onDrill({ t: 'owed', key: person.userId })}
              controls={drillId}
            />
          ))}
          <FootNote theme={theme}>เรียงตามรอนานสุด ไม่ใช่ยอดสูงสุด · ไม่ขึ้นกับช่วงเวลาด้านบน</FootNote>
        </>
      )}
    </Card>
  );
}
