import { Elysia, t } from 'elysia';
import type { VendorSearchResponse, VendorSuggestion } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 25;

/**
 * Merchant autocomplete for the receipt form.
 *
 * Auth-required like every route, but deliberately NOT role-gated: vendor names
 * are a merchant list the whole team types, and employees are the ones who need
 * the suggestions.
 *
 * Matching runs through `vendor_normalize()` on both sides, so the dropdown
 * finds exactly what a save would match — a query that looks like a hit here can
 * never resolve to a different vendor on POST.
 */
export const vendorRoutes = new Elysia({ prefix: '/vendors' })
  .use(auth)

  .get(
    '/',
    async ({ query }) => {
      const q = (query.q ?? '').trim();
      const limit = Math.min(
        Math.max(Number(query.limit ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1),
        MAX_LIMIT,
      );

      // `position(… in …)` rather than LIKE '%'||q||'%' — no %/_/\ escaping bug
      // is possible, and at a few hundred vendors the scan is free. starts_with
      // promotes prefix hits above substring hits, which is what makes typing
      // "แม็ค" feel right.
      const rows = await prisma.$queryRaw<
        Array<{ id: string; name: string; receiptCount: number }>
      >`
        SELECT v."id", v."name", COUNT(r."id")::int AS "receiptCount"
        FROM "vendors" v
        LEFT JOIN "receipts" r ON r."vendorId" = v."id"
        WHERE ${q} = '' OR position(vendor_normalize(${q}) in v."normalizedName") > 0
        GROUP BY v."id", v."name", v."normalizedName"
        ORDER BY starts_with(v."normalizedName", vendor_normalize(${q})) DESC,
                 COUNT(r."id") DESC,
                 v."name" ASC
        LIMIT ${limit}
      `;

      const vendors: VendorSuggestion[] = rows.map((row) => ({
        id: row.id,
        name: row.name,
        receiptCount: Number(row.receiptCount),
      }));

      return { vendors } satisfies VendorSearchResponse;
    },
    {
      query: t.Object({
        q: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
    },
  );
