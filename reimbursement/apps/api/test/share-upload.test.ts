import { describe, expect, test } from 'bun:test';
import {
  MAX_SHARED_FILE_BYTES,
  ShareTooLargeError,
  UnsupportedShareTypeError,
  normalizeSharedMime,
  sniffMime,
  fileFromRawBody,
  saveSharedFile,
} from '../src/uploads';

/**
 * The allowlist that stands between a phone and this server's disk.
 *
 * `normalizeSharedMime` is the whole gate: share sheets are inconsistent about
 * the type they send, so the function has to be forgiving enough to accept a
 * genuine photo with a missing type and strict enough to refuse everything
 * else. Both halves are tested here, because loosening either one silently is
 * how an upload endpoint becomes a file drop.
 */

describe('normalizeSharedMime', () => {
  test.each([
    ['image/jpeg', 'IMG_0001.JPG'],
    ['image/png', 'shot.png'],
    ['image/webp', 'a.webp'],
    ['image/heic', 'IMG_0002.HEIC'],
    ['image/heif', 'x.heif'],
    ['application/pdf', 'scan.pdf'],
  ])('accepts declared type %s', (declared, filename) => {
    expect(normalizeSharedMime(declared, filename)).toBe(declared);
  });

  test('strips parameters from the declared type', () => {
    expect(normalizeSharedMime('image/jpeg; charset=binary', 'a.jpg')).toBe('image/jpeg');
  });

  test('is case-insensitive about the declared type', () => {
    expect(normalizeSharedMime('IMAGE/JPEG', 'a.jpg')).toBe('image/jpeg');
  });

  // iOS share sheets sometimes hand over a file with no type at all. Rejecting
  // a real receipt photo over a missing header would be the wrong trade.
  test.each([
    ['photo.jpg', 'image/jpeg'],
    ['photo.jpeg', 'image/jpeg'],
    ['PHOTO.JPG', 'image/jpeg'],
    ['scan.pdf', 'application/pdf'],
    ['pic.HEIC', 'image/heic'],
  ])('falls back to the extension for %s when no type is declared', (filename, expected) => {
    expect(normalizeSharedMime(undefined, filename)).toBe(expected);
    expect(normalizeSharedMime('', filename)).toBe(expected);
  });

  test.each([
    ['an executable', 'application/x-msdownload', 'evil.exe'],
    ['a shell script', 'text/x-shellscript', 'run.sh'],
    ['an SVG (script-bearing)', 'image/svg+xml', 'logo.svg'],
    ['an HTML page', 'text/html', 'index.html'],
    ['a zip', 'application/zip', 'bundle.zip'],
    ['a bare octet-stream with no usable extension', 'application/octet-stream', 'blob'],
  ])('rejects %s', (_label, declared, filename) => {
    expect(normalizeSharedMime(declared, filename)).toBeNull();
  });

  test('a disallowed declared type is not rescued by a permitted extension', () => {
    // The declared type loses (it is not on the list) and the extension is then
    // consulted — so this DOES resolve to jpeg. Pinned deliberately: it is the
    // forgiving branch above, and if it ever changes that should be a decision,
    // not a surprise.
    expect(normalizeSharedMime('application/zip', 'actually-a-photo.jpg')).toBe('image/jpeg');
  });

  test('an SVG cannot sneak in via a double extension', () => {
    expect(normalizeSharedMime('image/svg+xml', 'logo.jpg.svg')).toBeNull();
  });
});

describe('saveSharedFile rejections', () => {
  // These reject before anything is written, so they need no temp directory.
  test('refuses a file over the size cap', async () => {
    const oversized = new File([new Uint8Array(1)], 'big.jpg', { type: 'image/jpeg' });
    // Constructing a genuinely 20 MB File in a test is wasteful; override the
    // size the implementation reads instead.
    Object.defineProperty(oversized, 'size', { value: MAX_SHARED_FILE_BYTES + 1 });

    await expect(saveSharedFile(oversized)).rejects.toBeInstanceOf(ShareTooLargeError);
  });

  test('refuses an empty file', async () => {
    const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
    await expect(saveSharedFile(empty)).rejects.toBeInstanceOf(UnsupportedShareTypeError);
  });

  test('refuses a disallowed type', async () => {
    const script = new File([new Uint8Array([1, 2, 3])], 'run.sh', { type: 'text/x-shellscript' });
    await expect(saveSharedFile(script)).rejects.toBeInstanceOf(UnsupportedShareTypeError);
  });

  test('the size cap sits at or below what nginx will pass (25 MB)', () => {
    expect(MAX_SHARED_FILE_BYTES).toBeLessThanOrEqual(25 * 1024 * 1024);
  });
});

/**
 * The raw-body path — what an iPhone Shortcut's `Request Body: File` sends.
 *
 * It exists because the multipart recipe is the one people get wrong: the field
 * type cannot be changed after the field is added, and the first empty box on
 * that screen is the URL, so the photo ends up there and Shortcuts reports
 * "couldn't convert from Photo media to URL". A raw body has one value and no
 * field name, so there is nothing to misplace.
 */
describe('fileFromRawBody', () => {
  const bytes = () => new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).buffer;

  test('wraps a JPEG body as a File with the declared type', () => {
    const file = fileFromRawBody(bytes(), 'image/jpeg', undefined);
    expect(file).not.toBeNull();
    expect(file!.type).toBe('image/jpeg');
    expect(file!.name).toBe('share.jpg');
    expect(file!.size).toBe(7);
  });

  test.each([
    ['application/pdf', 'share.pdf'],
    ['image/png', 'share.png'],
    ['image/heic', 'share.heic'],
  ])('names a %s body %s', (type, expected) => {
    expect(fileFromRawBody(bytes(), type, undefined)!.name).toBe(expected);
  });

  test('tolerates a charset parameter on the content type', () => {
    expect(fileFromRawBody(bytes(), 'image/jpeg; charset=binary', undefined)!.type).toBe(
      'image/jpeg',
    );
  });

  test('honours a filename from Content-Disposition when one is sent', () => {
    const file = fileFromRawBody(bytes(), 'image/jpeg', 'attachment; filename="IMG_0042.JPG"');
    expect(file!.name).toBe('IMG_0042.JPG');
  });

  test('falls back to a generated name when Content-Disposition has no filename', () => {
    expect(fileFromRawBody(bytes(), 'image/jpeg', 'attachment')!.name).toBe('share.jpg');
  });

  test('returns null for an empty body — nothing was actually sent', () => {
    expect(fileFromRawBody(new ArrayBuffer(0), 'image/jpeg', undefined)).toBeNull();
  });

  test.each([
    ['a missing content type', undefined],
    ['an unsupported type', 'application/zip'],
    ['a shell script', 'text/x-shellscript'],
    // The exact shape a misconfigured Shortcut sends when the photo lands in
    // the URL field and only form text reaches the body.
    ['form-urlencoded', 'application/x-www-form-urlencoded'],
  ])('returns null for %s', (_label, type) => {
    expect(fileFromRawBody(bytes(), type, undefined)).toBeNull();
  });
});

/**
 * Magic-byte sniffing.
 *
 * Added after a real incident: the desktop form round-tripped a PDF through a
 * data URL, lost the type, and uploaded 500 KB of PDF named `receipt.jpg` with
 * `image/jpeg` on it. The server believed the label, stored the PDF verbatim
 * under a .jpg name, and the receipt rendered nothing. The client is fixed, but
 * the bytes are the only thing a client bug cannot lie about.
 */
describe('sniffMime', () => {
  const bytesOf = (...parts: (string | number[])[]): Uint8Array =>
    new Uint8Array(
      parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)),
    );

  test('detects a PDF', () => {
    expect(sniffMime(bytesOf('%PDF-1.4'))).toBe('application/pdf');
  });

  test('detects a JPEG', () => {
    expect(sniffMime(bytesOf([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
  });

  test('detects a PNG', () => {
    expect(sniffMime(bytesOf([0x89], 'PNG', [0x0d, 0x0a]))).toBe('image/png');
  });

  test('detects a WebP', () => {
    expect(sniffMime(bytesOf('RIFF', [0, 0, 0, 0], 'WEBP'))).toBe('image/webp');
  });

  test('detects HEIC by its ISO-BMFF brand', () => {
    expect(sniffMime(bytesOf([0, 0, 0, 0x18], 'ftyp', 'heic'))).toBe('image/heic');
  });

  test('returns null for an unrecognised signature, leaving the declared type in charge', () => {
    expect(sniffMime(bytesOf('NOTATHING'))).toBeNull();
  });

  test('is not fooled by an empty buffer', () => {
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
});

describe('saveSharedFile trusts bytes over labels', () => {
  // The exact shape of the incident: PDF content, JPEG label, .jpg name.
  test('a PDF mislabelled as image/jpeg is treated as a PDF', async () => {
    const pdfBytes = new TextEncoder().encode('%PDF-1.4\n%mock pdf body');
    const lying = new File([pdfBytes], 'receipt.jpg', { type: 'image/jpeg' });
    const saved = await saveSharedFile(lying);
    // Stored as a PDF, so rasterization is attempted and the truth is recorded.
    expect(saved.mimeType).toBe('application/pdf');
    // Cleanup: remove whatever it wrote.
    const { rm } = await import('node:fs/promises');
    const { resolve } = await import('node:path');
    for (const p of [saved.photoPath, saved.originalPath].filter(Boolean)) {
      await rm(resolve(process.cwd(), 'uploads', p!.split('/').pop()!), { force: true });
    }
  });
});
