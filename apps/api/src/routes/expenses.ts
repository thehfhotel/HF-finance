import { Elysia, t } from 'elysia';
import {
  PL_LINE_BY_CODE,
  PL_LINES,
  plLineForReceiptCategory,
  type ChecklistItem,
  type MonthLineAmount,
  type PaymentMethod,
} from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { saveUploadedFile } from '../uploads';
import { serializeExpense, serializeReceipt } from '../serializers';

const MONTH_RE = /^\d{4}-\d{2}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Multipart fields for POST/PATCH expense endpoints. Numeric/boolean fields
 * arrive as strings and are coerced in `parseExpenseMultipart`; the invoice
 * photo travels in the same payload (mirrors the receipts endpoints).
 */
const expenseMultipartBody = t.Object({
  plLine: t.Optional(t.String()),
  expenseMonth: t.Optional(t.String()),
  amount: t.Optional(t.String()),
  vendor: t.Optional(t.String()),
  invoiceDate: t.Optional(t.String()),
  billingPeriod: t.Optional(t.String()),
  paymentMethod: t.Optional(t.String()),
  paid: t.Optional(t.String()),
  dueDate: t.Optional(t.String()),
  note: t.Optional(t.String()),
  photo: t.Optional(t.File()),
});

interface ParsedExpenseInput {
  plLine?: string;
  expenseMonth?: string;
  amount?: number;
  vendor?: string;
  invoiceDate?: string | null;
  billingPeriod?: string | null;
  paymentMethod?: PaymentMethod;
  paid?: boolean;
  dueDate?: string | null;
  note?: string | null;
  photoPath?: string;
}

async function parseExpenseMultipart(
  body: typeof expenseMultipartBody.static,
): Promise<ParsedExpenseInput> {
  const parsed: ParsedExpenseInput = {};

  if (body.plLine !== undefined) {
    if (!PL_LINE_BY_CODE[body.plLine]) {
      throw new Error(`Unknown P&L line: ${body.plLine}`);
    }
    parsed.plLine = body.plLine;
  }

  if (body.expenseMonth !== undefined) {
    if (!MONTH_RE.test(body.expenseMonth)) {
      throw new Error('expenseMonth must be YYYY-MM');
    }
    parsed.expenseMonth = body.expenseMonth;
  }

  if (body.amount !== undefined) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('amount must be a positive number');
    }
    parsed.amount = amount;
  }

  if (body.vendor !== undefined) parsed.vendor = body.vendor;

  if (body.invoiceDate !== undefined) {
    if (body.invoiceDate === '') {
      parsed.invoiceDate = null;
    } else if (!DATE_RE.test(body.invoiceDate)) {
      throw new Error('invoiceDate must be YYYY-MM-DD');
    } else {
      parsed.invoiceDate = body.invoiceDate;
    }
  }

  if (body.billingPeriod !== undefined) {
    parsed.billingPeriod = body.billingPeriod.length === 0 ? null : body.billingPeriod;
  }

  if (body.paymentMethod !== undefined) {
    if (body.paymentMethod !== 'cash' && body.paymentMethod !== 'transfer') {
      throw new Error('paymentMethod must be cash or transfer');
    }
    parsed.paymentMethod = body.paymentMethod;
  }

  if (body.paid !== undefined) {
    parsed.paid = body.paid === 'true' || body.paid === '1';
  }

  if (body.dueDate !== undefined) {
    if (body.dueDate === '') {
      parsed.dueDate = null;
    } else if (!DATE_RE.test(body.dueDate)) {
      throw new Error('dueDate must be YYYY-MM-DD');
    } else {
      parsed.dueDate = body.dueDate;
    }
  }

  if (body.note !== undefined) parsed.note = body.note.length === 0 ? null : body.note;

  if (body.photo) {
    parsed.photoPath = await saveUploadedFile(body.photo);
  }

  return parsed;
}

/**
 * Company-expense ledger routes. Mounted under `/api/expenses`.
 *
 * Access: ADMIN (the office admin who enters paper invoices) and APPROVER
 * (managers, who also review reimbursements). Employees have no business
 * with the company ledger — 403.
 */
export const expenseRoutes = new Elysia({ prefix: '/expenses' })
  .use(auth)
  .onBeforeHandle(({ user, status }) => {
    if (user.role !== 'ADMIN' && user.role !== 'APPROVER') {
      return status(403, { message: 'Admin access required' });
    }
  })

  .get(
    '/',
    async ({ query, status }) => {
      if (query.month !== undefined && !MONTH_RE.test(query.month)) {
        return status(400, { message: 'month must be YYYY-MM' });
      }
      const expenses = await prisma.expense.findMany({
        where: query.month ? { expenseMonth: query.month } : {},
        orderBy: { createdAt: 'desc' },
      });
      return expenses.map(serializeExpense);
    },
    { query: t.Object({ month: t.Optional(t.String()) }) },
  )

  .post(
    '/',
    async ({ user, body, status }) => {
      let parsed: ParsedExpenseInput;
      try {
        parsed = await parseExpenseMultipart(body);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Invalid request body';
        return status(400, { message });
      }
      if (parsed.plLine === undefined || parsed.expenseMonth === undefined || parsed.amount === undefined) {
        return status(400, { message: 'plLine, expenseMonth and amount are required' });
      }

      const created = await prisma.expense.create({
        data: {
          enteredById: user.id,
          plLine: parsed.plLine,
          expenseMonth: parsed.expenseMonth,
          invoiceDate: parsed.invoiceDate ?? null,
          billingPeriod: parsed.billingPeriod ?? null,
          vendor: parsed.vendor ?? '',
          amount: parsed.amount,
          paymentMethod: parsed.paymentMethod ?? 'transfer',
          paid: parsed.paid ?? true,
          dueDate: parsed.dueDate ?? null,
          note: parsed.note ?? null,
          photoPath: parsed.photoPath ?? null,
        },
      });
      return serializeExpense(created);
    },
    { body: expenseMultipartBody, type: 'multipart/form-data' },
  )

  .patch(
    '/:id',
    async ({ params, body, status }) => {
      const existing = await prisma.expense.findUnique({ where: { id: params.id } });
      if (!existing) return status(404, { message: 'Expense not found' });

      let parsed: ParsedExpenseInput;
      try {
        parsed = await parseExpenseMultipart(body);
      } catch (parseError) {
        const message = parseError instanceof Error ? parseError.message : 'Invalid request body';
        return status(400, { message });
      }

      const updated = await prisma.expense.update({
        where: { id: params.id },
        data: {
          ...(parsed.plLine !== undefined ? { plLine: parsed.plLine } : {}),
          ...(parsed.expenseMonth !== undefined ? { expenseMonth: parsed.expenseMonth } : {}),
          ...(parsed.amount !== undefined ? { amount: parsed.amount } : {}),
          ...(parsed.vendor !== undefined ? { vendor: parsed.vendor } : {}),
          ...(parsed.invoiceDate !== undefined ? { invoiceDate: parsed.invoiceDate } : {}),
          ...(parsed.billingPeriod !== undefined ? { billingPeriod: parsed.billingPeriod } : {}),
          ...(parsed.paymentMethod !== undefined ? { paymentMethod: parsed.paymentMethod } : {}),
          ...(parsed.paid !== undefined ? { paid: parsed.paid } : {}),
          ...(parsed.dueDate !== undefined ? { dueDate: parsed.dueDate } : {}),
          ...(parsed.note !== undefined ? { note: parsed.note } : {}),
          ...(parsed.photoPath !== undefined ? { photoPath: parsed.photoPath } : {}),
        },
      });
      return serializeExpense(updated);
    },
    { body: expenseMultipartBody, type: 'multipart/form-data' },
  )

  .delete('/:id', async ({ params, status, set }) => {
    const existing = await prisma.expense.findUnique({ where: { id: params.id } });
    if (!existing) return status(404, { message: 'Expense not found' });
    await prisma.expense.delete({ where: { id: params.id } });
    set.status = 204;
    return null;
  })

  // Minimal employee list for the "พนักงานจ่ายไปก่อน" picker — deliberately
  // NOT the /api/admin/users payload (no LINE codes here).
  .get('/employees', async () => {
    const users = await prisma.user.findMany({
      where: { role: { in: ['EMPLOYEE', 'APPROVER'] } },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, initials: true },
    });
    return users;
  })

  // An invoice the employee paid out of pocket: becomes a Receipt owned by
  // that employee (category = the P&L line label, which the ledger rollup
  // maps back to the line), entering the normal bundle → approve → pay flow.
  .post(
    '/staff-receipt',
    async ({ body, status }) => {
      const employee = await prisma.user.findUnique({ where: { id: body.employeeId } });
      if (!employee) return status(404, { message: 'Employee not found' });

      const line = PL_LINE_BY_CODE[body.plLine];
      if (!line) return status(400, { message: `Unknown P&L line: ${body.plLine}` });

      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return status(400, { message: 'amount must be a positive number' });
      }
      if (!DATE_RE.test(body.date)) {
        return status(400, { message: 'date must be YYYY-MM-DD' });
      }

      let photoPath: string | null = null;
      if (body.photo) photoPath = await saveUploadedFile(body.photo);

      const created = await prisma.receipt.create({
        data: {
          userId: employee.id,
          merchant: body.vendor ?? '',
          category: line.label,
          property: 'hf-hotel',
          amount,
          date: body.date,
          note: body.note && body.note.length > 0 ? body.note : null,
          items: [],
          tax: '0',
          photoPath,
        },
      });
      return serializeReceipt(created);
    },
    {
      body: t.Object({
        employeeId: t.String(),
        plLine: t.String(),
        amount: t.String(),
        date: t.String(),
        vendor: t.Optional(t.String()),
        note: t.Optional(t.String()),
        photo: t.Optional(t.File()),
      }),
      type: 'multipart/form-data',
    },
  );

// ─── Month aggregation shared by summary + report ──────────────────

export interface MonthAggregation {
  lines: MonthLineAmount[];
  expenseTotal: number;
  receiptsTotal: number;
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Aggregate one month of the ledger: admin-entered expenses plus
 * reimbursement receipts (mapped category → P&L line). Receipts in
 * REJECTED bundles are excluded; loose/pending receipts count — they are
 * real purchases already made.
 */
export async function aggregateMonth(month: string): Promise<MonthAggregation> {
  const [expenses, receipts] = await Promise.all([
    prisma.expense.findMany({ where: { expenseMonth: month } }),
    prisma.receipt.findMany({
      where: {
        date: { startsWith: month },
        OR: [{ bundleId: null }, { bundle: { status: { not: 'REJECTED' } } }],
      },
    }),
  ]);

  const fromExpenses = new Map<string, number>();
  for (const expense of expenses) {
    const code = expense.plLine;
    fromExpenses.set(code, (fromExpenses.get(code) ?? 0) + Number(expense.amount));
  }

  const fromReceipts = new Map<string, number>();
  for (const receipt of receipts) {
    const code = plLineForReceiptCategory(receipt.category);
    fromReceipts.set(code, (fromReceipts.get(code) ?? 0) + Number(receipt.amount));
  }

  const lines: MonthLineAmount[] = PL_LINES.map((line) => {
    const exp = round2(fromExpenses.get(line.code) ?? 0);
    const rec = round2(fromReceipts.get(line.code) ?? 0);
    return {
      code: line.code,
      label: line.label,
      amount: round2(exp + rec),
      fromExpenses: exp,
      fromReceipts: rec,
    };
  });

  const expenseTotal = round2(lines.reduce((a, l) => a + l.amount, 0));
  const receiptsTotal = round2(lines.reduce((a, l) => a + l.fromReceipts, 0));
  return { lines, expenseTotal, receiptsTotal };
}

/** Completeness checklist: every recurring active line, done = has an amount. */
export function buildChecklist(lines: MonthLineAmount[]): ChecklistItem[] {
  const byCode = new Map(lines.map((l) => [l.code, l]));
  return PL_LINES.filter((line) => line.recurring && line.active).map((line) => {
    const amount = byCode.get(line.code)?.amount ?? 0;
    return { code: line.code, label: line.label, done: amount > 0, amount };
  });
}
