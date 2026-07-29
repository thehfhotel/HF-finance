import { Elysia, t } from 'elysia';
import type { Role } from '@reimbursement/shared';
import { auth } from '../auth';
import { prisma } from '../db';
import { serializeAdminUser } from '../serializers';

function roleFromShared(role: Role): 'EMPLOYEE' | 'APPROVER' {
  if (role === 'approver') return 'APPROVER';
  return 'EMPLOYEE';
}

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

/**
 * Normalize an optional email input: trim, collapse empty string to null, and
 * lowercase so lookups (and the unique index) are case-insensitive in effect.
 */
function normalizeEmail(email: string | null | undefined): string | null | undefined {
  if (email === undefined) return undefined;
  if (email === null) return null;
  const trimmed = email.trim();
  return trimmed.length === 0 ? null : trimmed.toLowerCase();
}

/** True when a Prisma error is a unique-constraint violation on the given column. */
function isUniqueConflict(err: unknown, column: string): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: unknown }).code === 'P2002' &&
    String((err as { meta?: { target?: unknown } }).meta?.target ?? '').includes(column)
  );
}

/**
 * Admin-only routes for managing internal users.
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
            email: normalizeEmail(body.email) ?? null,
          },
        });
        return serializeAdminUser(created);
      } catch (err) {
        if (isUniqueConflict(err, 'badge')) {
          return status(409, { message: 'รหัสบัตร (badge) นี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        if (isUniqueConflict(err, 'email')) {
          return status(409, { message: 'อีเมลนี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        initials: t.String({ minLength: 1, maxLength: 4 }),
        role: t.Union([t.Literal('employee'), t.Literal('approver')]),
        badge: t.Optional(t.Union([t.String(), t.Null()])),
        email: t.Optional(t.Union([t.String(), t.Null()])),
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
        role?: 'EMPLOYEE' | 'APPROVER';
        badge?: string | null;
        email?: string | null;
      } = {};
      if (body.name !== undefined) updates.name = body.name;
      if (body.initials !== undefined) updates.initials = body.initials;
      if (body.role !== undefined) {
        updates.role = roleFromShared(body.role);
      }
      const normalizedBadge = normalizeBadge(body.badge);
      if (normalizedBadge !== undefined) updates.badge = normalizedBadge;
      const normalizedEmail = normalizeEmail(body.email);
      if (normalizedEmail !== undefined) updates.email = normalizedEmail;

      try {
        const updated = await prisma.user.update({
          where: { id: params.id },
          data: updates,
        });
        return serializeAdminUser(updated);
      } catch (err) {
        if (isUniqueConflict(err, 'badge')) {
          return status(409, { message: 'รหัสบัตร (badge) นี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        if (isUniqueConflict(err, 'email')) {
          return status(409, { message: 'อีเมลนี้ถูกใช้กับพนักงานคนอื่นแล้ว' });
        }
        throw err;
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        initials: t.Optional(t.String({ minLength: 1, maxLength: 4 })),
        role: t.Optional(t.Union([t.Literal('employee'), t.Literal('approver')])),
        badge: t.Optional(t.Union([t.String(), t.Null()])),
        email: t.Optional(t.Union([t.String(), t.Null()])),
      }),
    },
  )

  .delete('/users/:id', async ({ params, status }) => {
    const existing = await prisma.user.findUnique({ where: { id: params.id } });
    if (!existing) {
      return status(404, { message: 'User not found' });
    }

    const [bundleCount, receiptCount] = await Promise.all([
      prisma.bundle.count({ where: { userId: params.id } }),
      prisma.receipt.count({ where: { userId: params.id } }),
    ]);

    if (bundleCount > 0 || receiptCount > 0) {
      return status(409, {
        message: 'User has existing bundles or receipts; remove them before deleting',
      });
    }

    await prisma.user.delete({ where: { id: params.id } });
    return status(204, null);
  });
