// Shared types between apps/web (frontend) and apps/api (backend).
// Treat this file as the API contract — both sides import from here.

export type ReceiptItem = readonly [label: string, value: string];

/** The two HF properties that share this app. */
export type Property = 'hf-hotel' | 'hf-ville';

/**
 * The hotel-ops categories actually used in the historical Notion data.
 * Stored as plain strings on receipts, so this list is only the FORM's
 * vocabulary — since 2026-08-12 the live list is admin-managed in the
 * `receipt.categories` AppSetting (see SETTING_RECEIPT_CATEGORIES) and this
 * constant is the seed/default a fresh install starts with, plus the offline
 * fallback the web form uses while the live list loads.
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

/**
 * One attachment on a receipt. `photoPath` is always <img>-renderable — a
 * multi-page PDF arrives here as a single tall stacked image; `originalPath`
 * holds the source document when one was rasterized to produce it.
 */
export interface ReceiptFile {
  id: string;
  photoPath: string;
  originalPath: string | null;
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
  /** Display order. Position 0 is the cover mirrored into `Receipt.photoPath`. */
  position: number;
}

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
  /**
   * The COVER image — a mirror of `files[0].photoPath`, kept so that screens
   * predating multi-file keep rendering correctly. Prefer `files` in new code.
   */
  photoPath: string | null;
  /** Every attachment, in display order. Empty only for receipts with no photo. */
  files: ReceiptFile[];
  bundleId: string | null;
  /**
   * Resolved Vendor, matched on the normalized `merchant` string at save time.
   * OPTIONAL on the interface so `packages/shared` stays additive for kbiz-bot,
   * which compiles against this file; the API always populates it.
   */
  vendorId?: string | null;
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
   * right now (the host is wired up for it, approved, non-zero amount). The web
   * app uses it to show/hide the "จ่ายผ่าน KBIZ" action instead of re-deriving
   * whether payment is live client-side. It says nothing about WHERE the money
   * would go — that is the pay-time picker's job. Absent on payloads that don't
   * compute it.
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

// ─── Share inbox (iPhone share sheet / Android Web Share Target) ──

/** Where an inbox item came from. Open-ended by design — a later producer
 *  (kiosk scan, email-in) is a new value, not a migration. */
export type InboxSource = 'ios-share' | 'android-share' | (string & {});

/**
 * A file shared from a phone that has not yet become a Receipt.
 *
 * Deliberately NOT a Receipt with null fields: a Receipt always has an amount,
 * a merchant and a category, and every consumer relies on that. See
 * docs/change-requests/CR-2026-08-16-ios-share-to-receipt.md.
 */
export interface InboxItem {
  id: string;
  /** Always renderable by an <img> — a shared PDF is rasterized on upload. */
  photoPath: string;
  /** The source PDF when the displayable image was rendered from one. */
  originalPath: string | null;
  /** The type as received. `application/pdf` here means a PDF arrived. */
  mimeType: string;
  filename: string | null;
  sizeBytes: number;
  source: InboxSource;
  /** How many rendered pages this share carries — a PDF can be several. */
  pageCount: number;
  createdAt: string;
  /**
   * False when the file could not be rendered to an image (a PDF on a host
   * without Ghostscript). The UI shows a document placeholder instead of a
   * broken <img>; the receipt can still be created from it.
   */
  previewable: boolean;
}

/** A phone's upload credential, as shown in settings. Never carries the token. */
export interface ShareTokenSummary {
  id: string;
  /** First characters of the random part, rendered as `hfr_a1b2c3…`. */
  hint: string;
  label: string;
  lastUsedAt: string | null;
  createdAt: string;
}

/** The one-time creation response. `token` is never retrievable again. */
export interface CreateShareTokenResponse extends ShareTokenSummary {
  /** Plaintext, shown once. Put it in a QR code, not in a log line. */
  token: string;
}

export interface CreateShareTokenRequest {
  label?: string;
}

/**
 * Everything an iPhone Shortcut needs, minus the per-employee token.
 *
 * `clientId`/`clientSecret` are a Cloudflare Access **service token** — they
 * prove "an HF device", not "this person", and cannot create anything on their
 * own. Served to an already-authenticated employee so nobody has to carry them
 * between devices by hand. See `apps/api/src/share_setup.ts` for the reasoning.
 *
 * `configured: false` means the deploy has no service token wired up yet; the
 * UI then falls back to telling the employee to ask an admin.
 */
export interface ShareSetup {
  configured: boolean;
  /** Absolute URL the Shortcut posts to. */
  uploadUrl: string;
  clientId: string | null;
  clientSecret: string | null;
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
 *
 * NB: ฿ (U+0E3F) sits INSIDE the preserved Thai block and SURVIVES
 * sanitization — pinned by kbiz-bot/test/shared-contract.test.ts.
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
  } | null;
  /**
   * Where the money goes — the bot PREFERS this when present and falls back to
   * `payee.handle`. `payee` is non-null exactly when `destination.kind` is
   * `'handle'` (kept for old-bot back-compat during rolling deploys).
   */
  destination?: KbizDestination;
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
 * an AppSetting under `SETTING_KBIZ_PAYEES`. A user with no entry has no
 * default destination: "จ่ายผ่าน KBIZ" with no destination in the body is
 * refused, and the approver has to pick a synced favorite or type an account in
 * the pay-time picker instead.
 */
export type KbizPayeeHandles = Record<string, string>;

/** AppSetting key holding a `KbizCategoryMapping`. */
export const SETTING_KBIZ_CATEGORY_MAPPING = 'kbiz.categoryMapping';

/** AppSetting key holding a `KbizPayeeHandles`. */
export const SETTING_KBIZ_PAYEES = 'kbiz.payees';

/**
 * AppSetting key for the admin-managed receipt-category list (string[]).
 * Absent → RECEIPT_CATEGORIES. Existing receipts keep whatever string they
 * were saved with — removing or renaming a category never rewrites history.
 */
export const SETTING_RECEIPT_CATEGORIES = 'receipt.categories';

/**
 * KBIZ's own destination-bank dropdown, exact option texts pinned from the live
 * fundtranfer-other page (2026-08-12). The bot matches these as substrings
 * against the real <select>, so send them verbatim.
 */
export const KBIZ_BANKS = [
  'Kasikornbank',
  'Bangkok Bank',
  'Krung Thai Bank',
  'TMBThanachart Bank',
  'Siam Commercial Bank',
  'CITIBANK',
  'Sumitomo Mitsui Banking',
  'Standard Chartered Bank',
  'CIMB THAI BANK',
  'United Overseas Bank (Thai)',
  'Bank of Ayudhya',
  'Government Savings Bank',
  'The Hongkong and Shanghai',
  'Deutsche Bank',
  'The Government Housing Bank',
  'BAAC',
  'Mizuho Bank',
  'BNP Paribas',
  'Bank of China (Thai)',
  'Islamic Bank',
  'Tisco Bank',
  'Kiatnakin Phatra Bank',
  'ICBC (Thai)',
  'Thai Credit Bank',
  'Land and Houses Bank',
] as const;
export type KbizBank = (typeof KBIZ_BANKS)[number];

/**
 * The bot's Thai-session bank <select>, all 31 options pinned VERBATIM from the live page (2026-08-12 probe) — not guesses, not index-aligned with the shorter English list. The bot's KBIZ session
 * runs in Thai (since 2026-08-12), so these are what its bank <select>
 * renders; the web picker shows + sends these, and the bot's alias matcher
 * (BANK_ALIASES in kbiz-bot/src/lib/favorites-core.ts — keep in parity)
 * accepts either language.
 */
export const KBIZ_BANKS_TH = [
  'ธนาคารกสิกรไทย',
  'ธนาคารกรุงเทพ',
  'ธนาคารกรุงไทย',
  'ธนาคารทหารไทยธนชาต',
  'ธนาคารไทยพาณิชย์',
  'ธนาคารซิตี้แบงก์ เอ็น.เอ.',
  'ธนาคารซูมิโตโม มิตซุย แบงกิ้ง',
  'ธนาคารสแตนดาร์ดชาร์เตอร์ด',
  'ธนาคารซีไอเอ็มบี ไทย',
  'ธนาคารยูโอบี',
  'ธนาคารกรุงศรีอยุธยา',
  'ธนาคารออมสิน',
  'ธนาคารฮ่องกงและเซี่ยงไฮ้',
  'ธนาคารดอยซ์แบงก์',
  'ธนาคารอาคารสงเคราะห์',
  'ธนาคาร ธ.ก.ส.',
  'ธนาคารมิซูโฮ',
  'ธนาคารบีเอ็นพี พารีบาส์',
  'ธนาคารแห่งประเทศจีน (ไทย)',
  'ธนาคารอิสลามแห่งประเทศไทย',
  'ธนาคาร ทิสโก้',
  'ธนาคารเกียรตินาคินภัทร',
  'ธนาคารไอซีบีซี (ไทย)',
  'ธนาคารไทยเครดิต',
  'ธนาคารแลนด์ แอนด์ เฮ้าส์',
  'ธนาคารเจพีมอร์แกน เชส',
  'ธนาคารเมกะ สากลพาณิชย์',
  'ธนาคารแห่งอเมริกา',
  'ธนาคาร อินเดียนโอเวอร์ซีส์',
  'ธนาคารพัฒนาวิสาหกิจขนาดกลางและขนาดย่อมแห่งประเทศไทย',
  'ธนาคารคลิกซ์',
] as const;

/** Every value the custom-destination bank field accepts (either language). */
export const KBIZ_BANK_VALUES: readonly string[] = [...KBIZ_BANKS, ...KBIZ_BANKS_TH];

/**
 * One saved account from KBIZ's fundtranfer-other favorites, as synced by the
 * bot ('list-favorites' queue item → queue/kbiz-favorites.json). MASKED —
 * full account numbers never enter the shared tree; the bot re-verifies
 * against the live picker by nickname + bank + last-4 at transfer time.
 */
export interface KbizFavorite {
  /** Display Name in KBIZ — what the bot matches to select the row. */
  nickname: string;
  /** The bank's own name-on-account. */
  accountName: string;
  bank: string;
  /** e.g. "…7394" — display only. */
  accountMasked: string;
  /** Last 4 digits — the verifier the bot matches at transfer time. */
  accountLast4: string;
}

/** Shared-file name for the synced favorites (bot writes, api reads). */
export const KBIZ_FAVORITES_FILE = 'kbiz-favorites.json';

/**
 * Where a payment goes — chosen by the approver at pay time.
 *
 *  - 'handle': the admin-mapped payee (the bot's own gitignored book resolves
 *    it; reimbursement holds no bank data). The default when a mapping exists.
 *  - 'favorite': a synced KBIZ saved account. Carries NO full account number;
 *    the bot triple-verifies nickname + bank + last-4 against the live picker
 *    and requires exactly one match.
 *  - 'custom': a typed destination — the one kind that must carry the full
 *    account number (the bot has to type it). Same live-verified path as the
 *    CLI custom mode; the phone approval shows the resolved recipient.
 */
export type KbizDestination =
  | { kind: 'handle'; handle: string }
  | { kind: 'favorite'; nickname: string; bank: string; accountLast4: string; accountName?: string }
  | { kind: 'custom'; bank: string; accountNo: string; accountName?: string };

// ─── Vendor ──────────────────────────────────────────────────────
//
// A merchant the team has actually spent money at. Matching is owned entirely
// by the `vendor_normalize()` Postgres function (see the migration): nothing in
// TypeScript normalizes a merchant string, because a hand-mirrored JS regex and
// a SQL one drift (JS `\s` includes U+FEFF, Postgres `[[:space:]]` does not)
// and a drifted key silently creates a second vendor row for one shop.

export interface VendorSuggestion {
  id: string;
  /** Display casing, as first entered. */
  name: string;
  /** How many receipts already point here — the ranking signal and the
   *  "is this the one I mean?" cue in the dropdown. */
  receiptCount: number;
}

export interface VendorSearchResponse {
  vendors: VendorSuggestion[];
}

// ─── ภาพรวม (approver overview) ──────────────────────────────────
//
// ONE request feeds every number, every chart and every drill on the page.
// Groups carry ids only; every id referenced anywhere in this payload resolves
// in `bundles`.
//
// Basis, stated once: CASH-OUT. A bundle counts in a window iff status=PAID and
// paidAt falls inside the window, in Asia/Bangkok. There is no second
// denominator on this screen.
//
// Units, once, for the whole payload:
//   money      baht as a JS number (never satang, never a string)
//   instants   ISO-8601 UTC strings
//   durations  integer seconds
//   day keys   'YYYY-MM-DD', the BANGKOK calendar day, never UTC
//   shares     0..1 floats, not percents
//   Thai text  server-composed, already formatted

export type OverviewWindowKey = 'day' | 'week' | 'month';

/** `'all'` plus the two real properties. Queue + alerts ignore this axis. */
export type OverviewPropertyKey = 'all' | Property;

/** Every id-bearing group is capped; `overflow` is how many ids were dropped. */
export interface OverviewIdSet {
  /** Bundle ids, ≤ `meta.idCap`, in the group's own sort order. */
  ids: string[];
  /** Ids beyond the cap. 0 when the group fits. Drives the
   *  `แสดง 25 จาก 40 · เปิดในกล่องอนุมัติ →` footer. */
  overflow: number;
}

export interface OverviewSlice extends OverviewIdSet {
  /** Bundles in the group. Always the true count, never `ids.length`. */
  count: number;
  /** Baht. Always the SERVER aggregate — the panel never re-sums visible rows. */
  total: number;
}

export interface OverviewWindowRange {
  key: OverviewWindowKey;
  /** ISO instant, inclusive. Bangkok midnight (or Monday/1st) expressed in UTC. */
  start: string;
  /** ISO instant, inclusive. `meta.now` for the current window; the clamped
   *  like-for-like end for `prev`. */
  end: string;
  /** `วันนี้` | `สัปดาห์นี้` | `เดือนนี้` — the ladder tile label. */
  label: string;
  /** The literal range under the ladder: `ศ 14 ส.ค.` / `จ 10 – ศ 14 ส.ค.` /
   *  `1 – 14 ส.ค.`. Computed in Asia/Bangkok, NEVER from the browser clock. */
  caption: string;
}

export interface OverviewMeta {
  /** Server clock at query time, ISO. The client uses this — not Date.now() —
   *  for every "ค้าง n นาที" / "รอ n วัน" it renders. */
  now: string;
  tz: 'Asia/Bangkok';
  weekStartsOn: 'monday';
  window: OverviewWindowRange;
  /** Like-for-like ELAPSED prior window. `1 – 14 ส.ค.` compares to `1 – 14 ก.ค.` */
  prev: OverviewWindowRange & {
    /** Elapsed seconds the comparison covers — identical for both ranges. */
    elapsedSec: number;
  };
  /** Earliest audit_events.createdAt in the DB, ISO, or null when empty. A
   *  window starting before this cannot honestly report a rejection rate:
   *  ผลการตัดสิน renders `—` + `ไม่มีข้อมูลก่อน …`. */
  auditCoverageFrom: string | null;
  /** Below this n, a median or a rate is suppressed. 5. */
  lowSampleThreshold: number;
  /** Max ids shipped per group. 25. */
  idCap: number;
  /** True when `bundles` hit its 300-row ceiling and low-ranked groups had ids
   *  trimmed to preserve the dictionary invariant. */
  truncated: boolean;
  generatedAt: string;
}

export type OverviewDeltaMode =
  | 'pct'            // ordinary ±%; `pct` is set
  | 'multiple-up'    // cur/prev ≥ 5
  | 'multiple-down'  // prev/cur ≥ 5
  | 'no-prev'        // prev window paid nothing
  | 'no-current';    // this window has paid nothing yet

export interface OverviewDelta {
  mode: OverviewDeltaMode;
  /** Rounded absolute percent change, or null for every non-`pct` mode. */
  pct: number | null;
  direction: 'up' | 'down' | 'flat';
  /** Desktop chip, server-composed: `เทียบ 1 – 14 ก.ค. ▼ 12%` */
  text: string;
  /** Phone chip: `เทียบเดือนก่อน ▼ 12%` */
  shortText: string;
}

export interface OverviewLadderEntry extends OverviewSlice {
  key: OverviewWindowKey;
  label: string;
  caption: string;
  /** The prior like-for-like window. Its own drill target. */
  prev: OverviewSlice & { label: string; caption: string };
  delta: OverviewDelta;
}

/** ALL THREE returned on every request regardless of `?window=`, so switching
 *  the ladder repaints instantly and only the breakdowns below refetch. */
export interface OverviewLadder {
  day: OverviewLadderEntry;
  week: OverviewLadderEntry;
  month: OverviewLadderEntry;
}

export interface OverviewAgeBand extends OverviewSlice {
  key: 'b1' | 'b2' | 'b3' | 'b4';
  /** `≤1 วัน` | `2–3 วัน` | `4–6 วัน` | `7 วันขึ้นไป` */
  label: string;
}

export interface OverviewOrphanGroup {
  userId: string;
  name: string;
  initials: string;
  count: number;
  total: number;
  oldestDays: number;
  /** Receipt ids this group can actually draw. These are NOT bundles and
   *  resolve in nothing — the panel renders them from `receipts` below,
   *  un-navigable. Every id here HAS a row in `receipts`, so a group can never
   *  promise a receipt the payload cannot show. */
  receiptIds: string[];
  /** `count − receiptIds.length` — receipts this group holds but did not ship,
   *  so the drill can print `แสดง n จาก m` instead of expanding short. */
  overflow: number;
}

export interface OverviewOrphanReceipt {
  id: string;
  userId: string;
  merchant: string;
  category: string;
  amount: number;
  /** `YYYY-MM-DD`, the receipt's own date string, verbatim. */
  date: string;
}

export interface OverviewQueue {
  pending: OverviewSlice & {
    oldestDays: number;
    ageBands: OverviewAgeBand[]; // always 4, in b1..b4 order, zeros included
  };
  approved: OverviewSlice;
  paying: OverviewSlice & {
    /** payingSince ≤ now − 10 min, paymentError IS NULL. */
    stuck: OverviewSlice & { oldestMinutes: number };
    /** The complement — in flight but still inside the watchdog. */
    fast: OverviewSlice;
  };
  /** ใบเสร็จลอย — receipts with bundleId IS NULL, ORG-WIDE. */
  orphanReceipts: {
    count: number;
    total: number;
    oldestDays: number;
    byUser: OverviewOrphanGroup[];
    /** Flat, deduped, ≤ 120 rows — the drill's expandable receipt rows. */
    receipts: OverviewOrphanReceipt[];
  };
}

export type OverviewAlertKind =
  | 'payment-stuck'         // PAYING, paymentError null, ≥10 min
  | 'payment-failed'        // APPROVED with paymentError — retryable
  | 'payment-manual-check'  // PAYING with paymentError — never auto-retried
  | 'pending-overdue';      // the b4 age band, aggregate

export interface OverviewAlert {
  kind: OverviewAlertKind;
  severity: 'danger' | 'warn';
  /** `โอนค้างที่ธนาคาร` | `โอนไม่สำเร็จ ต้องลองใหม่` | `ต้องตรวจสอบด้วยตัวเอง` | `รอนาน 7 วันขึ้นไป` */
  label: string;
  /** Single-bundle alerts go STRAIGHT to the bundle; length 1 for the three
   *  payment kinds, n for `pending-overdue` (which opens the b4 drill). */
  bundleIds: string[];
  count: number;
  total: number;
  /** Minutes in flight, `payment-stuck` only. */
  minutes: number | null;
  /** `paymentError` verbatim, for the two error kinds. */
  note: string | null;
}

export interface OverviewPaid extends OverviewSlice {
  receiptCount: number;
  /** total / count, or 0. Baht. */
  avgPerBundle: number;
}

export interface OverviewSeriesPoint extends OverviewIdSet {
  /** `YYYY-MM-DD` (day) | `w1`..`w29` (week) | bundle id (payment). */
  key: string;
  /** Axis label: `12` (month) | `พฤ` (week) | bundle name (payment). */
  label: string;
  /** Drill-header label: `พฤ 13 ส.ค.` | `8–14 ส.ค.` | submitter name. */
  fullLabel: string;
  total: number;
  count: number;
  isToday: boolean;
  /** Later than `meta.now` — renders as a dotted baseline tick, no column,
   *  no hit target. */
  isFuture: boolean;
}

export interface OverviewSeries {
  /** `day` for week/month · `payment` for วันนี้ (one point per bundle,
   *  sorted amount desc) · `week` for the phone's month view. */
  granularity: 'day' | 'week' | 'payment';
  points: OverviewSeriesPoint[];
}

export interface OverviewGroup extends OverviewIdSet {
  /** Stable identity. Category name · `v:<vendorId>` or `m:<normalized>` ·
   *  userId · property key. */
  key: string;
  /** Display label, Thai free text as entered. */
  label: string;
  /** Baht attributable to THIS group inside the window (slice, not bundle). */
  amount: number;
  /** amount / coverage.windowTotal, 0..1. */
  share: number;
  /** Distinct bundles touching this group. NOT ids.length. */
  count: number;
  /** Receipt lines behind `amount`. */
  receiptCount: number;
  /** Baht attributable to this group per shipped bundle id. Powers
   *  `จาก ฿8,920 ทั้งคำขอ`. Keys ⊆ `ids`. NON-OPTIONAL. */
  sliceById: Record<string, number>;
  /** Avatar initials — bySubmitter only, null elsewhere. */
  initials: string | null;
  /** byProperty only: that property's top 5 categories, for the mini ranked
   *  list inside its drill. Null elsewhere. */
  topCategories: OverviewPropertyCategory[] | null;
}

/**
 * One property+category pair — a row of the mini list inside a ตามสาขา drill,
 * and a drill target of its own.
 *
 * It carries its own ids and slices rather than leaving the client to intersect
 * `byCategory` with `byProperty`: that intersection would attribute a mixed
 * bundle's WHOLE category spend to one branch, which is the slice dishonesty
 * `sliceById` exists to prevent.
 */
export interface OverviewPropertyCategory extends OverviewIdSet {
  key: string;
  label: string;
  amount: number;
  /** Distinct bundles touching this pair. NOT `ids.length`. */
  count: number;
  /** Baht attributable to this pair per shipped bundle id. Keys ⊆ `ids`. */
  sliceById: Record<string, number>;
}

export interface OverviewBreakdown {
  /** Top 6, amount desc. The phone shows 5 and folds row[5] into its own tail. */
  rows: OverviewGroup[];
  /** Everything past row 6, or null when nothing is left over. */
  tail:
    | (OverviewIdSet & {
        /** `อื่น ๆ อีก 4 หมวด` — noun already inflected server-side. */
        label: string;
        amount: number;
        /** Number of GROUPS folded in, not bundles. */
        count: number;
        sliceById: Record<string, number>;
      })
    | null;
  /** `ครอบคลุม ฿58,900 จาก ฿63,340 ในงวด`. `windowTotal` MUST equal
   *  `paid.total` — this is the one-window-one-denominator proof.
   *
   *  `covered` is the sum of EVERY group in this dimension, tail included, and
   *  therefore always equals `windowTotal`: each dimension partitions the same
   *  receipt rows. It is the assertion, not a subset — a client that draws
   *  fewer rows than the server ranked computes its own visible figure. */
  coverage: { covered: number; windowTotal: number };
}

/**
 * Four INDEPENDENT event counts, not a funnel.
 *
 * A bundle counts on its event, not on whether it still owns receipts:
 * rejecting and withdrawing both detach them, so the first three arms report
 * `count` honestly and let `total` fall to ฿0 when the money left with them.
 */
export interface OverviewFlow {
  /** submittedAt in window. */
  submitted: OverviewSlice;
  /** approvedAt in window. */
  approved: OverviewSlice;
  /** status=PAID and paidAt in window. */
  paid: OverviewSlice;
  /** audit_events(type='reject').createdAt in window — NEVER approvedAt.
   *  ORG-WIDE even under a property chip: a rejected bundle has no receipts
   *  left to carry a property. `total` is structurally ฿0 for the same reason. */
  rejected: OverviewSlice;
}

export interface OverviewSpeedBucket extends OverviewIdSet {
  key: 'q1' | 'q2' | 'q3' | 'q4';
  /** `ใน 4 ชม.` | `ใน 1 วัน` | `1–3 วัน` | `เกิน 3 วัน` */
  label: string;
  count: number;
}

export interface OverviewSpeedMetric extends OverviewIdSet {
  /** Seconds. Null when `lowSample`. */
  medianSec: number | null;
  /** Seconds. Null when `lowSample`. */
  p90Sec: number | null;
  /** Qualifying bundles. NULL timestamps are EXCLUDED, never zeroed. */
  n: number;
  /** n < meta.lowSampleThreshold — the tile prints `ข้อมูลน้อยเกินไป`.
   *  Server-decided; the client NEVER re-derives this. */
  lowSample: boolean;
  buckets: OverviewSpeedBucket[]; // always 4, q1..q4
  /** Seconds per shipped bundle id — the drill's right-hand column. */
  durationById: Record<string, number>;
}

export interface OverviewSpeed {
  /** approvedAt − submittedAt, for bundles APPROVED in the window. */
  approval: OverviewSpeedMetric;
  /** paidAt − approvedAt, for bundles PAID in the window with approvedAt. */
  payout: OverviewSpeedMetric;
  /** paidAt − payingSince. KBIZ only — payingSince IS NOT NULL. */
  bank: OverviewSpeedMetric;
}

export interface OverviewDecisions {
  approved: OverviewSlice;
  rejected: OverviewSlice;
  /** approved.count + rejected.count. */
  n: number;
  lowSample: boolean;
  /**
   * rejected.count / n, 0..1. 0 when n = 0.
   *
   * NULL under a property chip. Rejecting detaches a bundle's receipts, and
   * property lives on the receipt — so a rejection cannot be sliced by branch
   * and `rejected` stays org-wide while `approved` is property-scoped. A ratio
   * over two different populations is worse than no ratio, so the card prints
   * `—` instead.
   */
  rate: number | null;
  /** False when window.start predates meta.auditCoverageFrom → render `—`. */
  auditCovered: boolean;
  /** rejectReason VERBATIM, count desc, ≤ 5. Never bucketed, never charted. */
  reasons: Array<OverviewIdSet & { text: string; count: number }>;
}

/** Window-immune, property-RESPONSIVE. */
export interface OverviewOwed extends OverviewIdSet {
  userId: string;
  name: string;
  initials: string;
  /** Baht owed: their APPROVED bundles only. PAYING money belongs to the
   *  กำลังโอน tile and is never counted twice. */
  total: number;
  /** Whole days since the OLDEST approvedAt in this person's set. */
  oldestDays: number;
}

export type OverviewActivityEvent =
  | 'submit'
  | 'approve'
  | 'reject'
  | 'pay'
  | 'pay-via-kbiz'
  | 'withdraw'
  | 'payment-failed';

export interface OverviewActivityRow {
  /** Null for `withdraw`: the bundle row is deleted and only the AuditEvent
   *  survives. The row renders un-navigable, name in inkSofter, no chevron. */
  bundleId: string | null;
  event: OverviewActivityEvent;
  at: string;
  /** `จ่ายแล้ว · 14 ส.ค. 11:05` — server-composed so the two platforms and
   *  the drill can never word the same event differently. */
  label: string;
  actorName: string;
  actorInitials: string;
  /** Baht. For a withdraw this comes from the AuditEvent metadata. */
  amount: number;
  /** Withdraw rows carry the deleted bundle's name here. */
  name: string;
}

/**
 * INVARIANT: every bundle id appearing ANYWHERE in this payload — ladder,
 * queue, alerts, series, breakdowns, flow, speed, decisions, owed, activity —
 * has an entry here. Groups hold ids only, never nested objects.
 */
export interface OverviewBundleRef {
  id: string;
  name: string;
  submitterName: string;
  submitterInitials: string;
  /** Baht — the WHOLE bundle, unfiltered by property. A group's slice lives in
   *  that group's `sliceById`; the difference is what
   *  `จาก ฿8,920 ทั้งคำขอ` prints. */
  amount: number;
  status: BundleStatus;
  /** `'mixed'` when its receipts span both properties. */
  property: Property | 'mixed';
  receiptCount: number;
  submittedAt: string;
  approvedAt: string | null;
  /** Nullable, not optional — a strict shape beats an absent key. */
  paidAt: string | null;
  payingSince: string | null;
  /** audit_events(type='reject').createdAt. */
  rejectedAt: string | null;
  transferRef: string | null;
  rejectReason: string | null;
  paymentError: string | null;
  /** Whole days since submittedAt, floored, ≥ 0 — the age chip. */
  ageDays: number;
}

export interface OverviewStats {
  meta: OverviewMeta;
  ladder: OverviewLadder;
  queue: OverviewQueue;
  alerts: OverviewAlert[];
  paid: OverviewPaid;
  series: OverviewSeries;
  /** Present ONLY when window=month: the phone's 5 weekly buckets
   *  (`1–7 / 8–14 / 15–21 / 22–28 / 29–31`). The server cannot know the
   *  platform, so it ships both and the client picks. */
  seriesWeekly?: OverviewSeries;
  byCategory: OverviewBreakdown;
  /** ตามร้านค้า — grouped by Vendor; unlinked receipts fall back to their raw
   *  merchant string. */
  byVendor: OverviewBreakdown;
  bySubmitter: OverviewBreakdown;
  /** Exactly two rows, always both, zeros included. */
  byProperty: OverviewBreakdown;
  flow: OverviewFlow;
  speed: OverviewSpeed;
  decisions: OverviewDecisions;
  /** oldestDays desc — the ranking encodes the obligation, not the size. */
  owed: OverviewOwed[];
  /** Newest first, ≤ 24. */
  activity: OverviewActivityRow[];
  bundles: Record<string, OverviewBundleRef>;
}
