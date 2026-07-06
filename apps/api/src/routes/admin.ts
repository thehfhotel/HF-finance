import { Elysia, t } from 'elysia';
import type { Role } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { serializeAdminUser } from '../serializers';

function roleFromShared(role: Role): 'EMPLOYEE' | 'APPROVER' | 'ADMIN' {
  if (role === 'approver') return 'APPROVER';
  if (role === 'admin') return 'ADMIN';
  return 'EMPLOYEE';
}

const LINE_CODE_MIN = 100000;
const LINE_CODE_RANGE = 900000;
const LINE_CODE_MAX_GENERATION_ATTEMPTS = 100;
const LINE_CODE_EXPIRY_HOURS = 24;
const HOUR_IN_MILLISECONDS = 60 * 60 * 1000;

/**
 * Normalize an optional badge input: trim, and collapse empty string to null so
 * the unique index never sees "" (which would collide across badge-less rows).
 */
function normalizeBadge(badge: string | null | undefined): string | null | undefined {
  if (badge === undefined) return undefined;
  if (badge === null) return null;
  const trimmed = badge.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/** True when a Prisma error is a unique-constraint violation on `badge`. */
function isBadgeConflict(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002' &&
    String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes('badge')
  );
}

/**
 * Generates a random 6-digit numeric code (e.g. "402913"). The code is
 * always exactly 6 digits — no leading-zero pitfalls because we offset
 * into the [100000, 999999] inclusive range.
 */
function generateSixDigitCode(): string {
  return Math.floor(LINE_CODE_MIN + Math.random() * LINE_CODE_RANGE).toString();
}

/**
 * Generates a 6-digit code that does not collide with any existing
 * `lineLinkingCode` in the users table. Returns `null` if a unique
 * code could not be found within {@link LINE_CODE_MAX_GENERATION_ATTEMPTS}
 * attempts (extremely unlikely given a 900k-wide search space).
 */
async function generateUniqueLineLinkingCode(): Promise<string | null> {
  for (let attempt = 0; attempt < LINE_CODE_MAX_GENERATION_ATTEMPTS; attempt += 1) {
    const candidate = generateSixDigitCode();
    const collision = await prisma.user.findUnique({
      where: { lineLinkingCode: candidate },
    });
    if (!collision) {
      return candidate;
    }
  }
  return null;
}

/**
 * Computes the ISO expiry timestamp for a freshly issued binding code.
 * Mirrors the 24-hour expiry policy used by the fingerprint-time-logger
 * reference implementation.
 */
function computeLineCodeExpiry(generatedAt: Date): string {
  return new Date(
    generatedAt.getTime() + LINE_CODE_EXPIRY_HOURS * HOUR_IN_MILLISECONDS,
  ).toISOString();
}

/**
 * Admin-only routes for managing internal users and LINE binding codes.
 *
 * Mounted under `/api/admin` by `index.ts`. Every endpoint requires the
 * caller to have role `APPROVER`; non-approvers receive 403.
 */
export const adminRoutes = new Elysia({ prefix: '/admin' })
  .use(auth)
  .onBeforeHandle(({ user, status }) => {
    if (user.role !== 'APPROVER') {
      return status(403, { message: 'Approver access required' });
    }
  })

  .get('/users', async () => {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return users.map(serializeAdminUser);
  })

  .post(
    '/users',
    async ({ body, status }) => {
      try {
        const created = await prisma.user.create({
          data: {
            name: body.name,
            initials: body.initials,
            role: roleFromShared(body.role),
            badge: normalizeBadge(body.badge) ?? null,
            lineId: null,
            lineDisplayName: null,
            linePictureUrl: null,
            lineLinkingCode: null,
            lineLinkingCodeGeneratedAt: null,
          },
        });
        return serializeAdminUser(created);
      } catch (err) {
        if (isBadgeConflict(err)) {
          return status(409, { message: 'รหัสบัตร (badge) นี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        initials: t.String({ minLength: 1, maxLength: 4 }),
        role: t.Union([t.Literal('employee'), t.Literal('approver'), t.Literal('admin')]),
        badge: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  .patch(
    '/users/:id',
    async ({ params, body, status }) => {
      const existing = await prisma.user.findUnique({ where: { id: params.id } });
      if (!existing) {
        return status(404, { message: 'User not found' });
      }

      const updates: {
        name?: string;
        initials?: string;
        role?: 'EMPLOYEE' | 'APPROVER' | 'ADMIN';
        badge?: string | null;
      } = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.initials !== undefined) updates.initials = body.initials;
      if (body.role !== undefined) {
        updates.role = roleFromShared(body.role);
      }
      const normalizedBadge = normalizeBadge(body.badge);
      if (normalizedBadge !== undefined) updates.badge = normalizedBadge;

      try {
        const updated = await prisma.user.update({
          where: { id: params.id },
          data: updates,
        });
        return serializeAdminUser(updated);
      } catch (err) {
        if (isBadgeConflict(err)) {
          return status(409, { message: 'รหัสบัตร (badge) นี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        initials: t.Optional(t.String({ minLength: 1, maxLength: 4 })),
        role: t.Optional(t.Union([t.Literal('employee'), t.Literal('approver'), t.Literal('admin')])),
        badge: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  .delete('/users/:id', async ({ params, status }) => {
    const existing = await prisma.user.findUnique({ where: { id: params.id } });
    if (!existing) {
      return status(404, { message: 'User not found' });
    }

    const [bundleCount, receiptCount, expenseCount] = await Promise.all([
      prisma.bundle.count({ where: { userId: params.id } }),
      prisma.receipt.count({ where: { userId: params.id } }),
      prisma.expense.count({ where: { enteredById: params.id } }),
    ]);

    if (bundleCount > 0 || receiptCount > 0 || expenseCount > 0) {
      return status(409, {
        message: 'User has existing bundles, receipts or ledger entries; remove them before deleting',
      });
    }

    await prisma.user.delete({ where: { id: params.id } });
    return status(204, null);
  })

  .post('/users/:id/line-code', async ({ params, status }) => {
    const existing = await prisma.user.findUnique({ where: { id: params.id } });
    if (!existing) {
      return status(404, { message: 'User not found' });
    }

    const code = await generateUniqueLineLinkingCode();
    if (!code) {
      return status(500, { message: 'Failed to generate a unique linking code' });
    }

    const generatedAt = new Date();

    // Regenerating implies a rebind from scratch: if the user is currently
    // bound to a LINE account, drop that binding so the new code can attach
    // a (possibly different) LINE identity. Mirrors the unlink-on-regenerate
    // behavior of fingerprint-time-logger.
    const isCurrentlyBound = existing.lineId !== null;

    await prisma.user.update({
      where: { id: params.id },
      data: {
        ...(isCurrentlyBound
          ? { lineId: null, lineDisplayName: null, linePictureUrl: null }
          : {}),
        lineLinkingCode: code,
        lineLinkingCodeGeneratedAt: generatedAt,
      },
    });

    return {
      code,
      expiresAt: computeLineCodeExpiry(generatedAt),
    };
  })

  .delete('/users/:id/line-code', async ({ params, status }) => {
    const existing = await prisma.user.findUnique({ where: { id: params.id } });
    if (!existing) {
      return status(404, { message: 'User not found' });
    }

    await prisma.user.update({
      where: { id: params.id },
      data: {
        lineLinkingCode: null,
        lineLinkingCodeGeneratedAt: null,
      },
    });

    return status(204, null);
  });
