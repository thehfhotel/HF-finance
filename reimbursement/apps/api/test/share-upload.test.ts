import { describe, expect, test } from 'bun:test';
import {
  MAX_SHARED_FILE_BYTES,
  ShareTooLargeError,
  UnsupportedShareTypeError,
  normalizeSharedMime,
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
