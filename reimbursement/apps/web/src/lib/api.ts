import type {
  AdminUser,
  Bundle,
  BundleStatus,
  BundleWithDetails,
  CreateBundleRequest,
  CreateShareTokenResponse,
  CreateUserRequest,
  InboxItem,
  KbizCategoryMapping,
  KbizDestination,
  KbizFavorite,
  KbizPayeeHandles,
  OverviewPropertyKey,
  OverviewStats,
  OverviewWindowKey,
  Receipt,
  ReceiptItem,
  ShareSetup,
  ShareTokenSummary,
  UpdateUserRequest,
  User,
  VendorSearchResponse,
} from '@reimbursement/shared';

/**
 * The ภาพรวม payload shapes, re-exported so every screen under
 * `screens/approver/overview/` has one import site for them and none of them
 * reaches into `@reimbursement/shared` directly.
 */
export type {
  CreateShareTokenResponse,
  InboxItem,
  ShareSetup,
  ShareTokenSummary,
  OverviewActivityEvent,
  OverviewActivityRow,
  OverviewAgeBand,
  OverviewAlert,
  OverviewAlertKind,
  OverviewBreakdown,
  OverviewBundleRef,
  OverviewDecisions,
  OverviewDelta,
  OverviewFlow,
  OverviewGroup,
  OverviewIdSet,
  OverviewLadder,
  OverviewLadderEntry,
  OverviewMeta,
  OverviewOrphanGroup,
  OverviewOrphanReceipt,
  OverviewOwed,
  OverviewPaid,
  OverviewPropertyKey,
  OverviewQueue,
  OverviewSeries,
  OverviewSeriesPoint,
  OverviewSlice,
  OverviewSpeed,
  OverviewSpeedBucket,
  OverviewSpeedMetric,
  OverviewStats,
  OverviewWindowKey,
  OverviewWindowRange,
  VendorSearchResponse,
  VendorSuggestion,
} from '@reimbursement/shared';
import type { PropertyHint } from './property-hint';

// ─── Auth token storage ──────────────────────────────────────────
// The JWT is the source of truth for authentication. It is persisted in
// localStorage and forwarded on every request as `Authorization: Bearer <jwt>`.

const AUTH_TOKEN_STORAGE_KEY = 'reimbursement_auth_token';

let cachedAuthToken: string | null = readTokenFromStorage();

function readTokenFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  cachedAuthToken = token;
  if (typeof window === 'undefined') return;
  try {
    if (token === null) {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // localStorage may be unavailable (private mode, SSR). The cache still works.
  }
}

export function getAuthToken(): string | null {
  return cachedAuthToken;
}

// ─── Dev impersonation (DEV mode only) ───────────────────────────
// In dev, the tweaks panel can swap between seeded users without going
// through the real Cloudflare Access flow. When set, the API client forwards
// `X-Dev-User-Id` instead of `Authorization: Bearer`. The API's auth
// middleware honors this header only when NODE_ENV !== 'production'.

const DEV_USER_ID_STORAGE_KEY = 'reimbursement_dev_user_id';

let cachedDevUserId: string | null = readDevUserIdFromStorage();

function readDevUserIdFromStorage(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(DEV_USER_ID_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setDevUserId(id: string | null): void {
  cachedDevUserId = id;
  if (typeof window === 'undefined') return;
  try {
    if (id === null) {
      window.localStorage.removeItem(DEV_USER_ID_STORAGE_KEY);
    } else {
      window.localStorage.setItem(DEV_USER_ID_STORAGE_KEY, id);
    }
  } catch {
    // localStorage unavailable; the cache still works for this session.
  }
}

export function getDevUserId(): string | null {
  return cachedDevUserId;
}

export const DEV_USER_ID_BY_ROLE = {
  employee: 'user_niran',
  approver: 'user_kpol',
} as const;

// ─── Core fetch helper ───────────────────────────────────────────

interface ApiErrorBody {
  message?: string;
}

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: BodyInit | null;
  headers?: Record<string, string>;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body = null, headers = {} } = options;

  const finalHeaders: Record<string, string> = { ...headers };
  const token = getAuthToken();
  if (token !== null) {
    finalHeaders.Authorization = `Bearer ${token}`;
  } else if (import.meta.env.DEV) {
    const devId = getDevUserId();
    if (devId !== null) finalHeaders['X-Dev-User-Id'] = devId;
  }

  const response = await fetch(path, {
    method,
    headers: finalHeaders,
    body,
  });

  if (!response.ok) {
    const errorMessage = await extractErrorMessage(response);
    throw new ApiError(response.status, errorMessage);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

async function extractErrorMessage(response: Response): Promise<string> {
  const fallback = `${response.status} ${response.statusText}`;
  try {
    const data = (await response.json()) as ApiErrorBody;
    return data.message ?? fallback;
  } catch {
    return fallback;
  }
}

function jsonBody(payload: unknown): RequestOptions {
  return {
    method: 'POST',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  };
}

function jsonPatchBody(payload: unknown): RequestOptions {
  return {
    method: 'PATCH',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  };
}

function jsonPutBody(payload: unknown): RequestOptions {
  return {
    method: 'PUT',
    body: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  };
}

// ─── Multipart helpers ───────────────────────────────────────────

export interface ReceiptFormFields {
  merchant: string;
  category: string;
  property?: 'hf-hotel' | 'hf-ville';
  quantity?: number | null;
  amount: number;
  date: string;
  note?: string;
  color?: string;
  accent?: string;
  items: ReceiptItem[];
  tax?: string;
}

export function receiptFormFromFields(
  fields: ReceiptFormFields,
  /** The cover. Kept as its own argument so existing call sites are unchanged. */
  photo?: File,
  /**
   * Drain share-inbox items instead of uploading bytes (CR-2026-08-16). The
   * files are already in the uploads volume — the phone put them there when
   * they were shared — so re-posting would be a second upload of something the
   * server already has. Accepts several so one expense photographed as three
   * pages becomes ONE receipt (CR-2026-08-17).
   */
  inboxId?: string | string[],
  /** Attachments beyond the cover, in display order. */
  extraPhotos?: File[],
): FormData {
  const form = new FormData();
  form.append('merchant', fields.merchant);
  form.append('category', fields.category);
  if (fields.property !== undefined) form.append('property', fields.property);
  if (fields.quantity !== undefined && fields.quantity !== null) {
    form.append('quantity', String(fields.quantity));
  }
  form.append('amount', String(fields.amount));
  form.append('date', fields.date);
  if (fields.note !== undefined) form.append('note', fields.note);
  if (fields.color !== undefined) form.append('color', fields.color);
  if (fields.accent !== undefined) form.append('accent', fields.accent);
  if (fields.tax !== undefined) form.append('tax', fields.tax);
  form.append('items', JSON.stringify(fields.items));
  if (photo) form.append('photo', photo);
  for (const extra of extraPhotos ?? []) form.append('photos', extra);
  if (Array.isArray(inboxId)) {
    if (inboxId.length > 0) form.append('inboxIds', inboxId.join(','));
  } else if (inboxId) {
    form.append('inboxId', inboxId);
  }
  return form;
}

/**
 * `force` closes a `paying` bundle the bot never reported back on — the
 * approver has the e-slip on their phone and is overruling a payment nobody is
 * coming back for. The API refuses it on any other status and audits it as an
 * override.
 */
export function payFormFromFields(
  transferRef: string,
  proof: File,
  opts: { force?: boolean } = {},
): FormData {
  const form = new FormData();
  form.append('transferRef', transferRef);
  form.append('proof', proof);
  if (opts.force) form.append('force', '1');
  return form;
}

// ─── Auth response shapes ────────────────────────────────────────

/**
 * Result of a successful `GET /api/auth/card-login/wait` (HTTP 200). A 204 is
 * surfaced as `null` by the request helper (keep polling); a 4xx throws.
 */
export interface CardLoginResult {
  token: string;
  linked: boolean;
  redirect: string;
}

/**
 * Result of a successful `POST /api/auth/cf-login` — the silent exchange of
 * the edge-injected Cloudflare Access identity for an app JWT.
 */
export interface CfLoginResponse {
  token: string;
  user: User;
  /** @see PropertyHint — absent unless the verified identity names one desk. */
  propertyHint?: PropertyHint;
}

export interface StatSlice {
  count: number;
  total: number;
}

export interface NamedAmount {
  label: string;
  amount: number;
}

/** Per-handle details the bot publishes (masked account — never the full number). */
export interface PublishedPayee {
  handle: string;
  mode?: 'favorite' | 'custom';
  nickname?: string;
  bank?: string;
  accountName?: string;
  accountMasked?: string;
}

/** Shape of GET/PUT /api/admin/kbiz-settings. */
export interface KbizSettings {
  /** The receipt form's live category list (admin-managed). */
  receiptCategories: string[];
  mapping: KbizCategoryMapping;
  payees: KbizPayeeHandles;
  /** False when the server has no queue dir / KBIZ bot wired up yet. */
  configured: boolean;
  /**
   * Handle names the bot published from its payee book (names only, no bank
   * data) — the dropdown options. null = the bot hasn't published (down or
   * pre-switch-over), in which case free text entry still works.
   */
  availableHandles?: string[] | null;
  /** Details behind each handle, for the admin dropdown labels. */
  availablePayees?: PublishedPayee[] | null;
  handlesUpdatedAt?: string | null;
  /**
   * KBIZ's own saved accounts, as last synced by the bot ('list-favorites'
   * queue item → queue/kbiz-favorites.json) — the vocabulary the pay-time
   * destination picker's "เลือกจากบัญชีที่บันทึกไว้" mode offers. MASKED, never
   * a full account number. Null = never synced on this host (or the file is
   * unreadable) — the honest "ยังไม่ได้ซิงค์" state, not an empty list.
   */
  favorites: KbizFavorite[] | null;
  favoritesUpdatedAt: string | null;
}

/** Shape of GET /api/bundles/stats. */
export interface BundleStats {
  pending: StatSlice;
  approved: StatSlice;
  /** In flight at the bank — the KBIZ bot owns these right now. Screens that
   *  fold 'paying' bundles into their approved/"พร้อมจ่าย" lists must fold
   *  this slice into `approved` the same way, or the badge and the list under
   *  it disagree. */
  paying: StatSlice;
  paid: StatSlice;
  rejected: StatSlice;
  drafts: number;
  /**
   * The ภาพรวม payload. Present ONLY when the request carried `?window=` AND
   * the caller is an APPROVER. Absent on the two boot calls App.tsx makes, so
   * those stay the cheap two-query response they are today.
   */
  overview?: OverviewStats;
}

/**
 * The other successful shape of `POST /api/auth/cf-login`: the verified
 * Cloudflare identity is a shared terminal, not a person. A kiosk gets no
 * session — the SPA shows the card-tap screen so an employee can attach
 * themselves, and every receipt is then attributed to whoever tapped.
 */
export interface CfKioskResponse {
  kiosk: true;
  kioskId: string;
  /** @see PropertyHint — absent unless the verified identity names one desk. */
  propertyHint?: PropertyHint;
}

export type CfLoginResult = CfLoginResponse | CfKioskResponse;

export const isKioskResponse = (r: CfLoginResult): r is CfKioskResponse =>
  'kiosk' in r && r.kiosk === true;

/**
 * Result of a successful `GET /api/auth/card-login/wait` (HTTP 200). A 204 is
 * surfaced as `null` by the request helper (keep polling); a 4xx throws.
 */
export interface CardLoginResult {
  token: string;
  linked: boolean;
  redirect: string;
}

// ─── Endpoints ───────────────────────────────────────────────────

export const api = {
  me: (): Promise<User> => request<User>('/api/me'),

  auth: {
    // ── Cloudflare Access → app-JWT exchange ──
    // The SPA sits behind a CF Access wall in prod; the edge injects a
    // `Cf-Access-Jwt-Assertion` header on every request. This exchanges that
    // header (read server-side) for an app-issued JWT + the bound User.
    cfLogin: (): Promise<CfLoginResult> =>
      request<CfLoginResult>('/api/auth/cf-login', { method: 'POST' }),
    // ── NFC staff-card login ──
    // start opens a claim against the central HF-ID service for this terminal;
    // the claim_token is kept server-side in an HttpOnly cookie, so wait() takes
    // no argument. wait() resolves to a CardLoginResult on 200, or `null` on 204
    // (no tap yet — poll again). A 403 (card not allowed / unlinked) throws.
    cardLoginStart: (readerId: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>('/api/auth/card-login/start', jsonBody({ reader_id: readerId })),
    cardLoginWait: (): Promise<CardLoginResult | null> =>
      request<CardLoginResult | null>('/api/auth/card-login/wait').then((r) => r ?? null),
    // ── Kiosk QR login ──
    // The reader-free authenticator for shared terminals: start mints a ticket
    // at HF-ID and returns the URL to render as a QR; wait long-polls until an
    // employee scans it and confirms in LINE, then yields the same session a
    // card tap would have. `label` is a cosmetic terminal name (the kiosk id).
    // wait() resolves to null on 204 (nobody has scanned yet — poll again); a
    // 410 means the ticket expired and the caller should mint a fresh QR.
    kioskLoginStart: (label: string): Promise<{ qrUrl: string }> =>
      request<{ qrUrl: string }>('/api/auth/kiosk-login/start', jsonBody({ label })),
    kioskLoginWait: (): Promise<CardLoginResult | null> =>
      request<CardLoginResult | null>('/api/auth/kiosk-login/wait').then((r) => r ?? null),
  },

  receipts: {
    /** The live category list for the receipt form (admin-managed). */
    categories: (): Promise<{ categories: string[] }> =>
      request<{ categories: string[] }>('/api/receipts/categories'),
    list: (opts?: { mine?: boolean }): Promise<Receipt[]> =>
      request<Receipt[]>(opts?.mine ? '/api/receipts?mine=1' : '/api/receipts'),
    create: (form: FormData): Promise<Receipt> =>
      request<Receipt>('/api/receipts', { method: 'POST', body: form }),
    update: (id: string, form: FormData): Promise<Receipt> =>
      request<Receipt>(`/api/receipts/${encodeURIComponent(id)}`, { method: 'PATCH', body: form }),
    delete: (id: string): Promise<void> =>
      request<void>(`/api/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  /**
   * The share inbox — files an employee sent in from their phone that have not
   * become receipts yet. Always the caller's own; the server scopes by session.
   */
  inbox: {
    list: (): Promise<InboxItem[]> => request<InboxItem[]>('/api/inbox'),
    discard: (id: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>(`/api/inbox/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  },

  /**
   * Upload credentials held by an employee's phone, for the iOS Shortcut.
   * `create` returns the plaintext token ONCE — it is not retrievable again,
   * so the caller must render it immediately and never log it.
   */
  shareTokens: {
    /**
     * The Cloudflare service-token pair + upload URL the Shortcut needs.
     * Server-assembled so nobody carries credentials between devices by hand.
     * `configured: false` ⇒ this deploy has no service token yet.
     */
    setup: (): Promise<ShareSetup> => request<ShareSetup>('/api/me/share-setup'),
    list: (): Promise<ShareTokenSummary[]> =>
      request<ShareTokenSummary[]>('/api/me/share-tokens'),
    create: (label: string): Promise<CreateShareTokenResponse> =>
      request<CreateShareTokenResponse>('/api/me/share-tokens', jsonBody({ label })),
    revoke: (id: string): Promise<{ ok: boolean }> =>
      request<{ ok: boolean }>(`/api/me/share-tokens/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      }),
  },

  bundles: {
    list: (status?: BundleStatus, opts?: { mine?: boolean; limit?: number }): Promise<BundleWithDetails[]> => {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (opts?.mine) params.set('mine', '1');
      if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
      const qs = params.toString();
      return request<BundleWithDetails[]>(qs ? `/api/bundles?${qs}` : '/api/bundles');
    },
    get: (id: string): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}`),
    create: (req: CreateBundleRequest): Promise<BundleWithDetails> =>
      request<BundleWithDetails>('/api/bundles', jsonBody(req)),
    approve: (id: string): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/approve`, {
        method: 'POST',
      }),
    /** Counts, totals and the ภาพรวม aggregates — computed in Postgres so the
     *  client never downloads the archive just to render a number or a chart.
     *  `window` is what asks for the `overview` block; without it this stays
     *  the two-query response the app boots on. `mine` is ignored by the
     *  server whenever `window` is sent. */
    stats: (opts?: {
      mine?: boolean;
      window?: OverviewWindowKey;
      property?: OverviewPropertyKey;
    }): Promise<BundleStats> => {
      const params = new URLSearchParams();
      if (opts?.window) {
        params.set('window', opts.window);
        if (opts.property) params.set('property', opts.property);
      } else if (opts?.mine) {
        params.set('mine', '1');
      }
      const qs = params.toString();
      return request<BundleStats>(qs ? `/api/bundles/stats?${qs}` : '/api/bundles/stats');
    },
    /** Pull a still-pending request back for more edits. The receipts return to
     *  the draft pool and the bundle is removed, so there is nothing to return
     *  but an ack — the caller drops it from local state. */
    withdraw: (id: string): Promise<{ ok: true }> =>
      request<{ ok: true }>(`/api/bundles/${encodeURIComponent(id)}/withdraw`, { method: 'POST' }),
    reject: (id: string, reason?: string): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
        headers: { 'Content-Type': 'application/json' },
      }),
    pay: (id: string, form: FormData): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/pay`, {
        method: 'POST',
        body: form,
      }),
    /** Admin-only. Atomically flips `approved` → `paying` and queues the KBIZ
     *  intent server-side. `destination` is the approver's pay-time choice from
     *  the destination picker and is REQUIRED (2026-08-19): the server answers
     *  a Thai 400 to a call that states none, instead of falling back to the
     *  submitter's admin-mapped payee handle. The mapping is still the DEFAULT
     *  the picker pre-selects — it is just never applied on the approver's
     *  behalf, so this signature has no way to omit the choice. 409 = another
     *  action already moved the bundle, or the destination doesn't resolve to a
     *  real account; 503 = automation not configured on this server. */
    payViaKbiz: (id: string, destination: KbizDestination): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/pay-via-kbiz`, {
        method: 'POST',
        body: JSON.stringify({ destination }),
        headers: { 'Content-Type': 'application/json' },
      }),
    /** Releases a `paying` bundle back to `approved` so Pay via KBIZ can be
     *  fired again with a fresh intent. Free when the bundle came back
     *  needs-verification, or when the queue proves nothing was ever armed;
     *  `force` is the approver overruling an intent the bot still owns, after
     *  checking K BIZ themselves (409 without it). */
    paymentRetry: (id: string, opts: { force?: boolean } = {}): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/payment-retry`, {
        method: 'POST',
        body: JSON.stringify({ force: opts.force === true }),
        headers: { 'Content-Type': 'application/json' },
      }),
  },

  vendors: {
    /** Merchant suggestions for the receipt form. Auth-required but not
     *  role-gated: the whole team types merchant names. An empty `q` returns
     *  the most-used vendors, which is the cold-start list. */
    search: (q: string, limit?: number): Promise<VendorSearchResponse> => {
      const params = new URLSearchParams();
      if (q) params.set('q', q);
      if (limit !== undefined) params.set('limit', String(limit));
      const qs = params.toString();
      return request<VendorSearchResponse>(qs ? `/api/vendors?${qs}` : '/api/vendors');
    },
  },

  admin: {
    listUsers: (): Promise<AdminUser[]> => request<AdminUser[]>('/api/admin/users'),
    createUser: (req: CreateUserRequest): Promise<AdminUser> =>
      request<AdminUser>('/api/admin/users', jsonBody(req)),
    updateUser: (id: string, req: UpdateUserRequest): Promise<AdminUser> =>
      request<AdminUser>(`/api/admin/users/${encodeURIComponent(id)}`, jsonPatchBody(req)),
    deleteUser: (id: string): Promise<void> =>
      request<void>(`/api/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    getKbizSettings: (): Promise<KbizSettings> => request<KbizSettings>('/api/admin/kbiz-settings'),
    putKbizSettings: (body: {
      receiptCategories?: string[];
      mapping?: KbizCategoryMapping;
      payees?: KbizPayeeHandles;
    }): Promise<KbizSettings> =>
      request<KbizSettings>('/api/admin/kbiz-settings', jsonPutBody(body)),
    /** Queues a read-only scrape of KBIZ's own favorites picker; the bot
     *  publishes the result as `queue/kbiz-favorites.json`, which the next
     *  `getKbizSettings()` serves as `favorites`/`favoritesUpdatedAt` — the
     *  caller polls for that. `alreadyRunning` means one sync was already in
     *  flight and this call joined it rather than queueing a second scrape —
     *  with a null `id` when that sync was still being queued and had none to
     *  report yet. */
    syncKbizFavorites: (): Promise<{ id: string | null; alreadyRunning: boolean }> =>
      request<{ id: string | null; alreadyRunning: boolean }>('/api/admin/kbiz-sync-favorites', {
        method: 'POST',
      }),
  },
};

// Re-export Bundle so callers can derive a thin Bundle from BundleWithDetails.
export type { Bundle };
