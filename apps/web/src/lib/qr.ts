// Minimal QR Code encoder (byte mode, ECC level M) — pure TypeScript, zero
// dependencies. Written for the kiosk LINE-scan elevation QR: the portal must
// render a ~120-char URL as a QR without pulling a QR library into the bundle.
//
// COPIED VERBATIM from the HF One portal (HF-erp `src/lib/qr.ts`). Kept as a
// byte-for-byte copy rather than a re-implementation so the two kiosks render
// identical symbols, and so a fix in either repo is a straight file copy. Its
// correctness is locked by that repo's src/server/qr.test.ts; this repo has no
// test framework yet (CLAUDE.md), so do not "improve" this file in place —
// change it upstream and re-copy.
//
// The algorithm follows ISO/IEC 18004 and is closely modelled on Project
// Nayuki's QR Code generator library (https://www.nayuki.io/page/qr-code-
// generator-library, MIT licensed) — the same tables, Reed-Solomon math,
// placement and masking rules, trimmed to the one profile we need:
// byte-mode segments, ECC level M, automatic version 1–40, penalty-scored
// mask selection. Correctness is locked by src/server/qr.test.ts (structural
// invariants + a decoded-by-independent-reader fixture).

/** A rendered QR symbol: `size`×`size` modules, true = dark. */
export interface QrMatrix {
  size: number;
  /** modules[y][x] — row-major, true is a dark module. */
  modules: boolean[][];
}

// ── Tables (ECC level M only) ────────────────────────────────────────────────
// Index = version (1..40); [0] is a filler so indices line up with versions.

const ECC_CODEWORDS_PER_BLOCK: number[] = [
  -1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26,
  26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];

const NUM_ERROR_CORRECTION_BLOCKS: number[] = [
  -1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14,
  16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];

/** Format-info ECL indicator bits for level M (ISO 18004: L=01, M=00, Q=11, H=10). */
const ECL_M_FORMAT_BITS = 0;

// ── Bit-level helpers ────────────────────────────────────────────────────────

function getBit(x: number, i: number): boolean {
  return ((x >>> i) & 1) !== 0;
}

/** Append `len` bits of `val` (big-endian) to the bit array. */
function appendBits(val: number, len: number, out: number[]): void {
  for (let i = len - 1; i >= 0; i--) out.push((val >>> i) & 1);
}

// ── Capacity math ────────────────────────────────────────────────────────────

/** Data-plus-ECC modules available in a version-`ver` symbol. */
function numRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64;
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2;
    result -= (25 * numAlign - 10) * numAlign - 55;
    if (ver >= 7) result -= 36;
  }
  return result;
}

/** Data codewords (bytes) available at ECC level M in version `ver`. */
function numDataCodewords(ver: number): number {
  return (
    Math.floor(numRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[ver] * NUM_ERROR_CORRECTION_BLOCKS[ver]
  );
}

/** Byte-mode character-count field width for version `ver`. */
function byteCountBits(ver: number): number {
  return ver < 10 ? 8 : 16;
}

// ── Reed-Solomon over GF(2^8 / 0x11D) ────────────────────────────────────────

function rsMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

/** The Reed-Solomon generator polynomial's coefficients for `degree`. */
function rsDivisor(degree: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < degree - 1; i++) result.push(0);
  result.push(1); // x^0 coefficient; leading x^degree coefficient is implicit 1
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = rsMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = rsMultiply(root, 0x02);
  }
  return result;
}

/** The Reed-Solomon remainder (ECC bytes) of `data` for the given divisor. */
function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result: number[] = divisor.map(() => 0);
  for (const b of data) {
    const factor = b ^ (result.shift() as number);
    result.push(0);
    for (let i = 0; i < result.length; i++) result[i] ^= rsMultiply(divisor[i], factor);
  }
  return result;
}

// ── Codeword assembly ────────────────────────────────────────────────────────

/** Split data codewords into ECC blocks and interleave per ISO 18004 §8.6. */
function addEccAndInterleave(data: readonly number[], ver: number): number[] {
  const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[ver];
  const blockEccLen = ECC_CODEWORDS_PER_BLOCK[ver];
  const rawCodewords = Math.floor(numRawDataModules(ver) / 8);
  const numShortBlocks = numBlocks - (rawCodewords % numBlocks);
  const shortBlockLen = Math.floor(rawCodewords / numBlocks);

  const blocks: number[][] = [];
  const divisor = rsDivisor(blockEccLen);
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1);
    const dat = data.slice(k, k + datLen);
    k += datLen;
    const block = dat.slice();
    if (i < numShortBlocks) block.push(0); // placeholder so all blocks align
    blocks.push(block.concat(rsRemainder(dat, divisor)));
  }

  const result: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (let j = 0; j < blocks.length; j++) {
      // Skip the alignment placeholder byte in short blocks.
      if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
        result.push(blocks[j][i]);
      }
    }
  }
  return result;
}

// ── Symbol drawing ───────────────────────────────────────────────────────────

interface Canvas {
  size: number;
  modules: boolean[][];
  isFunction: boolean[][];
}

function setFunction(c: Canvas, x: number, y: number, isDark: boolean): void {
  c.modules[y][x] = isDark;
  c.isFunction[y][x] = true;
}

function drawFinderPattern(c: Canvas, x: number, y: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      const xx = x + dx;
      const yy = y + dy;
      if (xx >= 0 && xx < c.size && yy >= 0 && yy < c.size) {
        setFunction(c, xx, yy, dist !== 2 && dist !== 4);
      }
    }
  }
}

function drawAlignmentPattern(c: Canvas, x: number, y: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(c, x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function alignmentPatternPositions(ver: number): number[] {
  if (ver === 1) return [];
  const numAlign = Math.floor(ver / 7) + 2;
  const step =
    ver === 32 ? 26 : Math.floor((ver * 4 + numAlign * 2 + 1) / (numAlign * 2 - 2)) * 2;
  const result = [6];
  for (let pos = ver * 4 + 10; result.length < numAlign; pos -= step) {
    result.splice(1, 0, pos);
  }
  return result;
}

/** BCH(15,5)-protected format bits for (level M, `mask`). */
export function formatBits(mask: number): number {
  const data = (ECL_M_FORMAT_BITS << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormatBits(c: Canvas, mask: number): void {
  const bits = formatBits(mask);
  // First copy, around the top-left finder.
  for (let i = 0; i <= 5; i++) setFunction(c, 8, i, getBit(bits, i));
  setFunction(c, 8, 7, getBit(bits, 6));
  setFunction(c, 8, 8, getBit(bits, 7));
  setFunction(c, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i++) setFunction(c, 14 - i, 8, getBit(bits, i));
  // Second copy, split under the top-right / beside the bottom-left finders.
  for (let i = 0; i < 8; i++) setFunction(c, c.size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i++) setFunction(c, 8, c.size - 15 + i, getBit(bits, i));
  setFunction(c, 8, c.size - 8, true); // the always-dark module
}

function drawVersionInfo(c: Canvas, ver: number): void {
  if (ver < 7) return;
  let rem = ver;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (ver << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const bit = getBit(bits, i);
    const a = c.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(c, a, b, bit);
    setFunction(c, b, a, bit);
  }
}

function drawFunctionPatterns(c: Canvas, ver: number): void {
  for (let i = 0; i < c.size; i++) {
    setFunction(c, 6, i, i % 2 === 0); // vertical timing
    setFunction(c, i, 6, i % 2 === 0); // horizontal timing
  }
  drawFinderPattern(c, 3, 3);
  drawFinderPattern(c, c.size - 4, 3);
  drawFinderPattern(c, 3, c.size - 4);

  const align = alignmentPatternPositions(ver);
  const last = align.length - 1;
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      // Skip the three corners occupied by finder patterns.
      if (
        (i === 0 && j === 0) ||
        (i === 0 && j === last) ||
        (i === last && j === 0)
      ) {
        continue;
      }
      drawAlignmentPattern(c, align[i], align[j]);
    }
  }
  drawFormatBits(c, 0); // placeholder — overwritten once the mask is chosen
  drawVersionInfo(c, ver);
}

/** Zigzag the interleaved codewords into the non-function modules. */
function drawCodewords(c: Canvas, data: readonly number[]): void {
  let i = 0; // bit index into data
  for (let right = c.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the timing column is skipped whole
    for (let vert = 0; vert < c.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? c.size - 1 - vert : vert;
        if (!c.isFunction[y][x] && i < data.length * 8) {
          c.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

function maskBit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

/** XOR the mask pattern over the non-function modules (self-inverse). */
function applyMask(c: Canvas, mask: number): void {
  for (let y = 0; y < c.size; y++) {
    for (let x = 0; x < c.size; x++) {
      if (!c.isFunction[y][x] && maskBit(mask, x, y)) c.modules[y][x] = !c.modules[y][x];
    }
  }
}

// ── Mask penalty (ISO 18004 §8.8.2) ──────────────────────────────────────────

const PENALTY_N1 = 3;
const PENALTY_N2 = 3;
const PENALTY_N3 = 40;
const PENALTY_N4 = 10;

// The two finder-like sequences rule N3 hunts for (1:1:3:1:1 with 4 light).
const FINDERLIKE_A = [true, false, true, true, true, false, true, false, false, false, false];
const FINDERLIKE_B = [false, false, false, false, true, false, true, true, true, false, true];

function lineAt(c: Canvas, index: number, vertical: boolean, i: number): boolean {
  return vertical ? c.modules[i][index] : c.modules[index][i];
}

function penaltyScore(c: Canvas): number {
  let result = 0;
  const size = c.size;

  // N1 (runs ≥ 5) and N3 (finder-like), rows and columns in one sweep each.
  for (const vertical of [false, true]) {
    for (let index = 0; index < size; index++) {
      let runColor = lineAt(c, index, vertical, 0);
      let runLen = 1;
      for (let i = 1; i < size; i++) {
        const color = lineAt(c, index, vertical, i);
        if (color === runColor) {
          runLen++;
          if (runLen === 5) result += PENALTY_N1;
          else if (runLen > 5) result++;
        } else {
          runColor = color;
          runLen = 1;
        }
      }
      for (let i = 0; i + FINDERLIKE_A.length <= size; i++) {
        let matchesA = true;
        let matchesB = true;
        for (let j = 0; j < FINDERLIKE_A.length; j++) {
          const color = lineAt(c, index, vertical, i + j);
          if (color !== FINDERLIKE_A[j]) matchesA = false;
          if (color !== FINDERLIKE_B[j]) matchesB = false;
        }
        if (matchesA) result += PENALTY_N3;
        if (matchesB) result += PENALTY_N3;
      }
    }
  }

  // N2: 2×2 blocks of one color.
  for (let y = 0; y < size - 1; y++) {
    for (let x = 0; x < size - 1; x++) {
      const color = c.modules[y][x];
      if (
        color === c.modules[y][x + 1] &&
        color === c.modules[y + 1][x] &&
        color === c.modules[y + 1][x + 1]
      ) {
        result += PENALTY_N2;
      }
    }
  }

  // N4: dark-module balance, 10 points per 5% deviation step from 50%.
  let dark = 0;
  for (const row of c.modules) for (const cell of row) if (cell) dark++;
  const total = size * size;
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1;
  result += k * PENALTY_N4;

  return result;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Encode `text` (UTF-8, byte mode, ECC level M) into a QR module matrix.
 * Picks the smallest version 1–40 that fits and the lowest-penalty mask.
 * Throws when the text exceeds version 40's capacity.
 */
export function encodeQr(text: string): QrMatrix {
  const bytes = Array.from(new TextEncoder().encode(text));

  let ver = 1;
  while (4 + byteCountBits(ver) + bytes.length * 8 > numDataCodewords(ver) * 8) {
    ver++;
    if (ver > 40) throw new Error("qr: data too long");
  }

  // Segment: mode 0100 (byte) + count + payload; then terminator + padding.
  const bits: number[] = [];
  appendBits(4, 4, bits);
  appendBits(bytes.length, byteCountBits(ver), bits);
  for (const b of bytes) appendBits(b, 8, bits);

  const capacityBits = numDataCodewords(ver) * 8;
  appendBits(0, Math.min(4, capacityBits - bits.length), bits); // terminator
  appendBits(0, (8 - (bits.length % 8)) % 8, bits); // byte-align
  for (let pad = 0xec; bits.length < capacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bits);
  }

  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }

  const size = ver * 4 + 17;
  const c: Canvas = {
    size,
    modules: Array.from({ length: size }, () => Array(size).fill(false) as boolean[]),
    isFunction: Array.from({ length: size }, () => Array(size).fill(false) as boolean[]),
  };
  drawFunctionPatterns(c, ver);
  drawCodewords(c, addEccAndInterleave(data, ver));

  // Try all 8 masks, keep the lowest penalty (decoders accept any mask; the
  // penalty pick just yields the most scanner-friendly symbol).
  let bestMask = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(c, mask);
    drawFormatBits(c, mask);
    const score = penaltyScore(c);
    if (score < bestScore) {
      bestScore = score;
      bestMask = mask;
    }
    applyMask(c, mask); // XOR mask is self-inverse — restore
  }
  applyMask(c, bestMask);
  drawFormatBits(c, bestMask);

  return { size, modules: c.modules };
}

/**
 * The dark modules of `qr` as one SVG path (`fill-rule` irrelevant — disjoint
 * unit squares), in a viewBox of `size + 2*border` units. Render as:
 * `<svg viewBox="0 0 N N"><rect .../><path d={...} fill="#000"/></svg>`.
 */
export function qrSvgPath(qr: QrMatrix, border = 2): string {
  const parts: string[] = [];
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.modules[y][x]) parts.push(`M${x + border} ${y + border}h1v1h-1z`);
    }
  }
  return parts.join("");
}
