import { useEffect, useRef } from 'react';
import type { BundleStatus, Theme } from '../../../lib/types';
import type { OverviewWindowKey } from '../../../lib/api';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { Avatar, Money } from '../../../components/primitives';
import { Baht, PillToggle, UnderlineToggle } from './_shared';
import { baht } from './format';
import { DrillRowView } from './DrillRow';
import type { DrillRow, DrillSelection, ResolvedDrill, SortKey } from './types';

/**
 * แผงคำขอ — the one shared panel behind every number on the page.
 *
 * In flow, never a modal and never a bottom sheet: the number and the requests
 * that make it up stay on screen together, and the back gesture is never
 * hijacked. It has no scroll container of its own — `ดูทั้งหมด` expands the
 * list in place and the page scrolls.
 */

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'ล่าสุด' },
  { key: 'amount', label: 'ยอดสูง' },
  { key: 'wait', label: 'รอนาน' },
];

function sortRows(rows: DrillRow[], key: SortKey): DrillRow[] {
  const out = rows.slice();
  if (key === 'amount') out.sort((a, b) => b.amount - a.amount);
  else if (key === 'wait') out.sort((a, b) => a.wait - b.wait);
  else out.sort((a, b) => b.sortDate - a.sortDate);
  return out;
}

interface DrillPanelProps {
  theme: Theme;
  id: string;
  drill: ResolvedDrill;
  sort: SortKey | null;
  expand: boolean;
  phone: boolean;
  onClose: () => void;
  onSort: (key: SortKey) => void;
  onExpand: () => void;
  onDrill: (sel: DrillSelection) => void;
  onToggleOrphan: (userId: string) => void;
  onOpenBundle: (id: string) => void;
  /** Desktop only — mobile has no inbox pane to hand off to. */
  onOpenInbox?: (filter: Exclude<BundleStatus, 'draft' | 'paying'>) => void;
  onJumpWindow: (window: OverviewWindowKey) => void;
}

export function DrillPanel({
  theme,
  id,
  drill,
  sort,
  expand,
  phone,
  onClose,
  onSort,
  onExpand,
  onDrill,
  onToggleOrphan,
  onOpenBundle,
  onOpenInbox,
  onJumpWindow,
}: DrillPanelProps) {
  const panelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
  }, [id]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sortKey: SortKey = sort ?? drill.defaultSort;
  const rows = drill.sortable ? sortRows(drill.rows, sortKey) : drill.rows;
  const limit = phone ? 5 : 6;
  const shown = expand ? rows.length : Math.min(rows.length, limit);
  const hairline = `0.5px solid ${theme.hairline}`;

  return (
    <section
      ref={panelRef}
      id={id}
      role="region"
      aria-label="แผงคำขอ"
      tabIndex={-1}
      style={{
        background: theme.surface,
        border: `0.5px solid ${theme.hairline}`,
        borderRadius: 18,
        overflow: 'hidden',
        marginTop: phone ? 10 : 0,
      }}
    >
      <div style={{ padding: '13px 15px 11px', borderBottom: hairline }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontFamily: FONT_UI,
              fontSize: 11,
              color: theme.inkSofter,
              lineHeight: 1.5,
              overflowWrap: 'anywhere',
            }}
          >
            {drill.path}
          </span>
          {/* 44×44 target that bleeds into the header's own padding, so it
              stays inside the card instead of overflowing it. */}
          <button
            onClick={onClose}
            aria-label="ปิดแผงคำขอ"
            style={{
              width: 44,
              height: 44,
              margin: '-13px -13px -8px 0',
              flex: '0 0 44px',
              display: 'grid',
              placeItems: 'center',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              fontFamily: FONT_UI,
              fontSize: 15,
              color: theme.inkSoft,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 5, flexWrap: 'wrap' }}>
          {drill.total !== null && (
            <Baht theme={theme} value={drill.total} size={21} weight={400} display letterSpacing={-0.5} />
          )}
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 12,
              color: theme.inkSoft,
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            {drill.countLabel ?? `${drill.count} คำขอ`}
          </span>
        </div>
        {drill.headline && (
          <div style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter, marginTop: 4 }}>
            {drill.headline}
          </div>
        )}
      </div>

      {drill.chips && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', padding: '2px 15px', borderBottom: hairline }}>
          {drill.chips.map((chip) => (
            <PillToggle
              key={chip.key}
              theme={theme}
              label={chip.label}
              active={chip.on}
              onClick={() => onDrill(chip.sel)}
            />
          ))}
        </div>
      )}

      {drill.mini && (
        <div style={{ padding: '10px 15px', borderBottom: hairline }}>
          <div style={{ fontFamily: FONT_UI, fontSize: 11, color: theme.inkSofter, marginBottom: 6 }}>
            {drill.mini.title}
          </div>
          {/* Buttons, not text: a ranked list that looks like a list of
              controls has to be one, and each row re-scopes the panel to that
              branch's slice of the category. */}
          {drill.mini.rows.map((row, i) => (
            <button
              key={row.key}
              onClick={() => onDrill(row.sel)}
              aria-pressed={row.on}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                minHeight: 44,
                padding: '6px 0',
                background: 'none',
                border: 'none',
                borderTop: i === 0 ? 'none' : hairline,
                textAlign: 'left',
                cursor: 'pointer',
                fontFamily: FONT_UI,
                fontSize: 12,
                fontWeight: row.on ? 600 : 400,
                color: row.on ? theme.ink : theme.inkSoft,
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{row.label}</span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11.5, fontVariantNumeric: 'tabular-nums' }}>
                {baht(row.amount)}
              </span>
            </button>
          ))}
        </div>
      )}

      {drill.sortable && drill.rows.length > 1 && (
        <div style={{ display: 'flex', gap: 16, padding: '0 15px', borderBottom: hairline }}>
          {SORTS.map((s) => (
            <UnderlineToggle
              key={s.key}
              theme={theme}
              label={s.label}
              size={11}
              mono
              active={sortKey === s.key}
              onClick={() => onSort(s.key)}
            />
          ))}
        </div>
      )}

      {drill.receiptGroups ? (
        drill.receiptGroups.map((group, i) => (
          <div key={group.userId}>
            <button
              onClick={() => onToggleOrphan(group.userId)}
              aria-expanded={group.open}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto auto',
                gap: 10,
                alignItems: 'center',
                width: '100%',
                minHeight: 44,
                padding: '11px 15px',
                background: 'none',
                // Shorthand FIRST: React writes inline properties in key order,
                // so a `border` after `borderTop` erases the separator.
                border: 'none',
                borderTop: i === 0 ? 'none' : hairline,
                textAlign: 'left',
                font: 'inherit',
                cursor: 'pointer',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                <Avatar theme={theme} initials={group.initials} size={26} />
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: 'block', fontFamily: FONT_UI, fontSize: 13.5, fontWeight: 500, color: theme.ink }}>
                    {group.name}
                  </span>
                  <span style={{ display: 'block', fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter }}>
                    {group.count} ใบ · {baht(group.total)} · เก่าสุด {group.oldestDays} วัน
                  </span>
                </span>
              </span>
              <span style={{ fontFamily: FONT_MONO, fontSize: 11, color: theme.inkSofter }}>
                {group.open ? 'ซ่อน' : 'ดูใบเสร็จ'}
              </span>
              <Money value={group.total} theme={theme} size={14} />
            </button>
            {group.open && (
              <>
                {group.receipts.map((row) => (
                  <DrillRowView key={row.key} theme={theme} row={row} />
                ))}
                {group.overflow > 0 && (
                  <div
                    style={{
                      padding: '9px 15px 11px 61px',
                      borderTop: hairline,
                      fontFamily: FONT_MONO,
                      fontSize: 11,
                      color: theme.inkSofter,
                    }}
                  >
                    แสดง {group.receipts.length} จาก {group.count} ใบเสร็จ
                  </div>
                )}
              </>
            )}
          </div>
        ))
      ) : rows.length > 0 ? (
        rows.slice(0, shown).map((row, i) => (
          <DrillRowView key={row.key} theme={theme} row={row} onOpen={onOpenBundle} first={i === 0} />
        ))
      ) : (
        <div style={{ padding: '18px 15px', fontFamily: FONT_UI, fontSize: 13, color: theme.inkSofter }}>
          {drill.empty?.message ?? 'ไม่มีคำขอในช่วงนี้'}
          {drill.empty?.jump && (
            <button
              onClick={() => onJumpWindow('week')}
              style={{
                display: 'block',
                marginTop: 8,
                minHeight: 44,
                background: 'none',
                border: 'none',
                padding: 0,
                cursor: 'pointer',
                fontFamily: FONT_UI,
                fontSize: 12.5,
                color: theme.inkSoft,
              }}
            >
              ดูสัปดาห์นี้แทน →
            </button>
          )}
        </div>
      )}

      {rows.length > shown && (
        <div style={{ padding: '11px 15px', borderTop: hairline }}>
          <button
            onClick={onExpand}
            style={{
              background: 'none',
              border: 'none',
              padding: 0,
              minHeight: 44,
              cursor: 'pointer',
              fontFamily: FONT_UI,
              fontSize: 12,
              color: theme.inkSoft,
            }}
          >
            ดูทั้งหมด ({rows.length}) →
          </button>
        </div>
      )}

      {rows.length <= shown && drill.overflow > 0 && (
        <div style={{ padding: '11px 15px', borderTop: hairline, fontFamily: FONT_UI, fontSize: 12, color: theme.inkSoft }}>
          {onOpenInbox ? (
            <button
              onClick={() => onOpenInbox(drill.inboxFilter)}
              style={{
                background: 'none',
                border: 'none',
                padding: 0,
                minHeight: 44,
                cursor: 'pointer',
                font: 'inherit',
              }}
            >
              แสดง {rows.length} จาก {rows.length + drill.overflow} · เปิดในกล่องอนุมัติ →
            </button>
          ) : (
            // No inbox pane to hand off to on the phone, and pushing the route
            // would lose the page — so the escape states the fact instead.
            <span>
              แสดง {rows.length} จาก {rows.length + drill.overflow} · เปิดในกล่องอนุมัติ
            </span>
          )}
        </div>
      )}
    </section>
  );
}
