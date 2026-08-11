import type {
  AdminUser,
  Bundle,
  BundleStatus,
  BundleWithDetails,
  CreateBundleRequest,
  CreateUserRequest,
  KbizCategoryMapping,
  KbizPayeeHandles,
  Receipt,
  ReceiptItem,
  UpdateUserRequest,
  User,
} from '@reimbursement/shared';

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
  photo?: File,
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
}

export interface StatSlice {
  count: number;
  total: number;
}

export interface NamedAmount {
  label: string;
  amount: number;
}

/** Shape of GET/PUT /api/admin/kbiz-settings. */
export interface KbizSettings {
  mapping: KbizCategoryMapping;
  payees: KbizPayeeHandles;
  /** False when the server has no queue dir / KBIZ bot wired up yet. */
  configured: boolean;
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
  byCategory: NamedAmount[];
  bySubmitter: NamedAmount[];
  byProperty: Record<'hf-hotel' | 'hf-ville', number>;
  paidByMonth: Array<{ month: string; amount: number }>;
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
    list: (opts?: { mine?: boolean }): Promise<Receipt[]> =>
      request<Receipt[]>(opts?.mine ? '/api/receipts?mine=1' : '/api/receipts'),
    create: (form: FormData): Promise<Receipt> =>
      request<Receipt>('/api/receipts', { method: 'POST', body: form }),
    update: (id: string, form: FormData): Promise<Receipt> =>
      request<Receipt>(`/api/receipts/${encodeURIComponent(id)}`, { method: 'PATCH', body: form }),
    delete: (id: string): Promise<void> =>
      request<void>(`/api/receipts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
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
     *  client never downloads the archive just to render a number or a chart. */
    stats: (opts?: { mine?: boolean }): Promise<BundleStats> =>
      request<BundleStats>(`/api/bundles/stats${opts?.mine ? '?mine=1' : ''}`),
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
     *  intent server-side. 409 = another action already moved the bundle;
     *  503 = automation not configured on this server. */
    payViaKbiz: (id: string): Promise<BundleWithDetails> =>
      request<BundleWithDetails>(`/api/bundles/${encodeURIComponent(id)}/pay-via-kbiz`, {
        method: 'POST',
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
      mapping?: KbizCategoryMapping;
      payees?: KbizPayeeHandles;
    }): Promise<KbizSettings> =>
      request<KbizSettings>('/api/admin/kbiz-settings', jsonPutBody(body)),
  },
};

// Re-export Bundle so callers can derive a thin Bundle from BundleWithDetails.
export type { Bundle };
