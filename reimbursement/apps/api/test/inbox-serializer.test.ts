import { describe, expect, test } from 'bun:test';
import { serializeInboxItem } from '../src/serializers';
import type { ReceiptInbox } from '../src/generated/prisma';

/**
 * `previewable` — whether the UI may put this item in an `<img>`.
 *
 * Worth its own suite because the obvious implementation is wrong. Deriving it
 * from `mimeType` or from "did we keep an original?" gets the FAILURE cases
 * backwards: a HEIC that could not be rasterized still has `image/heic` as its
 * type and no original, so it reads as previewable while being exactly the file
 * Chrome refuses to render. The only honest source is the file at `photoPath`.
 */

function item(overrides: Partial<ReceiptInbox>): ReceiptInbox {
  return {
    id: 'inbox_1',
    userId: 'user_1',
    photoPath: '/uploads/a.jpg',
    pagePaths: ['/uploads/a.jpg'],
    originalPath: null,
    mimeType: 'image/jpeg',
    filename: 'IMG_0001.JPG',
    sizeBytes: 1234,
    source: 'ios-share',
    createdAt: new Date('2026-08-16T10:00:00.000Z'),
    ...overrides,
  } as ReceiptInbox;
}

describe('serializeInboxItem previewable', () => {
  test('a plain JPEG is previewable', () => {
    expect(serializeInboxItem(item({})).previewable).toBe(true);
  });

  test.each(['/uploads/a.png', '/uploads/a.webp', '/uploads/a.jpeg'])(
    '%s is previewable',
    (photoPath) => {
      expect(serializeInboxItem(item({ photoPath })).previewable).toBe(true);
    },
  );

  test('a PDF that rasterized is previewable — photoPath is the JPEG', () => {
    const serialized = serializeInboxItem(
      item({
        photoPath: '/uploads/rendered.jpg',
        originalPath: '/uploads/scan.pdf',
        mimeType: 'application/pdf',
      }),
    );
    expect(serialized.previewable).toBe(true);
    // The received type is reported honestly even though the preview is a JPEG.
    expect(serialized.mimeType).toBe('application/pdf');
    expect(serialized.originalPath).toBe('/uploads/scan.pdf');
  });

  test('a PDF that could NOT be rasterized is not previewable', () => {
    const serialized = serializeInboxItem(
      item({ photoPath: '/uploads/scan.pdf', originalPath: null, mimeType: 'application/pdf' }),
    );
    expect(serialized.previewable).toBe(false);
  });

  // The regression this suite exists for.
  test('a HEIC that could NOT be rasterized is not previewable, despite an image/* type', () => {
    const serialized = serializeInboxItem(
      item({ photoPath: '/uploads/IMG.heic', originalPath: null, mimeType: 'image/heic' }),
    );
    expect(serialized.previewable).toBe(false);
  });

  test('a HEIC that rasterized is previewable', () => {
    const serialized = serializeInboxItem(
      item({
        photoPath: '/uploads/rendered.jpg',
        originalPath: '/uploads/IMG.heic',
        mimeType: 'image/heic',
      }),
    );
    expect(serialized.previewable).toBe(true);
  });

  test('extension matching is case-insensitive', () => {
    expect(serializeInboxItem(item({ photoPath: '/uploads/A.JPG' })).previewable).toBe(true);
  });

  test('a .jpg appearing mid-path does not count — only the real extension', () => {
    expect(
      serializeInboxItem(item({ photoPath: '/uploads/a.jpg.pdf', mimeType: 'application/pdf' }))
        .previewable,
    ).toBe(false);
  });
});

describe('serializeInboxItem pageCount', () => {
  test('counts the rendered pages of a multi-page share', () => {
    const serialized = serializeInboxItem(
      item({ pagePaths: ['/uploads/a-0.jpg', '/uploads/a-1.jpg', '/uploads/a-2.jpg'] }),
    );
    expect(serialized.pageCount).toBe(3);
  });

  test('a single-page share reports 1', () => {
    expect(serializeInboxItem(item({})).pageCount).toBe(1);
  });

  // Rows created before per-page rendering carry an empty array; they are
  // single-page by construction, so 0 would be a lie.
  test('an empty pagePaths floors at 1 rather than 0', () => {
    expect(serializeInboxItem(item({ pagePaths: [] })).pageCount).toBe(1);
  });
});

describe('serializeInboxItem shape', () => {
  test('dates become ISO strings', () => {
    expect(serializeInboxItem(item({})).createdAt).toBe('2026-08-16T10:00:00.000Z');
  });

  test('carries source through verbatim, so a new producer needs no serializer change', () => {
    expect(serializeInboxItem(item({ source: 'kiosk-scan' })).source).toBe('kiosk-scan');
  });

  test('a null filename survives as null rather than becoming "null"', () => {
    expect(serializeInboxItem(item({ filename: null })).filename).toBeNull();
  });
});
