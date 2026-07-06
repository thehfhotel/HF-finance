// Shared types between apps/web (frontend) and apps/api (backend).
// Treat this file as the API contract — both sides import from here.

export * from './pl';
export * from './pl-history';

export type ReceiptItem = readonly [label: string, value: string];

/** The two HF properties that share this app. */
export type Property = 'hf-hotel' | 'hf-ville';

/**
 * The hotel-ops categories actually used in the historical Notion data.
 * Stored as plain strings so admins can add new ones without a migration,
 * but the UI dropdown uses this fixed list.
 */
export const RECEIPT_CATEGORIES = [
  'ต้นทุนอาหารเช้า HF',
  'อุปกรณ์โรงแรม',
  'อุปกรณ์แม่บ้าน',
  'อุปกรณ์ช่าง',
  'บาร์น้ำ',
  'โรงซักผ้า',
  'อุปกรณ์สำนักงาน reception',
  'อุปกรณ์สำนักงาน office',
  'ร้านอาทิตย์',
  'อื่น ๆ',
] as const;

export const PROPERTY_LABELS: Record<Property, string> = {
  'hf-hotel': 'HF Hotel',
  'hf-ville': 'HF Ville',
};

export interface Receipt {
  id: string;
  userId: string;
  merchant: string;
  category: string;
  property: Property;
  /** Optional unit count, e.g. "4 croissants". */
  quantity: number | null;
  amount: number;
  date: string; // YYYY-MM-DD
  note: string | null;
  /** Paper background hex (used by the SVG receipt visualization). */
  color: string;
  /** Ink/text accent hex. */
  accent: string;
  items: ReceiptItem[];
  tax: string;
  /** URL path to the uploaded photo (e.g. "/uploads/abc.jpg"), null if no photo. */
  photoPath: string | null;
  bundleId: string | null;
  createdAt: string;
}

export type BundleStatus = 'draft' | 'pending' | 'approved' | 'paid' | 'rejected';

export interface Submitter {
  name: string;
  /** Initials for avatar (e.g. "มย"). */
  initials: string;
}

export interface Bundle {
  id: string;
  userId: string;
  name: string;
  status: BundleStatus;
  submittedAt: string;
  approvedAt: string | null;
  approvedById: string | null;
  paidAt: string | null;
  transferRef: string | null;
  transferAmount: number | null;
  /** URL path to attached transfer screenshot. */
  transferProofPath: string | null;
  note: string;
  /** Why the bundle was rejected, if it was. */
  rejectReason: string | null;
  createdAt: string;
}

export type Role = 'employee' | 'approver' | 'admin';

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Initials for avatar (e.g. "มย"). */
  initials: string;
  /**
   * Central HF-ID badge (the OIDC `sub`). When set, the employee can log in by
   * tapping their NFC staff card at a terminal — the HF-ID service issues a
   * signed assertion whose `sub` we resolve back to this row. Null = card login
   * not available for this user (LINE login still works).
   */
  badge: string | null;
  lineId: string | null;
  lineDisplayName: string | null;
  linePictureUrl: string | null;
}

/**
 * Extended User shape only ever returned to approvers/admins. Includes
 * the active 6-digit linking code so the admin UI can show / share it.
 */
export interface AdminUser extends User {
  lineLinkingCode: string | null;
  lineLinkingCodeGeneratedAt: string | null;
  createdAt: string;
}

export interface CreateUserRequest {
  name: string;
  role: Role;
  initials: string;
  /** Optional HF-ID badge to enable NFC card login for this employee. */
  badge?: string | null;
}

export interface UpdateUserRequest extends Partial<CreateUserRequest> {}

/** Auth response: a JWT + a flag indicating whether the user has been linked. */
export interface AuthResponse {
  token: string;
  /** True once `userId` claim is set in the JWT (i.e. binding completed). */
  linked: boolean;
  /** Pre-link only: the LINE display name to greet the user with. */
  displayName?: string;
  pictureUrl?: string;
}

export interface LinkAccountRequest {
  /** 6-digit numeric code an admin generated. */
  code: string;
}

// ─── API contract types ──────────────────────────────────────────

export interface CreateReceiptRequest {
  merchant: string;
  category: string;
  property?: Property;
  quantity?: number | null;
  amount: number;
  date: string;
  note?: string;
  color?: string;
  accent?: string;
  items: ReceiptItem[];
  tax?: string;
}

export interface UpdateReceiptRequest extends Partial<CreateReceiptRequest> {}

export interface CreateBundleRequest {
  name: string;
  receiptIds: string[];
  note?: string;
}

export interface PayBundleRequest {
  transferRef: string;
}

// ─── View-model conveniences ─────────────────────────────────────

/**
 * A bundle joined with its receipts and submitter — what the UI usually
 * wants to render. Built on the server, returned as the GET /bundles/:id
 * response.
 */
export interface BundleWithDetails extends Bundle {
  receipts: Receipt[];
  submitter: Submitter;
  /** The approver who actioned this bundle, once approved/paid; null while pending. */
  approver: Submitter | null;
}
