import type {
  AdminUser,
  Bundle as SharedBundle,
  BundleStatus,
  BundleWithDetails,
  Expense as SharedExpense,
  PaymentMethod,
  Receipt as SharedReceipt,
  ReceiptItem,
  RevenueEntry as SharedRevenueEntry,
  Role,
  User as SharedUser,
} from '@reimbursement/shared';
import type {
  Bundle as PrismaBundle,
  BundleStatus as PrismaBundleStatus,
  Expense as PrismaExpense,
  Receipt as PrismaReceipt,
  RevenueEntry as PrismaRevenueEntry,
  Role as PrismaRole,
  User as PrismaUser,
} from './generated/prisma';

/**
 * Convert Prisma database rows into the shared API contract types
 * consumed by `apps/web`. All Decimal/Date/enum values are normalized
 * here so route handlers can return the result directly.
 */

const BUNDLE_STATUS_MAP: Record<PrismaBundleStatus, BundleStatus> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  PAID: 'paid',
  REJECTED: 'rejected',
};

const ROLE_MAP: Record<PrismaRole, Role> = {
  EMPLOYEE: 'employee',
  APPROVER: 'approver',
  ADMIN: 'admin',
};

export function bundleStatusToShared(status: PrismaBundleStatus): BundleStatus {
  return BUNDLE_STATUS_MAP[status];
}

export function bundleStatusFromShared(status: BundleStatus): PrismaBundleStatus {
  return status.toUpperCase() as PrismaBundleStatus;
}

export function roleToShared(role: PrismaRole): Role {
  return ROLE_MAP[role];
}

export function serializeUser(user: PrismaUser): SharedUser {
  return {
    id: user.id,
    name: user.name,
    role: roleToShared(user.role),
    initials: user.initials,
    badge: user.badge,
    lineId: user.lineId,
    lineDisplayName: user.lineDisplayName,
    linePictureUrl: user.linePictureUrl,
  };
}

export function serializeReceipt(receipt: PrismaReceipt): SharedReceipt {
  return {
    id: receipt.id,
    userId: receipt.userId,
    merchant: receipt.merchant,
    category: receipt.category,
    property: receipt.property === 'hf-ville' ? 'hf-ville' : 'hf-hotel',
    quantity: receipt.quantity,
    amount: Number(receipt.amount),
    date: receipt.date,
    note: receipt.note,
    color: receipt.color,
    accent: receipt.accent,
    items: (receipt.items ?? []) as unknown as ReceiptItem[],
    tax: receipt.tax,
    photoPath: receipt.photoPath,
    bundleId: receipt.bundleId,
    createdAt: receipt.createdAt.toISOString(),
  };
}

export function serializeBundle(bundle: PrismaBundle): SharedBundle {
  return {
    id: bundle.id,
    userId: bundle.userId,
    name: bundle.name,
    status: bundleStatusToShared(bundle.status),
    submittedAt: bundle.submittedAt.toISOString(),
    approvedAt: bundle.approvedAt ? bundle.approvedAt.toISOString() : null,
    approvedById: bundle.approvedById,
    paidAt: bundle.paidAt ? bundle.paidAt.toISOString() : null,
    transferRef: bundle.transferRef,
    transferAmount: bundle.transferAmount === null ? null : Number(bundle.transferAmount),
    transferProofPath: bundle.transferProofPath,
    note: bundle.note,
    rejectReason: bundle.rejectReason,
    createdAt: bundle.createdAt.toISOString(),
  };
}

export function serializeBundleWithDetails(
  bundle: PrismaBundle & {
    receipts: PrismaReceipt[];
    user: PrismaUser;
    approver?: PrismaUser | null;
  },
): BundleWithDetails {
  return {
    ...serializeBundle(bundle),
    receipts: bundle.receipts.map(serializeReceipt),
    submitter: { name: bundle.user.name, initials: bundle.user.initials },
    approver: bundle.approver
      ? { name: bundle.approver.name, initials: bundle.approver.initials }
      : null,
  };
}

export function serializeExpense(expense: PrismaExpense): SharedExpense {
  return {
    id: expense.id,
    enteredById: expense.enteredById,
    plLine: expense.plLine,
    expenseMonth: expense.expenseMonth,
    invoiceDate: expense.invoiceDate,
    billingPeriod: expense.billingPeriod,
    vendor: expense.vendor,
    amount: Number(expense.amount),
    paymentMethod: expense.paymentMethod === 'cash' ? 'cash' : ('transfer' as PaymentMethod),
    paid: expense.paid,
    dueDate: expense.dueDate,
    note: expense.note,
    photoPath: expense.photoPath,
    createdAt: expense.createdAt.toISOString(),
  };
}

export function serializeRevenueEntry(entry: PrismaRevenueEntry): SharedRevenueEntry {
  return {
    month: entry.month,
    rooms: Number(entry.rooms),
    waterBar: Number(entry.waterBar),
    other: Number(entry.other),
    updatedAt: entry.updatedAt.toISOString(),
  };
}

/**
 * Admin-only user shape that exposes the active LINE binding code and
 * timestamps. Returned exclusively from `/api/admin/*` endpoints, which
 * are gated to APPROVER role.
 */
export function serializeAdminUser(user: PrismaUser): AdminUser {
  return {
    ...serializeUser(user),
    lineLinkingCode: user.lineLinkingCode,
    lineLinkingCodeGeneratedAt: user.lineLinkingCodeGeneratedAt
      ? user.lineLinkingCodeGeneratedAt.toISOString()
      : null,
    createdAt: user.createdAt.toISOString(),
  };
}
