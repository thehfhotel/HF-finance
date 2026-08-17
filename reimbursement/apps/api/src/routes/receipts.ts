import { Elysia, t } from 'elysia';
import type { ReceiptItem } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { deleteUploadedFiles, saveSharedFile } from '../uploads';
import { serializeReceipt } from '../serializers';
import { getReceiptCategories } from '../settings';
import { resolveVendorId } from '../vendors';

/**
 * Multipart fields shared by POST/PATCH receipt endpoints.
 *
 * Numeric and JSON fields arrive as strings on the wire and are coerced
 * here. `items` is a JSON-stringified `ReceiptItem[]` so the frontend
 * can keep using a single multipart payload for the photo + metadata.
 */
const receiptMultipartBody = t.Object({
  merchant: t.Optional(t.String()),
  category: t.Optional(t.String()),
  property: t.Optional(t.String()),
  quantity: t.Optional(t.String()),
  amount: t.Optional(t.String()),
  date: t.Optional(t.String()),
  note: t.Optional(t.String()),
  color: t.Optional(t.String()),
  accent: t.Optional(t.String()),
  // Elysia >= 1.4 auto-JSON-parses multipart fields that look like arrays/
  // objects, so the JSON-stringified `items` field may arrive pre-parsed.
  items: t.Optional(t.Union([t.String(), t.Array(t.Unknown())])),
  tax: t.Optional(t.String()),
  photo: t.Optional(t.File()),
  /**
   * Additional attachments (CR-2026-08-17). One expense is often several files —
   * a paper receipt shot three times, or an invoice plus its delivery note.
   *
   * The singular `photo`/`inboxId` above are kept and still work: existing
   * clients send them, and the first of `photo` + `photos` becomes the cover.
   */
  photos: t.Optional(t.Files()),
  /** Comma-separated inbox ids to drain into THIS receipt. */
  inboxIds: t.Optional(t.String()),
  /**
   * Drain an inbox item instead of uploading a photo (CR-2026-08-16).
   *
   * The file already sits in the uploads volume — the phone put it there when
   * it was shared — so the receipt form re-posting those same bytes would be a
   * pointless second upload over a hotel wifi. Sending the id instead adopts
   * the stored file and deletes the queue row.
   */
  inboxId: t.Optional(t.String()),
});

const requiredCreateFields = ['merchant', 'category', 'amount', 'date', 'items'] as const;
type RequiredCreateField = (typeof requiredCreateFields)[number];

interface ParsedReceiptInput {
  merchant?: string;
  category?: string;
  property?: 'hf-hotel' | 'hf-ville';
  quantity?: number | null;
  amount?: number;
  date?: string;
  note?: string | null;
  color?: string;
  accent?: string;
  items?: ReceiptItem[];
  tax?: string;
  photoPath?: string;
  /** Every freshly uploaded file, in the order the client sent them. */
  uploadedPaths?: UploadedFile[];
  /** Set when the photo came from the share inbox; the row is consumed on save. */
  inboxId?: string;
  /** All inbox items being drained into this receipt, in order. */
  inboxIds?: string[];
}

/** A file this request uploaded, before it is attached to a receipt. */
interface UploadedFile {
  photoPath: string;
  originalPath: string | null;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
}

function parseItems(rawItems: string): ReceiptItem[] {
  const parsed = JSON.parse(rawItems);
  if (!Array.isArray(parsed)) {
    throw new Error('items must be a JSON array');
  }
  return parsed as ReceiptItem[];
}

async function parseReceiptMultipart(
  body: typeof receiptMultipartBody.static,
): Promise<ParsedReceiptInput> {
  const parsed: ParsedReceiptInput = {};

  if (body.merchant !== undefined) parsed.merchant = body.merchant;
  if (body.category !== undefined) parsed.category = body.category;
  if (body.date !== undefined) parsed.date = body.date;
  if (body.color !== undefined) parsed.color = body.color;
  if (body.accent !== undefined) parsed.accent = body.accent;
  if (body.tax !== undefined) parsed.tax = body.tax;
  if (body.note !== undefined) parsed.note = body.note.length === 0 ? null : body.note;

  if (body.property !== undefined) {
    if (body.property !== 'hf-hotel' && body.property !== 'hf-ville') {
      throw new Error('property must be hf-hotel or hf-ville');
    }
    parsed.property = body.property;
  }

  if (body.quantity !== undefined) {
    if (body.quantity === '') {
      parsed.quantity = null;
    } else {
      const q = Number(body.quantity);
      if (!Number.isFinite(q) || !Number.isInteger(q) || q < 0) {
        throw new Error('quantity must be a non-negative integer');
      }
      parsed.quantity = q;
    }
  }

  if (body.amount !== undefined) {
    const amountValue = Number(body.amount);
    if (!Number.isFinite(amountValue)) {
      throw new Error('amount must be a number');
    }
    parsed.amount = amountValue;
  }

  if (body.items !== undefined) {
    parsed.items = Array.isArray(body.items)
      ? (body.items as ReceiptItem[])
      : parseItems(body.items);
  }

  // `photo` first so it stays the cover for existing clients, then any extras.
  const incoming = [...(body.photo ? [body.photo] : []), ...(body.photos ?? [])];
  if (incoming.length > 0) {
    parsed.uploadedPaths = [];
    for (const file of incoming) {
      // saveSharedFile, not saveUploadedFile: it enforces the type allowlist and
      // guarantees the stored path is <img>-renderable, rasterizing a PDF or
      // HEIC on the way in. A file picked in the receipt form deserves exactly
      // the same treatment as one shared from a phone — before this, a PDF
      // attached here was stored raw and rendered as a broken image.
      const saved = await saveSharedFile(file);
      // One attachment PER PAGE: a three-page PDF picked in the form becomes
      // three files on the receipt, not one tall image.
      saved.pagePaths.forEach((path, i) => {
        parsed.uploadedPaths!.push({
          photoPath: path,
          originalPath: i === 0 ? saved.originalPath : null,
          mimeType: saved.mimeType,
          filename: file.name
            ? `${file.name.slice(0, 110)}${saved.pagePaths.length > 1 ? ` (${i + 1})` : ''}`
            : null,
          // Report the source size once rather than multiplying it per page.
          sizeBytes: i === 0 ? saved.sizeBytes : 0,
        });
      });
    }
    parsed.photoPath = parsed.uploadedPaths[0]!.photoPath;
  }

  // Ownership cannot be checked here (no `user` in scope), so this only carries
  // the id forward — the create handler resolves it against the caller.
  if (body.inboxId !== undefined && body.inboxId.length > 0) {
    parsed.inboxId = body.inboxId;
  }
  const ids = [
    ...(parsed.inboxId ? [parsed.inboxId] : []),
    ...(body.inboxIds ?? '')
      .split(',')
      .map((id) => id.trim())
      .filter((id) => id.length > 0),
  ];
  // De-duplicated: sending the same id in both fields must drain it once.
  if (ids.length > 0) parsed.inboxIds = [...new Set(ids)];

  return parsed;
}

function assertRequiredCreateFields(input: ParsedReceiptInput): asserts input is ParsedReceiptInput &
  Required<Pick<ParsedReceiptInput, RequiredCreateField>> {
  for (const field of requiredCreateFields) {
    if (input[field] === undefined) {
      throw new Error(`Missing required field: ${field}`);
    }
  }
}

export const receiptRoutes = new Elysia({ prefix: '/receipts' })
  .use(auth)

  /** The receipt form's live category list (admin-managed; seeded default). */
  .get('/categories', async () => ({ categories: await getReceiptCategories() }))

  .get(
    '/',
    async ({ user, query }) => {
      const isApprover = user.role === 'APPROVER';
      const mine = query.mine === '1' || query.mine === 'true';
      const filters: Record<string, unknown> = {};

      if (!isApprover || mine) {
        filters.userId = user.id;
      }

      if (query.bundleId) {
        filters.bundleId = query.bundleId;
      } else if (query.loose === 'true') {
        filters.bundleId = null;
      }

      // Paginated for the same reason as bundles — ~1,500 rows is not a
      // payload a phone should carry to show one screen. The drafts view asks
      // for ?loose=true, which is a handful of rows, so it is unaffected.
      const take = Math.min(Math.max(Number(query.limit ?? 100) || 100, 1), 500);
      const skip = Math.max(Number(query.offset ?? 0) || 0, 0);

      const receipts = await prisma.receipt.findMany({
        where: filters,
        orderBy: { createdAt: 'desc' },
        include: { files: true },
        take,
        skip,
      });

      return receipts.map(serializeReceipt);
    },
    {
      query: t.Object({
        bundleId: t.Optional(t.String()),
        loose: t.Optional(t.String()),
        mine: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  .post(
    '/',
    async ({ user, body, status }) => {
      let parsed: ParsedReceiptInput;
      try {
        parsed = await parseReceiptMultipart(body);
        assertRequiredCreateFields(parsed);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Invalid request body';
        return status(400, { message });
      }

      // Draining shared files: adopt the already-stored photos rather than
      // making the phone upload the same bytes again. Scoped to the caller in
      // the WHERE clause, so one employee can never adopt another's file by
      // guessing an id — the lookup simply finds nothing.
      let inboxItems: Awaited<ReturnType<typeof prisma.receiptInbox.findMany>> = [];
      if (parsed.inboxIds !== undefined && parsed.inboxIds.length > 0) {
        inboxItems = await prisma.receiptInbox.findMany({
          where: { id: { in: parsed.inboxIds }, userId: user.id },
        });
        if (inboxItems.length !== parsed.inboxIds.length) {
          // All or nothing: silently dropping one of three shared pages would
          // produce a receipt that looks complete and is not.
          return status(404, { message: 'Inbox item not found' });
        }
        // Preserve the order the client asked for, not the database's.
        const order = new Map(parsed.inboxIds.map((id, i) => [id, i]));
        inboxItems.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      }

      // Attachment order: files picked in the form first (an explicit upload is
      // the photo the employee most recently chose), then drained shares.
      const attachments = [
        ...(parsed.uploadedPaths ?? []),
        // Each drained item contributes ALL of its pages, so a shared
        // three-page invoice arrives as three attachments.
        ...inboxItems.flatMap((item) => {
          const pages = item.pagePaths.length > 0 ? item.pagePaths : [item.photoPath];
          return pages.map((path, i) => ({
            photoPath: path,
            originalPath: i === 0 ? item.originalPath : null,
            mimeType: item.mimeType,
            filename: item.filename
              ? `${item.filename.slice(0, 110)}${pages.length > 1 ? ` (${i + 1})` : ''}`
              : null,
            sizeBytes: i === 0 ? item.sizeBytes : 0,
          }));
        }),
      ];

      // The cover mirrors the first attachment. Written together with `files`
      // and never on its own — that is the whole invariant keeping the legacy
      // column honest for screens that still read it.
      const photoPath = attachments[0]?.photoPath ?? null;

      // The vendor is resolved from the typed merchant on the way in, so there
      // is exactly one path to a vendorId and the client never posts one.
      const vendorId = await resolveVendorId(parsed.merchant);

      // One transaction so a receipt can never exist while its inbox rows also
      // still do — that would show the employee the same shared photos again
      // and invite a duplicate claim for the same expense.
      const created = await prisma.$transaction(async (tx) => {
        const receipt = await tx.receipt.create({
          data: {
            userId: user.id,
            merchant: parsed.merchant,
            vendorId,
            category: parsed.category,
            property: parsed.property ?? 'hf-hotel',
            quantity: parsed.quantity ?? null,
            amount: parsed.amount,
            date: parsed.date,
            note: parsed.note ?? null,
            color: parsed.color ?? '#F5EBD9',
            accent: parsed.accent ?? '#7E5E3A',
            items: parsed.items,
            tax: parsed.tax ?? '0',
            photoPath,
            files: {
              create: attachments.map((a, position) => ({
                photoPath: a.photoPath,
                originalPath: a.originalPath,
                mimeType: a.mimeType,
                filename: a.filename,
                sizeBytes: a.sizeBytes,
                position,
              })),
            },
          },
          include: { files: true },
        });

        if (inboxItems.length > 0) {
          // deleteMany, not delete: a concurrent drain of the same item (two
          // tabs, a double-tap) must not throw P2025 and lose the receipt that
          // was just created. Whoever gets there second simply deletes nothing.
          await tx.receiptInbox.deleteMany({
            where: { id: { in: inboxItems.map((i) => i.id) }, userId: user.id },
          });
        }

        return receipt;
      });

      // Anything the drained items held that the receipt did NOT adopt is now
      // unreachable, so reclaim it. `originalPath` always qualifies: a
      // ReceiptFile keeps it, so it is carried over above — nothing to delete
      // here unless an attachment was dropped.
      const adopted = new Set(created.files.map((f) => f.photoPath));
      const orphaned = inboxItems.flatMap((item) =>
        [...item.pagePaths, item.photoPath, item.originalPath].filter(
          (p) => p !== null && !adopted.has(p),
        ),
      );
      if (orphaned.length > 0) await deleteUploadedFiles(orphaned);

      return serializeReceipt(created);
    },
    {
      body: receiptMultipartBody,
      type: 'multipart/form-data',
    },
  )

  .get('/:id', async ({ user, params, status }) => {
    const receipt = await prisma.receipt.findUnique({
      where: { id: params.id },
      include: { files: true },
    });
    if (!receipt) {
      return status(404, { message: 'Receipt not found' });
    }

    if (user.role !== 'APPROVER' && receipt.userId !== user.id) {
      return status(403, { message: 'Forbidden' });
    }

    return serializeReceipt(receipt);
  })

  .patch(
    '/:id',
    async ({ user, params, body, status }) => {
      const existing = await prisma.receipt.findUnique({
        where: { id: params.id },
        include: { files: true },
      });
      if (!existing) {
        return status(404, { message: 'Receipt not found' });
      }
      if (user.role !== 'APPROVER' && existing.userId !== user.id) {
        return status(403, { message: 'Forbidden' });
      }
      if (existing.bundleId !== null) {
        // Attached receipts are part of a submitted request the approver may
        // already have reviewed or paid; rejection detaches them first.
        return status(409, { message: 'Receipt is attached to a bundle and cannot be edited' });
      }

      let parsed: ParsedReceiptInput;
      try {
        parsed = await parseReceiptMultipart(body);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Invalid request body';
        return status(400, { message });
      }

      // A PATCH that omits `merchant` leaves `vendorId` untouched; one that
      // blanks it clears the link back to null.
      const vendorPatch =
        parsed.merchant === undefined
          ? {}
          : { vendorId: await resolveVendorId(parsed.merchant) };

      const updated = await prisma.receipt.update({
        include: { files: true },
        where: { id: params.id },
        data: {
          ...vendorPatch,
          ...(parsed.merchant !== undefined ? { merchant: parsed.merchant } : {}),
          ...(parsed.category !== undefined ? { category: parsed.category } : {}),
          ...(parsed.property !== undefined ? { property: parsed.property } : {}),
          ...(parsed.quantity !== undefined ? { quantity: parsed.quantity } : {}),
          ...(parsed.amount !== undefined ? { amount: parsed.amount } : {}),
          ...(parsed.date !== undefined ? { date: parsed.date } : {}),
          ...(parsed.note !== undefined ? { note: parsed.note } : {}),
          ...(parsed.color !== undefined ? { color: parsed.color } : {}),
          ...(parsed.accent !== undefined ? { accent: parsed.accent } : {}),
          ...(parsed.items !== undefined ? { items: parsed.items } : {}),
          ...(parsed.tax !== undefined ? { tax: parsed.tax } : {}),
          // photoPath is written ONLY alongside the matching `files` rows below,
          // never on its own — see the invariant on Receipt.photoPath.
          ...(parsed.photoPath !== undefined ? { photoPath: parsed.photoPath } : {}),
          ...(parsed.uploadedPaths !== undefined && parsed.uploadedPaths.length > 0
            ? {
                files: {
                  // Appended after whatever is already attached. An edit that
                  // adds a page must not silently drop the pages already there.
                  create: parsed.uploadedPaths.map((a, i) => ({
                    photoPath: a.photoPath,
                    originalPath: a.originalPath,
                    mimeType: a.mimeType,
                    filename: a.filename,
                    sizeBytes: a.sizeBytes,
                    position: existing.files.length + i,
                  })),
                },
              }
            : {}),
        },
      });

      // A newly uploaded photo becomes the cover, so the mirror has to follow.
      // Re-read rather than trust `updated`: the create above appended rows and
      // position 0 may be an older file.
      const cover = updated.files.slice().sort((a, b) => a.position - b.position)[0];
      if (cover && updated.photoPath !== cover.photoPath) {
        await prisma.receipt.update({
          where: { id: params.id },
          data: { photoPath: cover.photoPath },
        });
        updated.photoPath = cover.photoPath;
      }

      return serializeReceipt(updated);
    },
    {
      body: receiptMultipartBody,
      type: 'multipart/form-data',
    },
  )

  .delete('/:id', async ({ user, params, status, set }) => {
    const existing = await prisma.receipt.findUnique({
      where: { id: params.id },
      include: { files: true },
    });
    if (!existing) {
      return status(404, { message: 'Receipt not found' });
    }
    if (user.role !== 'APPROVER' && existing.userId !== user.id) {
      return status(403, { message: 'Forbidden' });
    }
    if (existing.bundleId !== null) {
      return status(409, { message: 'Receipt is attached to a bundle and cannot be deleted' });
    }

    await prisma.receipt.delete({ where: { id: params.id } });
    // Reclaim EVERY attachment, not just the cover — a three-page receipt would
    // otherwise leave two files behind forever. `photoPath` is included as a
    // belt-and-braces for any legacy row whose backfill never ran.
    await deleteUploadedFiles([
      ...existing.files.flatMap((f) => [f.photoPath, f.originalPath]),
      existing.photoPath,
    ]);
    set.status = 204;
    return null;
  });
