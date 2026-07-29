import { Elysia, t } from 'elysia';
import { auth } from '../auth';
import { prisma } from '../db';
import { saveUploadedFile } from '../uploads';
import { bundleStatusFromShared, serializeBundleWithDetails } from '../serializers';
import type { BundleStatus } from '@reimbursement/shared';

const SHARED_BUNDLE_STATUSES: readonly BundleStatus[] = [
  'draft',
  'pending',
  'approved',
  'paid',
  'rejected',
];

function isSharedBundleStatus(value: string): value is BundleStatus {
  return (SHARED_BUNDLE_STATUSES as readonly string[]).includes(value);
}

function sumReceiptAmounts(amounts: ReadonlyArray<{ amount: { toString(): string } }>): number {
  const total = amounts.reduce((accumulator, { amount }) => accumulator + Number(amount), 0);
  return Number(total.toFixed(2));
}

export const bundleRoutes = new Elysia({ prefix: '/bundles' })
  .use(auth)

  .get(
    '/',
    async ({ user, query, status }) => {
      const isApprover = user.role === 'APPROVER';
      const mine = query.mine === '1' || query.mine === 'true';
      const filters: Record<string, unknown> = {};

      if (!isApprover || mine) {
        filters.userId = user.id;
      }

      if (query.status !== undefined) {
        if (!isSharedBundleStatus(query.status)) {
          return status(400, { message: `Unknown status: ${query.status}` });
        }
        filters.status = bundleStatusFromShared(query.status);
      }
      // No default status filter: the approver UI builds its pending/approved/
      // paid/rejected tabs client-side from the unfiltered list, so forcing
      // PENDING here would leave every non-pending tab permanently empty.

      // Include receipts + approver so list items are full BundleWithDetails —
      // the UI sums receipt amounts and shows the approver, so omitting these
      // produced an undefined `receipts` crash once real bundles existed.
      const bundles = await prisma.bundle.findMany({
        where: filters,
        include: { receipts: true, user: true, approver: true },
        orderBy: { submittedAt: 'desc' },
      });

      return bundles.map(serializeBundleWithDetails);
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        mine: t.Optional(t.String()),
      }),
    },
  )

  .post(
    '/',
    async ({ user, body, status }) => {
      const { name, receiptIds, note } = body;

      if (receiptIds.length === 0) {
        return status(400, { message: 'receiptIds must not be empty' });
      }

      const receipts = await prisma.receipt.findMany({
        where: { id: { in: receiptIds } },
      });

      if (receipts.length !== receiptIds.length) {
        return status(400, { message: 'One or more receiptIds do not exist' });
      }

      for (const receipt of receipts) {
        if (receipt.userId !== user.id) {
          return status(403, { message: 'Cannot bundle receipts owned by another user' });
        }
        if (receipt.bundleId !== null) {
          return status(400, {
            message: `Receipt ${receipt.id} is already attached to a bundle`,
          });
        }
      }

      const submittedAt = new Date();

      const created = await prisma.$transaction(async (tx) => {
        const bundle = await tx.bundle.create({
          data: {
            userId: user.id,
            name,
            note: note ?? '',
            status: 'PENDING',
            submittedAt,
          },
        });

        await tx.receipt.updateMany({
          where: { id: { in: receiptIds } },
          data: { bundleId: bundle.id },
        });

        await tx.auditEvent.create({
          data: {
            type: 'submit',
            bundleId: bundle.id,
            actorId: user.id,
          },
        });

        return tx.bundle.findUniqueOrThrow({
          where: { id: bundle.id },
          include: { receipts: true, user: true, approver: true },
        });
      });

      return serializeBundleWithDetails(created);
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1 }),
        receiptIds: t.Array(t.String(), { minItems: 1 }),
        note: t.Optional(t.String()),
      }),
    },
  )

  .get('/:id', async ({ user, params, status }) => {
    const bundle = await prisma.bundle.findUnique({
      where: { id: params.id },
      include: { receipts: true, user: true, approver: true },
    });

    if (!bundle) {
      return status(404, { message: 'Bundle not found' });
    }

    if (user.role !== 'APPROVER' && bundle.userId !== user.id) {
      return status(403, { message: 'Forbidden' });
    }

    return serializeBundleWithDetails(bundle);
  })

  .post('/:id/approve', async ({ user, params, status }) => {
    if (user.role !== 'APPROVER') {
      return status(403, { message: 'Only approvers can approve bundles' });
    }

    const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
    if (!bundle) {
      return status(404, { message: 'Bundle not found' });
    }
    if (bundle.status !== 'PENDING') {
      return status(409, {
        message: `Cannot approve a ${bundle.status.toLowerCase()} bundle; only pending bundles can be approved`,
      });
    }

    const approvedAt = new Date();

    const updated = await prisma.$transaction(async (tx) => {
      const result = await tx.bundle.update({
        where: { id: params.id },
        data: {
          status: 'APPROVED',
          approvedAt,
          approvedById: user.id,
        },
        include: { receipts: true, user: true, approver: true },
      });

      await tx.auditEvent.create({
        data: {
          type: 'approve',
          bundleId: params.id,
          actorId: user.id,
        },
      });

      return result;
    });

    return serializeBundleWithDetails(updated);
  })

  .post(
    '/:id/reject',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can reject bundles' });
      }

      const bundle = await prisma.bundle.findUnique({ where: { id: params.id } });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }
      if (bundle.status !== 'PENDING') {
        return status(409, {
          message: `Cannot reject a ${bundle.status.toLowerCase()} bundle; only pending bundles can be rejected`,
        });
      }

      const reason = body.reason?.trim() || null;

      const updated = await prisma.$transaction(async (tx) => {
        // Return the receipts to the submitter's draft pool so they can be
        // fixed and resubmitted — otherwise a rejection is a dead-end (the
        // receipts stay locked to the rejected bundle forever).
        await tx.receipt.updateMany({
          where: { bundleId: params.id },
          data: { bundleId: null },
        });

        const result = await tx.bundle.update({
          where: { id: params.id },
          data: { status: 'REJECTED', rejectReason: reason },
          include: { receipts: true, user: true, approver: true },
        });

        await tx.auditEvent.create({
          data: {
            type: 'reject',
            bundleId: params.id,
            actorId: user.id,
            metadata: reason ? { reason } : {},
          },
        });

        return result;
      });

      return serializeBundleWithDetails(updated);
    },
    {
      body: t.Object({ reason: t.Optional(t.String()) }),
    },
  )

  .post(
    '/:id/pay',
    async ({ user, params, body, status }) => {
      if (user.role !== 'APPROVER') {
        return status(403, { message: 'Only approvers can mark bundles as paid' });
      }

      const bundle = await prisma.bundle.findUnique({
        where: { id: params.id },
        include: { receipts: true },
      });
      if (!bundle) {
        return status(404, { message: 'Bundle not found' });
      }
      if (bundle.status !== 'APPROVED') {
        return status(409, {
          message: `Cannot pay a ${bundle.status.toLowerCase()} bundle; it must be approved first`,
        });
      }

      const transferProofPath = await saveUploadedFile(body.proof);
      const transferAmount = sumReceiptAmounts(bundle.receipts);
      const paidAt = new Date();

      const updated = await prisma.$transaction(async (tx) => {
        const result = await tx.bundle.update({
          where: { id: params.id },
          data: {
            status: 'PAID',
            paidAt,
            transferRef: body.transferRef,
            transferAmount,
            transferProofPath,
          },
          include: { receipts: true, user: true, approver: true },
        });

        await tx.auditEvent.create({
          data: {
            type: 'pay',
            bundleId: params.id,
            actorId: user.id,
            metadata: { transferRef: body.transferRef, transferAmount },
          },
        });

        return result;
      });

      return serializeBundleWithDetails(updated);
    },
    {
      body: t.Object({
        transferRef: t.String({ minLength: 1 }),
        proof: t.File(),
      }),
      type: 'multipart/form-data',
    },
  );
