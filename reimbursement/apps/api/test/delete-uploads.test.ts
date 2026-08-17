import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { deleteUploadedFiles } from '../src/uploads';

/**
 * Reclaiming disk when something is deleted in the app.
 *
 * Two properties matter and neither is visible by reading the call sites:
 * every derived artifact goes (a leaked thumbnail per image defeats the point),
 * and nothing outside the uploads directory can ever be unlinked — this is the
 * one function in the codebase that removes files, and it takes a path that was
 * read back out of the database.
 *
 * `UPLOADS_DIR` is `process.cwd()/uploads`, and `bun test` runs with cwd at the
 * api workspace root, so these write into the real uploads dir under uniquely
 * named files and clean up after themselves.
 */

const UPLOADS = resolve(process.cwd(), 'uploads');
const THUMBS = join(UPLOADS, '.thumbs');
const NAME = 'zz-delete-test-fixture.jpg';

const thumbFor = (width: number, name = NAME) => join(THUMBS, `w${width}`, `${name}.webp`);

async function makeFixture(name = NAME): Promise<void> {
  await mkdir(UPLOADS, { recursive: true });
  await writeFile(join(UPLOADS, name), 'original-bytes');
  for (const w of [96, 320, 800]) {
    await mkdir(join(THUMBS, `w${w}`), { recursive: true });
    await writeFile(thumbFor(w, name), `thumb-${w}`);
  }
}

beforeEach(async () => {
  await makeFixture();
});

afterEach(async () => {
  await rm(join(UPLOADS, NAME), { force: true });
  for (const w of [96, 320, 800]) await rm(thumbFor(w), { force: true });
});

describe('deleteUploadedFiles', () => {
  test('removes the original file', async () => {
    await deleteUploadedFiles([`/uploads/${NAME}`]);
    expect(existsSync(join(UPLOADS, NAME))).toBe(false);
  });

  // The whole point is disk: an image can have three cached renders behind it,
  // and leaving them is most of what the delete was meant to reclaim.
  test('removes every cached thumbnail width', async () => {
    await deleteUploadedFiles([`/uploads/${NAME}`]);
    for (const w of [96, 320, 800]) {
      expect(existsSync(thumbFor(w))).toBe(false);
    }
  });

  test('deletes several paths in one call (a shared PDF: render + original)', async () => {
    const second = 'zz-delete-test-second.pdf';
    await makeFixture(second);
    await deleteUploadedFiles([`/uploads/${NAME}`, `/uploads/${second}`]);
    expect(existsSync(join(UPLOADS, NAME))).toBe(false);
    expect(existsSync(join(UPLOADS, second))).toBe(false);
    await rm(join(UPLOADS, second), { force: true });
    for (const w of [96, 320, 800]) await rm(thumbFor(w, second), { force: true });
  });

  test('ignores null and undefined entries', async () => {
    await deleteUploadedFiles([null, undefined, `/uploads/${NAME}`]);
    expect(existsSync(join(UPLOADS, NAME))).toBe(false);
  });

  test('a missing file is not an error — deleting twice is safe', async () => {
    await deleteUploadedFiles([`/uploads/${NAME}`]);
    await deleteUploadedFiles([`/uploads/${NAME}`]);
    expect(existsSync(join(UPLOADS, NAME))).toBe(false);
  });

  // The containment property. These must leave the fixture untouched: refusing
  // is the only acceptable behaviour for a path that is not ours.
  test.each([
    ['traversal out of the uploads dir', '/uploads/../../../etc/passwd'],
    ['nested traversal', '/uploads/subdir/../../secret'],
    ['an absolute path', '/etc/passwd'],
    ['a path outside the public prefix', '/etcpasswd'],
    ['a bare filename with no prefix', 'zz-delete-test-fixture.jpg'],
    ['a different prefix', '/uploadsx/zz-delete-test-fixture.jpg'],
    ['an empty string', ''],
  ])('refuses %s', async (_label, path) => {
    await deleteUploadedFiles([path]);
    // Untouched — the call refused rather than resolving somewhere unexpected.
    expect(existsSync(join(UPLOADS, NAME))).toBe(true);
  });

  test('never throws, whatever it is handed', async () => {
    await expect(
      deleteUploadedFiles(['/uploads/does-not-exist.jpg', null, '/uploads/../../etc/passwd']),
    ).resolves.toBeUndefined();
  });
});
