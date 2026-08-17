import { Elysia, t } from 'elysia';
import type { ReceiptItem } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { deleteUploadedFiles, saveUploadedFile } from '../uploads';
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
  /** Set when the photo came from the share inbox; the row is consumed on save. */
  inboxId?: string;
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

  if (body.photo) {
    parsed.photoPath = await saveUploadedFile(body.photo);
  }

  // Ownership cannot be checked here (no `user` in scope), so this only carries
  // the id forward — the create handler resolves it against the caller.
  if (body.inboxId !== undefined && body.inboxId.length > 0) {
    parsed.inboxId = body.inboxId;
  }

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

      // Draining a shared file: adopt the already-stored photo rather than
      // making the phone upload the same bytes again. Scoped to the caller in
      // the WHERE clause, so one employee can never adopt another's file by
      // guessing an id — the lookup simply finds nothing.
      let inboxItem = null;
      if (parsed.inboxId !== undefined) {
        inboxItem = await prisma.receiptInbox.findFirst({
          where: { id: parsed.inboxId, userId: user.id },
        });
        if (!inboxItem) {
          return status(404, { message: 'Inbox item not found' });
        }
      }

      // An explicitly uploaded photo wins over the inbox one: if the employee
      // re-shot the receipt in the form, that is the photo they meant.
      const photoPath = parsed.photoPath ?? inboxItem?.photoPath ?? null;

      // The vendor is resolved from the typed merchant on the way in, so there
      // is exactly one path to a vendorId and the client never posts one.
      const vendorId = await resolveVendorId(parsed.merchant);

      // One transaction so a receipt can never exist while its inbox row also
      // still does — that would show the employee the same shared photo again
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
          },
        });

        if (inboxItem) {
          // deleteMany, not delete: a concurrent drain of the same item (two
          // tabs, a double-tap) must not throw P2025 and lose the receipt that
          // was just created. Whoever gets there second simply deletes nothing.
          await tx.receiptInbox.deleteMany({ where: { id: inboxItem.id, userId: user.id } });
        }

        return receipt;
      });

      // The receipt now owns `photoPath`. Anything the shared item held that the
      // receipt did NOT adopt is unreachable from here on, so reclaim it:
      // the source PDF always (a Receipt has no field for it), and the shared
      // render too when the employee re-shot the photo in the form.
      if (inboxItem) {
        const orphaned = [inboxItem.originalPath];
        if (created.photoPath !== inboxItem.photoPath) orphaned.push(inboxItem.photoPath);
        await deleteUploadedFiles(orphaned);
      }

      return serializeReceipt(created);
    },
    {
      body: receiptMultipartBody,
      type: 'multipart/form-data',
    },
  )

  .get('/:id', async ({ user, params, status }) => {
    const receipt = await prisma.receipt.findUnique({ where: { id: params.id } });
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
      const existing = await prisma.receipt.findUnique({ where: { id: params.id } });
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
          ...(parsed.photoPath !== undefined ? { photoPath: parsed.photoPath } : {}),
        },
      });

      return serializeReceipt(updated);
    },
    {
      body: receiptMultipartBody,
      type: 'multipart/form-data',
    },
  )

  .delete('/:id', async ({ user, params, status, set }) => {
    const existing = await prisma.receipt.findUnique({ where: { id: params.id } });
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
    // Reclaim the bytes. Safe by the guard above: a receipt can only be deleted
    // while unbundled, and each upload has its own UUID filename, so nothing
    // else points at this file.
    await deleteUploadedFiles([existing.photoPath]);
    set.status = 204;
    return null;
  });
