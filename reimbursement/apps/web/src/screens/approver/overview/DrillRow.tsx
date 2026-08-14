import type { CSSProperties, ReactNode } from 'react';
import type { Theme } from '../../../lib/types';
import { FONT_MONO, FONT_UI } from '../../../lib/theme';
import { Avatar, Money, StatusPill } from '../../../components/primitives';
import { MetaChip } from './_shared';
import { thaiDuration } from './format';
import type { DrillRow } from './types';

/**
 * The page has exactly ONE row anatomy — avatar, name over meta, an optional
 * chip, the status pill, and the amount — shared by the drill panel and the
 * recent-activity list. Money is the app's `Money` primitive, satang at half
 * opacity, so a row here is pixel-comparable with the review screen.
 *
 * A row with no `bundleId` has nothing to open: a loose receipt, or a withdrawn
 * bundle that survives only as an audit event. It renders as a div with its
 * name in `inkSofter` and a plain label where the pill would be — never a
 * button that goes nowhere.
 */

interface DrillRowViewProps {
  theme: Theme;
  row: DrillRow;
  onOpen?: (id: string) => void;
  first?: boolean;
}

export function DrillRowView({ theme, row, onOpen, first }: DrillRowViewProps) {
  const navigable = row.bundleId !== null && onOpen !== undefined;

  const shell: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: '1fr auto auto auto',
    gap: 10,
    alignItems: 'center',
    width: '100%',
    minHeight: 44,
    padding: '11px 15px',
    background: 'none',
    // Shorthand FIRST: React writes inline properties in key order, so a
    // `border` after `borderTop` resets the row separator to nothing.
    border: 'none',
    borderTop: first ? 'none' : `0.5px solid ${theme.hairline}`,
    textAlign: 'left',
    font: 'inherit',
    cursor: navigable ? 'pointer' : 'default',
  };

  const body: ReactNode = (
    <>
      <span
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          minWidth: 0,
          paddingLeft: row.indent ? 36 : 0,
        }}
      >
        {row.initials !== '' && <Avatar theme={theme} initials={row.initials} size={26} />}
        <span style={{ minWidth: 0 }}>
          <span
            style={{
              display: 'block',
              fontFamily: FONT_UI,
              fontSize: 13.5,
              fontWeight: navigable ? 500 : 400,
              color: navigable ? theme.ink : theme.inkSofter,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.name}
          </span>
          <span
            style={{
              display: 'block',
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: theme.inkSofter,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {row.meta}
          </span>
        </span>
      </span>

      {row.chip ? <MetaChip theme={theme} text={row.chip.text} tone={row.chip.tone} /> : <span />}

      {row.note ? (
        <span style={{ fontFamily: FONT_MONO, fontSize: 10.5, color: theme.inkSofter, whiteSpace: 'nowrap' }}>
          {row.note}
        </span>
      ) : row.status ? (
        <StatusPill status={row.status} theme={theme} size="sm" />
      ) : (
        <span />
      )}

      <span>
        {row.durationSec !== undefined ? (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 13,
              color: theme.ink,
              fontVariantNumeric: 'tabular-nums',
              whiteSpace: 'nowrap',
            }}
          >
            {thaiDuration(row.durationSec)}
          </span>
        ) : (
          <Money value={row.amount} theme={theme} size={14} />
        )}
      </span>
    </>
  );

  if (!navigable) return <div style={shell}>{body}</div>;
  return (
    <button style={shell} onClick={() => onOpen?.(row.bundleId as string)}>
      {body}
    </button>
  );
}
