import { mkdir, rm } from 'node:fs/promises';
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

// ─── Deletion ────────────────────────────────────────────────────────────────

/**
 * Widths the API caches thumbnails at. Must match `THUMB_WIDTHS` in index.ts —
 * a width missing here leaks one cached .webp per deleted image, which is
 * exactly the disk the caller is trying to reclaim.
 */
const THUMB_WIDTHS = [96, 320, 800];

/**
 * Same allowlist index.ts enforces when SERVING. Applied again on delete, so a
 * stored path that somehow contained `..` or an absolute path can never make
 * this function unlink outside the uploads directory. Every path we generate
 * passes trivially; this is here for the one that someday doesn't.
 */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

/**
 * Delete uploaded files and their cached thumbnails, best effort.
 *
 * Call this ONLY for files nothing references any more. The app's delete paths
 * are each guarded so that holds: an inbox item is discarded only while
 * undrained (a drained one is removed inside the create transaction instead),
 * and a receipt can only be deleted while unbundled. Filenames are per-upload
 * UUIDs, so two rows never share bytes.
 *
 * Never throws and never blocks the caller's response: reclaiming disk is
 * housekeeping, and failing a delete the user already performed — because a
 * file was missing, or the volume was briefly read-only — would be the worse
 * outcome. Failures are logged instead.
 */
export async function deleteUploadedFiles(paths: (string | null | undefined)[]): Promise<void> {
  for (const path of paths) {
    if (!path) continue;

    const filename = path.startsWith(`${PUBLIC_PREFIX}/`)
      ? path.slice(PUBLIC_PREFIX.length + 1)
      : null;
    if (filename === null || !SAFE_FILENAME.test(filename)) {
      console.error(`[uploads] refusing to delete unexpected path: ${path}`);
      continue;
    }

    const targets = [
      resolve(UPLOADS_DIR, filename),
      // Cached thumbnails, laid out by index.ts as .thumbs/w<width>/<file>.webp
      ...THUMB_WIDTHS.map((w) => resolve(UPLOADS_DIR, '.thumbs', `w${w}`, `${filename}.webp`)),
    ];

    for (const target of targets) {
      try {
        // force: a thumbnail that was never generated is the normal case, not
        // an error worth logging on every delete.
        await rm(target, { force: true });
      } catch (error) {
        console.error(`[uploads] could not delete ${target}:`, error);
      }
    }
  }
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
/**
 * Identify a file from its own first bytes.
 *
 * The declared type and the filename both come from the client and both have
 * been wrong in practice: the desktop form round-tripped a PDF through a data
 * URL, lost the type, and handed the server 500 KB of PDF named `receipt.jpg`
 * with `image/jpeg` on it. Everything downstream believed it, stored the PDF
 * verbatim under a .jpg name, and every <img> pointed at it rendered nothing.
 *
 * Magic bytes cannot be got wrong by a client bug, so they win when they
 * disagree. Returns null when the signature is not one we recognise, in which
 * case the declared type is used as before.
 */
export function sniffMime(bytes: Uint8Array): string | null {
  const ascii = (from: number, len: number): string =>
    String.fromCharCode(...bytes.slice(from, from + len));

  if (ascii(0, 4) === '%PDF') return 'application/pdf';
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  if (bytes[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WEBP') return 'image/webp';
  // ISO-BMFF: the brand at offset 8 distinguishes HEIC/HEIF from other MP4s.
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc') return 'image/heic';
    if (brand === 'mif1' || brand === 'msf1' || brand === 'heim') return 'image/heif';
  }
  return null;
}

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

/**
 * Wrap a raw request body as a File.
 *
 * This exists so an iPhone Shortcut can use `Request Body: File`, which posts
 * the bytes with the file's own Content-Type and no multipart envelope at all.
 * That matters for a human reason rather than a technical one: the multipart
 * recipe needs an "Add new field" → choose **File** → name it `photo` → set its
 * value dance, the field type cannot be changed after the field is created, and
 * the first empty box on that screen is the URL — so the overwhelmingly common
 * mistake is dropping the photo into the URL and getting "Shortcuts couldn't
 * convert from Photo media to URL". `Request Body: File` has one value and no
 * field name, so there is nothing to put in the wrong place.
 *
 * Returns null when the body is empty or the type is not on the allowlist;
 * `saveSharedFile` re-checks the type anyway, so this is a shaping step, not
 * the security boundary.
 */
export function fileFromRawBody(
  bytes: ArrayBuffer,
  contentType: string | undefined,
  contentDisposition?: string | undefined,
): File | null {
  if (bytes.byteLength === 0) return null;

  const mimeType = normalizeSharedMime(contentType, '');
  if (mimeType === null) return null;

  // Shortcuts does not send a filename, but other clients might; honour it for
  // display when present. Untrusted — uploads always generate their own path.
  const named = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(contentDisposition ?? '');
  const filename = named?.[1]?.trim() || `share${SHARED_MIME_EXTENSIONS[mimeType]}`;

  return new File([bytes], filename, { type: mimeType });
}

export interface SavedShare {
  /** The cover — always renderable by an <img>. Same as `pagePaths[0]`. */
  photoPath: string;
  /**
   * Every page, in order. A multi-page PDF becomes one image PER PAGE rather
   * than a single tall strip: pages are what the gallery pages through, what
   * thumbnails are generated from, and what the page count counts. A stacked
   * strip thumbnailed to 320px showed nothing but the top of page one.
   */
  pagePaths: string[];
  /**
   * The source document when it was kept — only when rasterization FAILED and
   * these bytes are all we have. On success the source is deleted: the rendered
   * pages carry the content and the original is unreachable from the app.
   */
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

  // The bytes decide. A client that mislabels a PDF as image/jpeg — which the
  // desktop form did — must not be able to get PDF bytes stored under a .jpg
  // name, because nothing downstream would ever render them.
  const head = new Uint8Array((await file.arrayBuffer()).slice(0, 16));
  const sniffed = sniffMime(head);
  const declared = normalizeSharedMime(file.type, file.name);
  const mimeType = sniffed ?? declared;

  if (mimeType === null) throw new UnsupportedShareTypeError(file.type || extname(file.name));
  if (sniffed !== null && declared !== null && sniffed !== declared) {
    console.warn(`[share] client said ${declared} but bytes are ${sniffed} (${file.name}) — trusting the bytes`);
  }

  const storedPath = await persist(file, SHARED_MIME_EXTENSIONS[mimeType]!);

  if (DIRECTLY_DISPLAYABLE.has(mimeType)) {
    return {
      photoPath: storedPath,
      pagePaths: [storedPath],
      originalPath: null,
      mimeType,
      sizeBytes,
    };
  }

  // HEIC/HEIF and PDF both need rasterizing before anything can display them.
  const pages = await rasterizePages(storedPath, mimeType);
  if (pages.length === 0) {
    // Kept the bytes, could not render them. The UI shows a placeholder, and
    // the source is NOT deleted — it is the only copy of the content left.
    return {
      photoPath: storedPath,
      pagePaths: [storedPath],
      originalPath: null,
      mimeType,
      sizeBytes,
    };
  }

  // The rendered pages carry everything the source did, and nothing in the app
  // can reach the source afterwards — a Receipt has no field for it. Keeping it
  // would be storage nobody can open.
  await deleteUploadedFiles([storedPath]);

  return { photoPath: pages[0]!, pagePaths: pages, originalPath: null, mimeType, sizeBytes };
}

/**
 * Most pages of a shared PDF we will render. A receipt is one to three pages;
 * this is the runaway guard, not a target. Exceeding it is logged loudly
 * because the excess pages are genuinely lost — a Receipt keeps only the render.
 */
const MAX_PDF_PAGES = 10;

/**
 * Width every rendered page is scaled to. ~240 DPI for A4, chosen by looking at
 * Thai fine print at 1:1: at the old 150 DPI the tone and vowel marks
 * (สระ/วรรณยุกต์) broke up — they are small, stacked, and JPEG's ringing hits
 * them far harder than it hits Latin text. Pages are rendered at 300 DPI and
 * downsampled to this, which is sharper than rendering at 240 directly.
 */
const RENDER_WIDTH = 2000;

/**
 * Render a shared document to one JPEG PER PAGE, returning their public paths
 * in order — or an empty array if it could not be done.
 *
 * One file per page, not one tall strip. Pages are the unit the rest of the app
 * already works in: the gallery pages through them, the thumbnailer generates
 * one per file, and the page-count badge counts them. A stacked strip
 * thumbnailed to 320px showed nothing but the top of page one.
 *
 * `%d` in the output name makes ImageMagick write one file per frame; it
 * substitutes even for a single-page document, so there is no special case.
 * Sizing each page during the render (rather than after an -append) also keeps
 * peak memory to one page instead of the whole document.
 *
 * PDF rasterization needs Ghostscript AND an ImageMagick policy that permits the
 * PDF coder — Debian ships with it disabled (post-CVE-2016-3714). Both are
 * handled in Dockerfile.api; on a machine without them this returns [] and the
 * upload still succeeds with the original bytes kept.
 */
async function rasterizePages(publicPath: string, mimeType: string): Promise<string[]> {
  const filename = publicPath.slice(PUBLIC_PREFIX.length + 1);
  const source = resolve(UPLOADS_DIR, filename);
  const isPdf = mimeType === 'application/pdf';
  const stem = crypto.randomUUID();
  const outPattern = resolve(UPLOADS_DIR, `${stem}-%d.jpg`);

  if (isPdf) await warnIfPagesDropped(source);

  // A PDF page is vector art: rasterize at 300 DPI and downsample, or the text
  // comes out soft. Raster sources ignore -density entirely.
  const densityArgs = isPdf ? ['-density', '300'] : [];
  const frames = isPdf ? `${source}[0-${MAX_PDF_PAGES - 1}]` : `${source}[0]`;

  try {
    const proc = Bun.spawn(
      [
        'convert',
        ...densityArgs,
        frames,
        // Honour EXIF rotation before resizing, or phone photos come out sideways.
        '-auto-orient',
        // Scanned pages arrive with transparent or alpha regions that JPEG
        // cannot express; without this they render as black blocks.
        '-background',
        'white',
        '-alpha',
        'remove',
        '-alpha',
        'off',
        '-resize',
        `${RENDER_WIDTH}x>`,
        '-quality',
        '92',
        '-strip',
        outPattern,
      ],
      { stdout: 'ignore', stderr: 'pipe' },
    );

    const code = await proc.exited;
    if (code !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error(`[share] convert failed (${code}) for ${mimeType}: ${stderr.trim()}`);
      return [];
    }

    // Collect by index rather than by listing the directory: the order is the
    // page order, and a concurrent upload must not be able to leak into it.
    const pages: string[] = [];
    for (let i = 0; i < MAX_PDF_PAGES; i += 1) {
      const name = `${stem}-${i}.jpg`;
      if (!(await Bun.file(resolve(UPLOADS_DIR, name)).exists())) break;
      pages.push(`${PUBLIC_PREFIX}/${name}`);
    }
    return pages;
  } catch (error) {
    console.error(`[share] rasterize ${mimeType}:`, error);
    return [];
  }
}

/**
 * Log when a PDF has more pages than we render, because those pages are lost.
 *
 * Reading the page count costs ~0.4s against a ~3s render, which is worth it:
 * the alternative is a truncated document that looks complete.
 */
async function warnIfPagesDropped(source: string): Promise<void> {
  try {
    const proc = Bun.spawn(['identify', '-format', '%n\n', source], {
      stdout: 'pipe',
      stderr: 'ignore',
    });
    const text = await new Response(proc.stdout).text();
    await proc.exited;
    const pages = Number.parseInt(text.trim().split('\n')[0] ?? '', 10);
    if (Number.isFinite(pages) && pages > MAX_PDF_PAGES) {
      console.error(
        `[share] PDF has ${pages} pages; only the first ${MAX_PDF_PAGES} were rendered — ` +
          `pages ${MAX_PDF_PAGES + 1}-${pages} are NOT in the receipt image (${source})`,
      );
    }
  } catch {
    // Page count is advisory; never let it stop an upload.
  }
}
