import { mkdir } from 'node:fs/promises';
import { join, extname, resolve } from 'node:path';

const UPLOADS_DIR = join(process.cwd(), 'uploads');
const PUBLIC_PREFIX = '/uploads';

/**
 * Extensions are the only part of an uploaded name we keep, and they come from
 * outside — a browser file picker, or a filename the KBIZ bot chose. Anything
 * that is not a short alphanumeric suffix becomes `.bin`, so the stored name
 * always matches the `[A-Za-z0-9._-]` allowlist the /uploads route enforces.
 */
const SAFE_EXTENSION = /^\.[A-Za-z0-9]{1,8}$/;

/**
 * Persist bytes under `apps/api/uploads/{uuid}{ext}` and return the public URL
 * path the /uploads route will serve them from.
 *
 * Filenames use `crypto.randomUUID()` to avoid collisions; the caller's
 * extension is preserved when it is safe, and defaults to .bin otherwise.
 */
async function persist(data: Blob, extension: string): Promise<string> {
  await mkdir(UPLOADS_DIR, { recursive: true });

  const safeExtension = SAFE_EXTENSION.test(extension) ? extension : '.bin';
  const filename = `${crypto.randomUUID()}${safeExtension}`;
  const absolutePath = join(UPLOADS_DIR, filename);

  await Bun.write(absolutePath, data);

  return `${PUBLIC_PREFIX}/${filename}`;
}

/** Save a multipart upload (a receipt photo, a transfer slip). */
export async function saveUploadedFile(file: File): Promise<string> {
  return persist(file, extname(file.name).toLowerCase());
}

/**
 * Save bytes this app fetched itself rather than received over HTTP — today the
 * e-slip the KBIZ bot captured in the shared queue dir.
 *
 * It goes through the same uploads directory as a manually attached slip on
 * purpose: `transferProofPath` then sits behind the same Cloudflare-identity
 * gate whichever way the payment was made, and the shared queue dir stays a
 * transport, not a second place where proof of payment lives.
 */
export async function saveUploadedBytes(data: Blob, extension: string): Promise<string> {
  return persist(data, extension.toLowerCase());
}

// ─── Shared files (iPhone share sheet / Android Web Share Target) ────────────

/**
 * What a phone is allowed to share into the inbox.
 *
 * An allowlist, not a blocklist: this endpoint is reachable with nothing but a
 * bearer token, so "anything not obviously bad" is the wrong posture. HEIC is
 * here because it is what an iPhone camera actually produces; PDF because a
 * scanned receipt (iOS Notes → Scan Documents) is one.
 */
const SHARED_MIME_EXTENSIONS: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'image/heif': '.heif',
  'application/pdf': '.pdf',
};

/** Largest shared file we accept, in bytes. nginx caps the request at 25 MB. */
export const MAX_SHARED_FILE_BYTES = 20 * 1024 * 1024;

/** Types that every `<img>` in this app can already render, stored untouched. */
const DIRECTLY_DISPLAYABLE = new Set(['image/jpeg', 'image/png', 'image/webp']);

export class UnsupportedShareTypeError extends Error {
  constructor(readonly mimeType: string) {
    super(`Unsupported share type: ${mimeType}`);
    this.name = 'UnsupportedShareTypeError';
  }
}

export class ShareTooLargeError extends Error {
  constructor(readonly sizeBytes: number) {
    super(`Shared file too large: ${sizeBytes} bytes`);
    this.name = 'ShareTooLargeError';
  }
}

/**
 * Normalize the MIME type a phone claims.
 *
 * Share sheets are inconsistent: iOS sometimes sends a bare type, sometimes one
 * with parameters (`image/jpeg; charset=binary`), and occasionally nothing at
 * all — in which case we fall back to the filename extension rather than
 * rejecting a perfectly good photo.
 */
export function normalizeSharedMime(rawType: string | undefined, filename: string): string | null {
  const declared = (rawType ?? '').split(';')[0]!.trim().toLowerCase();
  if (declared && declared in SHARED_MIME_EXTENSIONS) return declared;

  // No usable type — infer from the extension.
  const ext = extname(filename).toLowerCase();
  for (const [mime, mimeExt] of Object.entries(SHARED_MIME_EXTENSIONS)) {
    if (ext === mimeExt) return mime;
  }
  if (ext === '.jpeg') return 'image/jpeg';
  return null;
}

export interface SavedShare {
  /** Always renderable by an <img>. */
  photoPath: string;
  /** The source document when it is not the displayable image (a PDF). */
  originalPath: string | null;
  /** The type as received — "application/pdf" still reads as a PDF here. */
  mimeType: string;
  sizeBytes: number;
}

/**
 * Persist a file shared from a phone, and guarantee the result is displayable.
 *
 * The guarantee is the whole job. Everything downstream — `ReceiptPhoto`, the
 * receipt form's preview, the `?w=` thumbnailer — assumes `photoPath` is an
 * image, so a PDF or a HEIC has to be converted HERE rather than leaving a
 * broken <img> in three screens. The original is kept alongside when it
 * differs, so rasterizing never destroys the document that arrived.
 *
 * Conversion failure is NOT upload failure: we keep the original bytes and
 * report the type honestly, so the inbox can show a "cannot preview" tile
 * instead of losing the employee's receipt. Same posture as the thumbnailer in
 * index.ts, which serves the original rather than 500ing.
 */
export async function saveSharedFile(file: File): Promise<SavedShare> {
  const sizeBytes = file.size;
  if (sizeBytes > MAX_SHARED_FILE_BYTES) throw new ShareTooLargeError(sizeBytes);
  if (sizeBytes === 0) throw new UnsupportedShareTypeError('empty');

  const mimeType = normalizeSharedMime(file.type, file.name);
  if (mimeType === null) throw new UnsupportedShareTypeError(file.type || extname(file.name));

  const storedPath = await persist(file, SHARED_MIME_EXTENSIONS[mimeType]!);

  if (DIRECTLY_DISPLAYABLE.has(mimeType)) {
    return { photoPath: storedPath, originalPath: null, mimeType, sizeBytes };
  }

  // HEIC/HEIF and PDF both need rasterizing before anything can display them.
  const rendered = await rasterizeToJpeg(storedPath, mimeType);
  if (rendered === null) {
    // Kept the bytes, could not render them. The inbox shows a placeholder.
    return { photoPath: storedPath, originalPath: null, mimeType, sizeBytes };
  }

  return { photoPath: rendered, originalPath: storedPath, mimeType, sizeBytes };
}

/**
 * Render page 1 of a PDF (or a HEIC) to JPEG via ImageMagick, returning the new
 * public path — or null if it could not be done.
 *
 * `[0]` selects the first page and is essential: without it a ten-page scan
 * becomes ten output files and the caller's path points at none of them.
 *
 * PDF rasterization needs Ghostscript AND an ImageMagick policy that permits
 * the PDF coder — Debian ships with it disabled (post-CVE-2016-3714). Both are
 * handled in Dockerfile.api; on a machine without them this returns null and
 * the upload still succeeds.
 */
async function rasterizeToJpeg(publicPath: string, mimeType: string): Promise<string | null> {
  const filename = publicPath.slice(PUBLIC_PREFIX.length + 1);
  const source = resolve(UPLOADS_DIR, filename);
  const outName = `${crypto.randomUUID()}.jpg`;
  const out = resolve(UPLOADS_DIR, outName);

  // A PDF page is vector art: rasterize at 150 DPI or the JPEG comes out as a
  // blurry thumbnail of a page. Raster sources ignore -density entirely.
  const densityArgs = mimeType === 'application/pdf' ? ['-density', '150'] : [];

  try {
    const proc = Bun.spawn(
      [
        'convert',
        ...densityArgs,
        `${source}[0]`,
        '-auto-orient',
        // Scanned pages arrive with transparent or alpha regions that JPEG
        // cannot express; without this they render as black blocks.
        '-background',
        'white',
        '-alpha',
        'remove',
        '-alpha',
        'off',
        // A 4000px-wide scan helps nobody on a phone and costs disk forever.
        '-resize',
        '2000x2000>',
        '-quality',
        '85',
        '-strip',
        out,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );

    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[share] convert failed (${code}) for ${mimeType}: ${stderr.trim()}`);
      return null;
    }

    return (await Bun.file(out).exists()) ? `${PUBLIC_PREFIX}/${outName}` : null;
  } catch (error) {
    console.error(`[share] rasterize ${mimeType}:`, error);
    return null;
  }
}
