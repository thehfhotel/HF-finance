import { Elysia, t } from 'elysia';
import type { ReceiptItem } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { saveUploadedFile } from '../uploads';
import { serializeReceipt } from '../serializers';

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

      const receipts = await prisma.receipt.findMany({
        where: filters,
        orderBy: { createdAt: 'desc' },
      });

      return receipts.map(serializeReceipt);
    },
    {
      query: t.Object({
        bundleId: t.Optional(t.String()),
        loose: t.Optional(t.String()),
        mine: t.Optional(t.String()),
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

      const created = await prisma.receipt.create({
        data: {
          userId: user.id,
          merchant: parsed.merchant,
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
          photoPath: parsed.photoPath ?? null,
        },
      });

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

      const updated = await prisma.receipt.update({
        where: { id: params.id },
        data: {
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
    set.status = 204;
    return null;
  });
