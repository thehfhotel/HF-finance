import type {
  AdminUser,
  Bundle as SharedBundle,
  BundleStatus,
  BundleWithDetails,
  Receipt as SharedReceipt,
  ReceiptItem,
  Role,
  User as SharedUser,
} from '@reimbursement/shared';
import type {
  Bundle as PrismaBundle,
  BundleStatus as PrismaBundleStatus,
  Receipt as PrismaReceipt,
  Role as PrismaRole,
  User as PrismaUser,
} from './generated/prisma';
import type { KbizPaymentContext } from './kbiz';

/**
 * Convert Prisma database rows into the shared API contract types
 * consumed by `apps/web`. All Decimal/Date/enum values are normalized
 * here so route handlers can return the result directly.
 */

const BUNDLE_STATUS_MAP: Record<PrismaBundleStatus, BundleStatus> = {
  DRAFT: 'draft',
  PENDING: 'pending',
  APPROVED: 'approved',
  PAYING: 'paying',
  PAID: 'paid',
  REJECTED: 'rejected',
};

const ROLE_MAP: Record<PrismaRole, Role> = {
  EMPLOYEE: 'employee',
  APPROVER: 'approver',
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
    email: user.email,
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
    paymentIntentId: bundle.paymentIntentId,
    paymentError: bundle.paymentError,
    payingSince: bundle.payingSince ? bundle.payingSince.toISOString() : null,
    createdAt: bundle.createdAt.toISOString(),
  };
}

/**
 * Can this bundle actually be paid through KBIZ right now?
 *
 * Computed on the server so the web app never has to know how payment is wired
 * up: the feature has to be provisioned on this host, the bundle has to be
 * sitting in APPROVED, and there has to be money to move.
 *
 * Deliberately NOT gated on the submitter's mapped payee handle any more. Since
 * the pay-time picker landed a destination no longer has to be a handle — a
 * synced KBIZ favorite or an account the approver types are equally valid — so
 * requiring a mapping here hid the picker from exactly the submitters it was
 * built for, and the only way to reach it was to invent a bogus mapping purely
 * to unlock a button. WHERE the money goes is decided at pay time instead: the
 * picker offers what actually exists, and POST /pay-via-kbiz still refuses a
 * body-less call from a submitter with no mapping (409).
 */
function computeKbizPayable(
  bundle: PrismaBundle,
  receipts: PrismaReceipt[],
  kbiz: KbizPaymentContext,
): boolean {
  if (!kbiz.configured) return false;
  if (bundle.status !== 'APPROVED') return false;
  return receipts.reduce((total, receipt) => total + Number(receipt.amount), 0) > 0;
}

/**
 * `kbiz` is optional and loaded ONCE per request by the caller — never per
 * bundle. The list endpoint returns up to 200 of these, and re-inspecting the
 * shared queue directory for each one would turn one render into 200 filesystem
 * round trips. Omitted → `kbizPayable` is absent, as the contract allows.
 */
export function serializeBundleWithDetails(
  bundle: PrismaBundle & {
    receipts: PrismaReceipt[];
    user: PrismaUser;
    approver?: PrismaUser | null;
  },
  kbiz?: KbizPaymentContext,
): BundleWithDetails {
  return {
    ...serializeBundle(bundle),
    ...(kbiz ? { kbizPayable: computeKbizPayable(bundle, bundle.receipts, kbiz) } : {}),
    receipts: bundle.receipts.map(serializeReceipt),
    submitter: { name: bundle.user.name, initials: bundle.user.initials },
    approver: bundle.approver
      ? { name: bundle.approver.name, initials: bundle.approver.initials }
      : null,
  };
}

/**
 * Admin-only user shape that exposes the account creation timestamp.
 * Returned exclusively from `/api/admin/*` endpoints, which are gated to
 * APPROVER role.
 */
export function serializeAdminUser(user: PrismaUser): AdminUser {
  return {
    ...serializeUser(user),
    createdAt: user.createdAt.toISOString(),
  };
}
