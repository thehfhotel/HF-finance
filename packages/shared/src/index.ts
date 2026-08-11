// Shared types between apps/web (frontend) and apps/api (backend).
// Treat this file as the API contract — both sides import from here.

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

/**
 * Bundle lifecycle. `paying` is the KBIZ automation window: an approver fired
 * "จ่ายผ่าน KBIZ", the payment intent is queued, and the bot is driving the
 * bank. It resolves forward to `paid` on a captured slip, or back to
 * `approved` when KBIZ confirmed the transfer never armed (safe to retry).
 * An ambiguous outcome leaves the bundle in `paying` with `paymentError` set —
 * that combination means "needs human verification", never auto-retried.
 *
 * `approved → paying → paid | approved`
 */
export type BundleStatus = 'draft' | 'pending' | 'approved' | 'paying' | 'paid' | 'rejected';

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
  /**
   * Id of the KBIZ payment intent currently owning this bundle (the queue
   * filename, `queue/<paymentIntentId>.json`). Stamped by the atomic
   * `approved → paying` flip, which is also the double-pay guard. Null when no
   * automated payment has ever been fired for this bundle.
   */
  paymentIntentId: string | null;
  /**
   * Set when the last KBIZ attempt did not cleanly succeed. On `status:
   * 'paying'` it means "needs verification" — the bot could not tell whether
   * the transfer landed, so the UI disables Pay and offers the two human
   * actions (attach the phone e-slip, or release back to `approved`). On
   * `status: 'approved'` it carries the reason of a confirmed-failed attempt.
   */
  paymentError: string | null;
  /**
   * ISO timestamp of when the bundle entered `paying`, null in every other
   * status. A transfer takes seconds plus however long the approver needs to
   * tap their phone, so a `paying` bundle much older than that is stranded —
   * the UI uses this to offer the manual override actions, and the API's
   * watchdog uses it to flag and alert on one nobody is coming back for.
   */
  payingSince: string | null;
  /**
   * Server-computed: true when this bundle can actually be paid through KBIZ
   * right now (approved, has a mapped payee handle, non-zero amount). The web
   * app uses it to show/hide the "จ่ายผ่าน KBIZ" action instead of re-deriving
   * the payee mapping client-side. Absent on payloads that don't compute it.
   */
  kbizPayable?: boolean;
  createdAt: string;
}

export type Role = 'employee' | 'approver';

export interface User {
  id: string;
  name: string;
  role: Role;
  /** Initials for avatar (e.g. "มย"). */
  initials: string;
  /**
   * Central HF-ID badge used by NFC card login and Cloudflare Access identity
   * mapping. When set, the employee can log in by tapping their staff card at
   * a terminal — the HF-ID service issues a signed assertion whose `sub` we
   * resolve back to this row. Null = card login not available for this user.
   */
  badge: string | null;
  /**
   * Login email for Cloudflare Access identity mapping, admin-managed, stored
   * lowercased. Managers use their real Gmail; employees usually resolve via
   * badge instead, through the synthetic `<badge>@emp.thehfhotel.org` address.
   */
  email: string | null;
}

/**
 * Extended User shape only ever returned to approvers/admins. Includes
 * the account creation timestamp so the admin UI can show it.
 */
export interface AdminUser extends User {
  createdAt: string;
}

export interface CreateUserRequest {
  name: string;
  role: Role;
  initials: string;
  /** Optional HF-ID badge to enable NFC card login for this employee. */
  badge?: string | null;
  /** Optional login email for Cloudflare Access identity mapping. */
  email?: string | null;
}

export interface UpdateUserRequest extends Partial<CreateUserRequest> {}

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

// ─── KBIZ payment integration ────────────────────────────────────
//
// Contract for the automated bank transfer, shared by three processes:
//
//   apps/api   writes a payment intent JSON into the shared queue dir
//              (`/srv/kbiz-queue/queue/<id>.json`) and polls it for a result.
//   apps/web   renders the payment state of a bundle.
//   kbiz-bot   (lives in thehfhotel/payroll, runs on evergreen) picks up
//              `status: 'approved'` intents, drives KBIZ with Playwright, and
//              patches its result back into the very same file.
//
// Everything below is therefore a cross-repo contract: changing a field name or
// a category id here changes what the bot must read. See
// docs/adr/0001-kbiz-transfer-automation.md.

/**
 * KBIZ's own expense categories, as offered by the category picker on the
 * fund-transfer page.
 *
 * The `id` values are the **live picker anchor ids pinned from the real KBIZ
 * page** — they are KBIZ's numbering, not ours, which is why they are sparse
 * and unordered (there is no 15…28, and `12 Other` sits last in the picker).
 * Never renumber, re-sort, or "tidy" them: the bot clicks the anchor whose id
 * matches, so a changed id silently files expenses under the wrong category.
 *
 * `en` is KBIZ's own label (useful when matching against the page); `th` is
 * what we show in our Thai-first UI.
 */
export const KBIZ_CATEGORIES = [
  { id: '1', en: 'Water Bill', th: 'ค่าน้ำ' },
  { id: '2', en: 'Electric Bill', th: 'ค่าไฟ' },
  { id: '3', en: 'Purchase', th: 'ซื้อสินค้า' },
  { id: '4', en: 'Rent, Utility, Phone', th: 'ค่าเช่า สาธารณูปโภค โทรศัพท์' },
  { id: '5', en: 'Payroll', th: 'เงินเดือน' },
  { id: '6', en: 'Maintenance', th: 'ซ่อมบำรุง' },
  { id: '7', en: 'Office Expenses', th: 'ค่าใช้จ่ายสำนักงาน' },
  { id: '8', en: 'Travel Expenses', th: 'ค่าเดินทาง' },
  { id: '9', en: 'Logistic Expenses', th: 'ค่าขนส่ง' },
  { id: '10', en: 'Food', th: 'ค่าอาหาร' },
  { id: '11', en: 'Wage', th: 'ค่าจ้าง' },
  { id: '13', en: 'Tax', th: 'ภาษี' },
  { id: '14', en: 'Advertising Expenses', th: 'ค่าโฆษณา' },
  { id: '29', en: 'Insurance', th: 'ประกันภัย' },
  { id: '30', en: 'Refund', th: 'คืนเงิน' },
  { id: '12', en: 'Other', th: 'อื่น ๆ' },
] as const;

/** One of KBIZ's picker anchor ids, e.g. `'10'` (Food / ค่าอาหาร). */
export type KbizCategoryId = (typeof KBIZ_CATEGORIES)[number]['id'];

/**
 * Admin-editable mapping from our receipt categories (free-form strings, see
 * `RECEIPT_CATEGORIES`) to KBIZ's fixed category ids. Stored as an AppSetting
 * under `SETTING_KBIZ_CATEGORY_MAPPING` so new receipt categories can be
 * mapped without a deploy.
 */
export interface KbizCategoryMapping {
  /** Receipt category string → KBIZ category id. Unlisted keys fall back. */
  categories: Record<string, KbizCategoryId>;
  /** Used for receipt categories with no entry above, and to break ties. */
  defaultCategoryId: KbizCategoryId;
}

/**
 * Seed mapping over `RECEIPT_CATEGORIES` — what a fresh install starts with
 * before an admin edits it. Hotel supplies and the Sunday shop are "purchases",
 * tooling/laundry are "maintenance", office stock is "office expenses",
 * breakfast + bar are "food"; anything else lands in `12 Other`.
 */
export const DEFAULT_KBIZ_CATEGORY_MAPPING: KbizCategoryMapping = {
  categories: {
    'ต้นทุนอาหารเช้า HF': '10',
    'บาร์น้ำ': '10',
    'อุปกรณ์ช่าง': '6',
    'โรงซักผ้า': '6',
    'อุปกรณ์สำนักงาน reception': '7',
    'อุปกรณ์สำนักงาน office': '7',
    'อุปกรณ์โรงแรม': '3',
    'อุปกรณ์แม่บ้าน': '3',
    'ร้านอาทิตย์': '3',
    'อื่น ๆ': '12',
  },
  defaultCategoryId: '12',
};

/**
 * Pick the single KBIZ category for a bundle: the one holding the largest
 * share of the bundle's baht. A bundle is one transfer, so it gets exactly one
 * category however mixed its receipts are.
 *
 * Receipt categories with no mapping entry accumulate onto
 * `defaultCategoryId` (they are, by definition, "other"). An exact tie between
 * two ids — and an empty bundle — also resolve to `defaultCategoryId`, so the
 * result never depends on receipt ordering.
 *
 * Pure and deterministic: the API writes the intent with it and the preview UI
 * shows it, and the two must always agree.
 */
export function resolveKbizCategoryId(
  receipts: Array<{ category: string; amount: number }>,
  mapping: KbizCategoryMapping,
): KbizCategoryId {
  const totals = new Map<KbizCategoryId, number>();
  for (const receipt of receipts) {
    const mapped: KbizCategoryId | undefined = mapping.categories[receipt.category];
    const id = mapped ?? mapping.defaultCategoryId;
    totals.set(id, (totals.get(id) ?? 0) + receipt.amount);
  }

  let best: KbizCategoryId | null = null;
  let bestTotal = -Infinity;
  let tied = false;
  for (const [id, total] of totals) {
    if (total > bestTotal) {
      best = id;
      bestTotal = total;
      tied = false;
    } else if (total === bestTotal) {
      tied = true;
    }
  }

  return best === null || tied ? mapping.defaultCategoryId : best;
}

/** KBIZ's memo field (บันทึกช่วยจำ) hard-limit. */
export const KBIZ_MEMO_MAX_LENGTH = 100;

/**
 * Strip a string down to what KBIZ's memo field actually accepts — verified
 * live: anything outside the Thai block, ASCII letters/digits and spaces is
 * rejected by the form (`#`, `·`, `.`, `฿`, newlines, emoji…).
 *
 * Disallowed runs become a single space rather than being deleted, so
 * "ค่าน้ำ/ค่าไฟ" stays two readable words. Whitespace is then collapsed and
 * trimmed and the result capped at `KBIZ_MEMO_MAX_LENGTH`. Idempotent:
 * sanitizing an already-sanitized string returns it unchanged.
 */
export function sanitizeKbizMemo(s: string): string {
  return s
    .replace(/[^\u0E00-\u0E7Fa-zA-Z0-9 ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, KBIZ_MEMO_MAX_LENGTH)
    .trimEnd();
}

/**
 * Build the transfer memo for a bundle: `"<title> <shortId>"`, e.g.
 * `"ค่าเดินทางไปประชุม 3FA9C1"`.
 *
 * `shortId` is the last 6 characters of the bundle id, upper-cased — the
 * handle an approver reads back off a bank statement. It is **always preserved
 * intact**: the title is what gets truncated to keep the sanitized whole within
 * `KBIZ_MEMO_MAX_LENGTH`. A title that sanitizes away to nothing yields just
 * the shortId.
 */
export function buildKbizMemo(title: string, bundleId: string): string {
  const shortId = sanitizeKbizMemo(bundleId.slice(-6).toUpperCase());
  // -1 leaves room for the single space that joins title and shortId.
  const titleBudget = KBIZ_MEMO_MAX_LENGTH - shortId.length - 1;
  if (titleBudget <= 0) return shortId;

  const safeTitle = sanitizeKbizMemo(title);
  const head = safeTitle.length > titleBudget ? safeTitle.slice(0, titleBudget).trimEnd() : safeTitle;
  return head ? `${head} ${shortId}` : shortId;
}

/**
 * The queue-file contract: `<sharedDir>/queue/<id>.json`.
 *
 * apps/api writes the file with `status: 'approved'`; kbiz-bot claims it
 * (`running`), drives KBIZ, then patches `status` + `result` back into the same
 * file. apps/api polls for a terminal `status` and reconciles the bundle.
 * Fields written by the bot are optional here because they are absent at write
 * time.
 */
export interface KbizPaymentIntent {
  /** Unique per attempt, and also the queue filename. A retry gets a new id. */
  id: string;
  /** Which app queued this. The bot routes results by it; always our name. */
  app: 'reimbursement';
  /** The bot flow to run. Ad-hoc single transfer to a saved KBIZ account. */
  type: 'transfer-other';
  /**
   * Queue state, owned by the bot after pickup:
   * `approved`     — queued, waiting; the only state the bot picks up.
   * `running`      — claimed, KBIZ is being driven (never auto-re-run).
   * `done`         — finished; see `result.outcome`.
   * `failed`       — finished, nothing moved.
   * `needs-review` — finished ambiguously; a human must resolve it.
   */
  status: 'approved' | 'running' | 'done' | 'failed' | 'needs-review';
  /** ISO timestamp of when apps/api wrote the intent. */
  createdAt: string;
  /** The bundle this pays. Mirrored by `Bundle.paymentIntentId`. */
  bundleId: string;
  /**
   * Who gets paid, indirected through the bot's own config. We never store or
   * transmit bank/account numbers — KBIZ owns those in its saved accounts.
   */
  payee: {
    /** Bot-side payee handle, e.g. `'revew'` → its saved-account nickname. */
    handle: string;
  };
  /** Baht, server-computed as Σ receipts. Decimal, e.g. 1234.5. */
  amount: number;
  /** Already sanitized by `buildKbizMemo` — the bot types it verbatim. */
  memo: string;
  /** KBIZ expense category, from `resolveKbizCategoryId`. */
  kbizCategoryId: KbizCategoryId;
  /**
   * Thai payment voucher rendered by apps/web-side templating, path relative to
   * the shared dir, e.g. `"vouchers/<id>.html"`. The bot converts it to PDF
   * with its own Chromium and attaches it to the transfer. Omitted = no
   * attachment.
   */
  voucherFile?: string;
  /** Written by the bot when it finishes; absent while queued or running. */
  result?: {
    /**
     * `success`          — slip/reference captured, safe to mark paid.
     * `confirmed-failed` — KBIZ errored before arming; nothing moved, retryable.
     * `unconfirmed`      — timed out/crashed mid-flight; the transfer may or may
     *                      not have landed. Never auto-retried, never auto-paid.
     */
    outcome: 'success' | 'confirmed-failed' | 'unconfirmed';
    /** KBIZ transaction reference, on success. Becomes `Bundle.transferRef`. */
    reference?: string;
    /**
     * Captured e-slip, **basename only** (e.g. `"<id>.png"`), living in the
     * shared `slips/` dir. apps/api copies it into its own uploads so it lands
     * behind the same Cloudflare-identity gate as a manually attached slip.
     */
    slipFile?: string;
    /** Failure detail, surfaced to the approver as `Bundle.paymentError`. */
    error?: string;
    /** Last KBIZ URL the bot saw — the main forensic clue on `unconfirmed`. */
    finalUrl?: string;
    /** ISO timestamp of when the bot stopped working on this intent. */
    finishedAt?: string;
  };
}

/**
 * Reimbursement `User.id` → kbiz-bot payee handle (e.g. `'revew'`). Stored as
 * an AppSetting under `SETTING_KBIZ_PAYEES`. A user with no entry simply
 * cannot be paid by the bot (`kbizPayable: false`) — which is the intended
 * fail-closed default, since the bot may only pay accounts already saved and
 * vetted inside KBIZ.
 */
export type KbizPayeeHandles = Record<string, string>;

/** AppSetting key holding a `KbizCategoryMapping`. */
export const SETTING_KBIZ_CATEGORY_MAPPING = 'kbiz.categoryMapping';

/** AppSetting key holding a `KbizPayeeHandles`. */
export const SETTING_KBIZ_PAYEES = 'kbiz.payees';
