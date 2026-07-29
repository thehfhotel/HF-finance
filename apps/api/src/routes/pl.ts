import { Elysia, t } from 'elysia';
import {
  PL_HISTORY,
  PL_HISTORY_LAST_MONTH,
  PL_LINES,
  PL_LINE_BY_CODE,
  type MonthLedgerSummary,
  type PlReport,
  type PlReportLine,
} from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { serializeExpense, serializeRevenueEntry } from '../serializers';
import { aggregateMonth, buildChecklist } from './expenses';

const MONTH_RE = /^\d{4}-\d{2}$/;
const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * Monthly P&L (งบกำไรขาดทุน) routes. Mounted under `/api/pl`.
 *
 * Months up to PL_HISTORY_LAST_MONTH are served from the static accountant
 * transcription (read-only, authoritative); later months come from the live
 * ledger (admin expenses + reimbursement receipts + RevenueEntry).
 */
export const plRoutes = new Elysia({ prefix: '/pl' })
  .use(auth)
  .onBeforeHandle(({ user, status }) => {
    if (user.role !== 'ADMIN' && user.role !== 'APPROVER') {
      return status(403, { message: 'Admin access required' });
    }
  })

  // Dashboard payload for one month: per-line totals, checklist, entries.
  .get(
    '/summary',
    async ({ query, status }) => {
      if (!MONTH_RE.test(query.month)) {
        return status(400, { message: 'month must be YYYY-MM' });
      }
      const month = query.month;

      const [aggregation, revenueRow, expenses] = await Promise.all([
        aggregateMonth(month),
        prisma.revenueEntry.findUnique({ where: { month } }),
        prisma.expense.findMany({
          where: { expenseMonth: month },
          orderBy: { createdAt: 'desc' },
        }),
      ]);

      const summary: MonthLedgerSummary = {
        month,
        lines: aggregation.lines.filter((line) => line.amount > 0),
        expenseTotal: aggregation.expenseTotal,
        receiptsTotal: aggregation.receiptsTotal,
        checklist: buildChecklist(aggregation.lines),
        revenue: revenueRow ? serializeRevenueEntry(revenueRow) : null,
        expenses: expenses.map(serializeExpense),
      };
      return summary;
    },
    { query: t.Object({ month: t.String() }) },
  )

  // Upsert the month's revenue figures (rooms / water bar / other).
  .put(
    '/revenue',
    async ({ body, status }) => {
      if (!MONTH_RE.test(body.month)) {
        return status(400, { message: 'month must be YYYY-MM' });
      }
      if (body.month <= PL_HISTORY_LAST_MONTH) {
        return status(400, {
          message: `Months up to ${PL_HISTORY_LAST_MONTH} come from the accountant sheets and are read-only`,
        });
      }
      for (const key of ['rooms', 'waterBar', 'other'] as const) {
        if (!Number.isFinite(body[key]) || body[key] < 0) {
          return status(400, { message: `${key} must be a non-negative number` });
        }
      }

      const saved = await prisma.revenueEntry.upsert({
        where: { month: body.month },
        create: { month: body.month, rooms: body.rooms, waterBar: body.waterBar, other: body.other },
        update: { rooms: body.rooms, waterBar: body.waterBar, other: body.other },
      });
      return serializeRevenueEntry(saved);
    },
    {
      body: t.Object({
        month: t.String(),
        rooms: t.Number(),
        waterBar: t.Number(),
        other: t.Number(),
      }),
    },
  )

  // Full monthly งบกำไรขาดทุน — static history or live ledger.
  .get(
    '/report',
    async ({ query, status }) => {
      if (!MONTH_RE.test(query.month)) {
        return status(400, { message: 'month must be YYYY-MM' });
      }
      const month = query.month;

      if (month <= PL_HISTORY_LAST_MONTH) {
        const historyMonth = PL_HISTORY.find((m) => m.month === month);
        if (!historyMonth) {
          return status(404, { message: `No accountant sheet for ${month}` });
        }
        // Sheet-order lines: every line of the chart that either has an
        // amount this month or is active (renders as "-").
        const lines: PlReportLine[] = PL_LINES.filter(
          (line) => line.active || (historyMonth.expenses[line.code] ?? 0) > 0,
        ).map((line) => ({
          code: line.code,
          label: PL_LINE_BY_CODE[line.code].label,
          amount: round2(historyMonth.expenses[line.code] ?? 0),
        }));

        const report: PlReport = {
          month,
          source: 'accountant-sheet',
          revenue: historyMonth.revenue,
          revenueTotal: historyMonth.revenueTotal,
          lines,
          expenseTotal: historyMonth.expenseTotal,
          netProfit: historyMonth.netProfit,
        };
        return report;
      }

      const [aggregation, revenueRow] = await Promise.all([
        aggregateMonth(month),
        prisma.revenueEntry.findUnique({ where: { month } }),
      ]);

      const revenue = revenueRow
        ? serializeRevenueEntry(revenueRow)
        : { rooms: 0, waterBar: 0, other: 0 };
      const revenueTotal = round2(revenue.rooms + revenue.waterBar + revenue.other);

      const lines: PlReportLine[] = aggregation.lines
        .filter((line) => PL_LINE_BY_CODE[line.code].active || line.amount > 0)
        .map((line) => ({ code: line.code, label: line.label, amount: line.amount }));

      const report: PlReport = {
        month,
        source: 'ledger',
        revenue: { rooms: revenue.rooms, waterBar: revenue.waterBar, other: revenue.other },
        revenueTotal,
        lines,
        expenseTotal: aggregation.expenseTotal,
        netProfit: round2(revenueTotal - aggregation.expenseTotal),
      };
      return report;
    },
    { query: t.Object({ month: t.String() }) },
  );
