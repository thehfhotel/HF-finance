import { fmt0, fmtN } from '../lib/format';
import type { Receipt } from '../lib/types';

/**
 * Ask the API for a thumbnail instead of the original camera photo.
 *
 * Receipt photos are multi-megabyte originals; a list rendering them at 32px
 * was downloading and decoding all of it. Widths must match the API's
 * allowlist (96 / 320 / 800) — anything else silently serves the original.
 * Pass no width when the user is actually looking at the photo.
 */
export function photoSrc(path: string, width?: 96 | 320 | 800): string {
  return width ? `${path}?w=${width}` : path;
}

interface ReceiptPhotoProps {
  receipt: Receipt;
  height?: number;
  rotate?: number;
  slim?: boolean;
}

export function ReceiptPhoto({ receipt, height = 200, rotate = 0, slim = false }: ReceiptPhotoProps) {
  const w = slim ? 168 : 220;
  const h = height;

  // If user uploaded a real photo, display it inside the same paper-style frame.
  if (receipt.photoPath) {
    return (
      <div
        style={{
          position: 'relative',
          transform: `rotate(${rotate}deg)`,
          transformOrigin: 'center',
          filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.18)) drop-shadow(0 1px 2px rgba(0,0,0,0.1))',
          width: w,
          height: h,
          background: '#FFFFFF',
          borderRadius: 6,
          overflow: 'hidden',
        }}
      >
        <img
          src={photoSrc(receipt.photoPath, 320)}
          alt={receipt.merchant}
          loading="lazy"
          decoding="async"
          width={w}
          height={h}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
    );
  }

  return (
    <div
      style={{
        position: 'relative',
        transform: `rotate(${rotate}deg)`,
        transformOrigin: 'center',
        filter: 'drop-shadow(0 6px 16px rgba(0,0,0,0.18)) drop-shadow(0 1px 2px rgba(0,0,0,0.1))',
      }}
    >
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        <defs>
          <pattern id={`paper-${receipt.id}`} x="0" y="0" width="6" height="6" patternUnits="userSpaceOnUse">
            <rect width="6" height="6" fill={receipt.color} />
            <circle cx="3" cy="3" r="0.4" fill="rgba(0,0,0,0.04)" />
          </pattern>
          <clipPath id={`clip-${receipt.id}`}>
            <path d={zigzagPath(w, h)} />
          </clipPath>
        </defs>
        <g clipPath={`url(#clip-${receipt.id})`}>
          <rect width={w} height={h} fill={`url(#paper-${receipt.id})`} />
          <ReceiptContent receipt={receipt} w={w} h={h} />
        </g>
      </svg>
    </div>
  );
}

function zigzagPath(w: number, h: number): string {
  const tooth = 6;
  let d = `M 0 ${tooth}`;
  for (let x = 0; x < w; x += tooth * 2) {
    d += ` L ${x + tooth} 0 L ${x + tooth * 2} ${tooth}`;
  }
  d += ` L ${w} ${h - tooth}`;
  for (let x = w; x > 0; x -= tooth * 2) {
    d += ` L ${x - tooth} ${h} L ${x - tooth * 2} ${h - tooth}`;
  }
  d += ` Z`;
  return d;
}

function ReceiptContent({ receipt, w, h }: { receipt: Receipt; w: number; h: number }) {
  const inkOnPaper =
    receipt.color === '#1F2937' || receipt.color === '#0F0F10' || receipt.color === '#0A2E5C';
  const ink = inkOnPaper ? '#F4F1EA' : '#1F1B16';
  const accent = receipt.accent;
  const muted = inkOnPaper ? 'rgba(244,241,234,0.55)' : 'rgba(31,27,22,0.55)';
  const fontFamily = 'Arial, sans-serif';

  const px = 14;
  const y = 22;

  return (
    <g>
      <text
        x={w / 2}
        y={y}
        textAnchor="middle"
        fill={ink}
        style={{ fontFamily, fontSize: 16, fontWeight: 400, letterSpacing: 0.3 }}
      >
        {receipt.merchant}
      </text>
      <text
        x={w / 2}
        y={y + 14}
        textAnchor="middle"
        fill={muted}
        style={{ fontFamily, fontSize: 8, letterSpacing: 1.5, textTransform: 'uppercase' }}
      >
        {receipt.category} · {receipt.date.slice(5)}
      </text>

      <line x1={px} y1={y + 26} x2={w - px} y2={y + 26} stroke={muted} strokeDasharray="2 2" strokeWidth="0.5" />

      {receipt.items.slice(0, 4).map(([label, val], i) => (
        <g key={i}>
          <text x={px} y={y + 42 + i * 14} fill={ink} style={{ fontFamily, fontSize: 8.5 }}>
            {label.length > 22 ? label.slice(0, 21) + '…' : label}
          </text>
          <text
            x={w - px}
            y={y + 42 + i * 14}
            textAnchor="end"
            fill={ink}
            style={{ fontFamily, fontSize: 8.5, fontWeight: 600 }}
          >
            {val}
          </text>
        </g>
      ))}

      <rect x={px} y={h - 60} width={w - px * 2} height="0.5" fill={muted} />
      <text
        x={px}
        y={h - 44}
        fill={muted}
        style={{ fontFamily, fontSize: 8, letterSpacing: 1, textTransform: 'uppercase' }}
      >
        รวม
      </text>
      <text x={w - px} y={h - 44} textAnchor="end" fill={accent} style={{ fontFamily, fontSize: 18, fontWeight: 500 }}>
        ฿{fmtN(receipt.amount)}
      </text>

      <g transform={`translate(${px}, ${h - 32})`}>
        {Array.from({ length: 28 }).map((_, i) => {
          const widths = [1, 2, 1, 3, 1, 2, 1, 1, 2, 1, 3, 1, 2, 1, 2, 1, 3, 2, 1, 2, 1, 1, 3, 1, 2, 1, 2, 1];
          const x = widths.slice(0, i).reduce((a, b) => a + b + 0.5, 0);
          return <rect key={i} x={x} y={0} width={widths[i] * 0.7} height="14" fill={ink} />;
        })}
      </g>
      <text x={px} y={h - 12} fill={muted} style={{ fontFamily, fontSize: 7, letterSpacing: 1 }}>
        #{receipt.id.toUpperCase()}-{(parseInt(receipt.id.slice(1) || '0', 10) * 28371).toString().slice(0, 6)}
      </text>
    </g>
  );
}

interface ReceiptThumbProps {
  receipt: Receipt;
  size?: number;
}

export function ReceiptThumb({ receipt, size = 56 }: ReceiptThumbProps) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 12,
        background: receipt.color,
        position: 'relative',
        overflow: 'hidden',
        flexShrink: 0,
        boxShadow: 'inset 0 0 0 0.5px rgba(0,0,0,0.1)',
      }}
    >
      {receipt.photoPath ? (
        <img
          src={photoSrc(receipt.photoPath, 96)}
          alt={receipt.merchant}
          loading="lazy"
          decoding="async"
          width={size}
          height={size}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            alignItems: 'center',
            padding: 6,
          }}
        >
          <div
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 9,
              color: receipt.accent,
              textAlign: 'center',
              lineHeight: 1.0,
              letterSpacing: 0.2,
            }}
          >
            {receipt.merchant.split(' ')[0]}
          </div>
          <div
            style={{
              fontFamily: 'Arial, sans-serif',
              fontSize: 8,
              fontWeight: 600,
              color: receipt.accent,
              marginTop: 4,
              letterSpacing: 0.3,
            }}
          >
            ฿{fmt0(receipt.amount)}
          </div>
        </div>
      )}
    </div>
  );
}
