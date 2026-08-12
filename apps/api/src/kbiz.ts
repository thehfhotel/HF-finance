import { mkdir, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import {
  KBIZ_FAVORITES_FILE,
  type KbizFavorite,
  type KbizPaymentIntent,
} from '@reimbursement/shared';

/**
 * The shared KBIZ queue directory — this app's only channel to the bank.
 *
 * `kbiz-bot` (thehfhotel/payroll, running on evergreen) owns the KBIZ
 * credentials and the single warm browser session. We never talk to it over the
 * network: both processes bind-mount one host directory and hand work back and
 * forth as files.
 *
 *   <dir>/queue/          <intentId>.json   intents we write, results it patches back
 *   <dir>/queue/archive/  <intentId>.json   reconciled intents, kept for forensics
 *   <dir>/vouchers/       <intentId>.html   Thai voucher we render, bot → PDF → attaches
 *   <dir>/slips/          <intentId>.<ext>  e-slip the bot captured
 *
 * DARK WHEN UNCONFIGURED, like NOTIFY_INGRESS_TOKEN and READER_RESOLVE_SECRET
 * before it: no `KBIZ_QUEUE_DIR`, no automated payments. A dev machine cannot
 * move money by accident, and "จ่ายผ่าน KBIZ" answers 503 instead of writing
 * intents nobody will ever pick up.
 *
 * The directory must already be PROVISIONED — see `inspectKbizQueue` for what
 * that means and why the root's mere existence is not it.
 */

const QUEUE_DIR = process.env.KBIZ_QUEUE_DIR?.trim() || null;

/** How often the poller sweeps the queue for finished intents. */
export const KBIZ_POLL_MS = Math.max(Number(process.env.KBIZ_POLL_MS ?? 5000) || 5000, 1000);

/**
 * How long a bundle may sit in PAYING without the bot reporting anything back
 * before the poller treats it as stranded (default 15 minutes, floor 1 minute).
 *
 * Generous on purpose: the transfer itself takes seconds, but the approver has
 * to pick up their phone and release it in the K BIZ app, and that wait is
 * legitimately long. Anything past this is not a slow human, it is nobody
 * coming back.
 */
export const KBIZ_STALE_MS = Math.max(
  Number(process.env.KBIZ_STALE_MS ?? 900_000) || 900_000,
  60_000,
);

/** Sub-directory names, shared with kbiz-bot by convention. */
const QUEUE_SUBDIR = 'queue';
const ARCHIVE_SUBDIR = join('queue', 'archive');
const VOUCHERS_SUBDIR = 'vouchers';
const SLIPS_SUBDIR = 'slips';

/** Same tight allowlist the /uploads route uses — no separators, no traversal. */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+$/;

/** Why automated payment is (not) available, for logs and the admin screen. */
export type KbizQueueState =
  /** No `KBIZ_QUEUE_DIR` at all — a dev machine, or the feature turned off. */
  | 'unset'
  /** The configured path is not a directory: the mount is missing or broken. */
  | 'missing'
  /** The root is there but ops never provisioned it — no `queue/` inside. */
  | 'unprovisioned'
  /** Provisioned and usable. */
  | 'ready';

/**
 * What state the shared queue is in, right now.
 *
 * The gate is the **`queue/` sub-directory**, not the root, and that choice is
 * the whole point: Docker CREATES a missing bind-mount source automatically, so
 * `${KBIZ_QUEUE_HOST_DIR}` always exists by the time this process runs —
 * including when it is a typo, and including when ops never ran the runbook.
 * Testing the root would therefore turn the feature ON by itself on the first
 * deploy, writing intents into an empty directory no bot is watching and
 * stranding every bundle it touched in PAYING.
 *
 * `queue/` is created by hand in runbook step 1 (and by kbiz-bot's own tree)
 * and is never created here — `ensureSubdirs` refuses to run without it — so
 * its presence is a marker only a human or the bot can leave. Wrong path, no
 * runbook, no mount: `unprovisioned`, feature dark, exactly as documented.
 *
 * Checked per call rather than cached at boot: the mount can disappear under a
 * running container, and a queue write into a vanished mount would strand a
 * bundle in PAYING with no intent for the bot to find.
 */
export async function inspectKbizQueue(): Promise<KbizQueueState> {
  if (!QUEUE_DIR) return 'unset';
  try {
    if (!(await stat(QUEUE_DIR)).isDirectory()) return 'missing';
  } catch {
    return 'missing';
  }
  try {
    return (await stat(join(QUEUE_DIR, QUEUE_SUBDIR))).isDirectory() ? 'ready' : 'unprovisioned';
  } catch {
    return 'unprovisioned';
  }
}

/** True when automated payment is actually usable right now. */
export async function isKbizConfigured(): Promise<boolean> {
  return (await inspectKbizQueue()) === 'ready';
}

/** One line explaining a non-`ready` queue, for the boot log. */
export function describeKbizQueue(state: KbizQueueState): string {
  switch (state) {
    case 'unset':
      return 'no KBIZ_QUEUE_DIR — automated payment is off';
    case 'missing':
      return `${QUEUE_DIR} is not a directory (mount missing?) — automated payment is off`;
    case 'unprovisioned':
      return `${QUEUE_DIR} has no ${QUEUE_SUBDIR}/ — run the CR runbook step 1 on the host; automated payment stays off`;
    case 'ready':
      return `watching ${QUEUE_DIR}/${QUEUE_SUBDIR}`;
  }
}

function requireQueueDir(): string {
  if (!QUEUE_DIR) {
    throw new Error('KBIZ_QUEUE_DIR is not configured');
  }
  return QUEUE_DIR;
}

/** Absolute path of `queue/<name>`. */
function queueFilePath(name: string): string {
  return join(requireQueueDir(), QUEUE_SUBDIR, name);
}

/** The queue filename for an intent id. */
export function intentFileName(intentId: string): string {
  return `${intentId}.json`;
}

/**
 * A fresh payment-intent id: `pi_` + 32 hex chars.
 *
 * Doubles as a filename and as `Bundle.paymentIntentId`, so it is deliberately
 * restricted to characters that are safe in both — no dashes to lose, nothing
 * to escape. Every attempt gets a new one; a retry never reuses the stuck id.
 */
export function newPaymentIntentId(): string {
  return `pi_${crypto.randomUUID().replaceAll('-', '')}`;
}

/**
 * Create the working sub-directories — never the `queue/` marker, and never the
 * root.
 *
 * The provisioning check comes first and throws, so this can only ever add
 * directories inside a tree ops (or the bot) already vouched for. That is what
 * keeps `queue/` a marker Docker cannot manufacture: `queue/archive` is created
 * recursively, which WOULD conjure `queue/` on the way, but only after the
 * assertion has proved it is already there. It also means a mount that vanished
 * mid-flight raises here rather than quietly opening a private queue inside the
 * container that the bot cannot see.
 */
async function ensureSubdirs(): Promise<void> {
  const dir = requireQueueDir();
  const state = await inspectKbizQueue();
  if (state !== 'ready') {
    throw new Error(`KBIZ queue is not usable: ${describeKbizQueue(state)}`);
  }
  await Promise.all(
    [ARCHIVE_SUBDIR, VOUCHERS_SUBDIR, SLIPS_SUBDIR].map((sub) =>
      mkdir(join(dir, sub), { recursive: true }),
    ),
  );
}

/**
 * Write the Thai voucher for an intent and return the path RELATIVE to the
 * shared dir — which is exactly what `KbizPaymentIntent.voucherFile` carries,
 * since the bot resolves it against its own mount point, not ours.
 */
export async function writeVoucherHtml(intentId: string, html: string): Promise<string> {
  await ensureSubdirs();
  const relative = `${VOUCHERS_SUBDIR}/${intentId}.html`;
  await writeFile(join(requireQueueDir(), relative), html, 'utf8');
  return relative;
}

/**
 * The intent as this app WRITES it, since the destination picker landed.
 *
 * `destination` is what every reader should use; `payee` is kept alongside it —
 * populated only for a `handle` destination, null otherwise — so a bot build
 * that predates the picker still reads a handle transfer correctly instead of
 * paying whatever it last had selected.
 *
 * The shared contract now carries `payee: { handle } | null` +
 * `destination?: KbizDestination` itself; this alias survives only so existing
 * imports keep compiling.
 */
export type KbizQueuedIntent = KbizPaymentIntent;

/**
 * Publish an intent for the bot, atomically.
 *
 * Written to a dot-prefixed `.tmp` sibling and renamed into place: the bot's
 * watcher globs `queue/*.json`, so it can only ever see the finished file. A
 * half-written intent — a truncated amount, a missing payee — must never be
 * pickable.
 */
export async function writeIntent(intent: KbizQueuedIntent): Promise<void> {
  await ensureSubdirs();
  const name = intentFileName(intent.id);
  const temporary = queueFilePath(`.${name}.tmp`);
  await writeFile(temporary, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
  await rename(temporary, queueFilePath(name));
}

/** True when the intent is still sitting in `queue/` (i.e. the bot may act on it). */
export async function intentFileExists(intentId: string): Promise<boolean> {
  try {
    await stat(queueFilePath(intentFileName(intentId)));
    return true;
  } catch {
    return false;
  }
}

/** Every `*.json` currently in `queue/` — including other apps' work. */
/**
 * The bot publishes its payee-book HANDLE NAMES here (queue/payee-handles.json)
 * so the admin screen can offer a dropdown — names only, never bank data. It
 * sits inside queue/ because that is the one bot→api path needing no extra
 * mount; both queue scanners skip it by name.
 */
const PAYEE_HANDLES_FILE = 'payee-handles.json';

export interface PublishedPayee {
  handle: string;
  mode?: 'favorite' | 'custom';
  nickname?: string;
  bank?: string;
  accountName?: string;
  /** Last 4 digits only — the bot never publishes full numbers. */
  accountMasked?: string;
}

export interface PayeeHandlesManifest {
  handles: string[];
  /** Details per handle (bot manifest v2); absent from older manifests. */
  payees: PublishedPayee[] | null;
  updatedAt: string | null;
}

/** Read the bot-published handle list; null when absent/unreadable/garbled. */
export async function readPayeeHandlesManifest(): Promise<PayeeHandlesManifest | null> {
  if (!QUEUE_DIR) return null;
  try {
    const raw = JSON.parse(
      await Bun.file(join(QUEUE_DIR, QUEUE_SUBDIR, PAYEE_HANDLES_FILE)).text(),
    ) as { handles?: unknown; payees?: unknown; updatedAt?: unknown };
    if (!Array.isArray(raw.handles) || !raw.handles.every((h) => typeof h === 'string')) return null;
    const payees = Array.isArray(raw.payees)
      ? raw.payees.filter(
          (p): p is PublishedPayee =>
            typeof p === 'object' && p !== null && typeof (p as PublishedPayee).handle === 'string',
        )
      : null;
    return {
      handles: raw.handles,
      payees,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export interface KbizFavoritesManifest {
  favorites: KbizFavorite[];
  updatedAt: string | null;
}

/** Every field the picker and the bot's re-verification need, all present. */
function isKbizFavorite(value: unknown): value is KbizFavorite {
  if (typeof value !== 'object' || value === null) return false;
  const favorite = value as Partial<KbizFavorite>;
  return (
    typeof favorite.nickname === 'string' &&
    favorite.nickname.length > 0 &&
    typeof favorite.accountName === 'string' &&
    typeof favorite.bank === 'string' &&
    typeof favorite.accountMasked === 'string' &&
    typeof favorite.accountLast4 === 'string' &&
    favorite.accountLast4.length > 0
  );
}

/**
 * The bot's synced KBIZ saved accounts (queue/kbiz-favorites.json), published
 * by a `list-favorites` sync item. MASKED by contract: last four digits, never
 * a full account number — this app still stores no bank data (ADR 0001,
 * decision 4).
 *
 * Null for every problem, like `readPayeeHandlesManifest` — absent, unreadable,
 * caught mid-write, or ONE row missing a field. A partially understood list is
 * refused whole rather than trimmed: a favorite is a payment destination, and
 * "the row I meant is silently not in the list" must surface as "ยังไม่ได้ซิงค์"
 * and a re-sync, never as a transfer to the row next to it.
 */
export async function readKbizFavorites(): Promise<KbizFavoritesManifest | null> {
  if (!QUEUE_DIR) return null;
  try {
    const raw = JSON.parse(
      await Bun.file(join(QUEUE_DIR, QUEUE_SUBDIR, KBIZ_FAVORITES_FILE)).text(),
    ) as { favorites?: unknown; updatedAt?: unknown };
    if (!Array.isArray(raw.favorites) || !raw.favorites.every(isKbizFavorite)) return null;
    return {
      favorites: raw.favorites,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : null,
    };
  } catch {
    return null;
  }
}

export async function listQueueFiles(): Promise<string[]> {
  try {
    const entries = await readdir(join(requireQueueDir(), QUEUE_SUBDIR));
    return entries.filter(
      (name) =>
        name.endsWith('.json') &&
        !name.startsWith('.') &&
        // The two bot→api manifests live in queue/ but are not queue items.
        name !== PAYEE_HANDLES_FILE &&
        name !== KBIZ_FAVORITES_FILE,
    );
  } catch {
    return [];
  }
}

/** Parse one queue file, or null when it is unreadable / not JSON (mid-write). */
export async function readQueueFile(name: string): Promise<unknown | null> {
  try {
    return JSON.parse(await Bun.file(queueFilePath(name)).text()) as unknown;
  } catch {
    return null;
  }
}

/**
 * A queue item asking the bot to re-read KBIZ's own favorites picker and
 * publish it as `queue/kbiz-favorites.json`.
 *
 * Same file queue as a payment, deliberately: one channel to the bank bot, one
 * set of rules. It is the only item we write that moves no money — the bot
 * scrapes the picker read-only — which is why an approver may fire it whenever
 * the saved-account list has changed.
 */
export interface KbizSyncFavoritesItem {
  /** `sync_` + 32 hex chars, and also the queue filename. */
  id: string;
  app: 'reimbursement';
  type: 'list-favorites';
  /** Written as `approved`; the bot patches `running`, then `done`/`failed`. */
  status: 'approved' | 'running' | 'done' | 'failed';
  createdAt: string;
}

/** Statuses meaning a sync is still going to happen without being asked again. */
const SYNC_PENDING_STATUSES: ReadonlySet<string> = new Set(['approved', 'running']);

/**
 * Where a sync ask is staged before it is published — and, because it is created
 * exclusively, the lock that makes "at most one outstanding ask" a fact rather
 * than a likelihood. Dot-prefixed and `.tmp`-suffixed like every other staging
 * file here, so neither the bot's `queue/*.json` glob nor `listQueueFiles` can
 * see it.
 */
const SYNC_CLAIM_FILE = '.sync-favorites.json.tmp';

function isPendingSyncItem(value: unknown): value is KbizSyncFavoritesItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Partial<KbizSyncFavoritesItem>;
  return (
    item.app === 'reimbursement' &&
    item.type === 'list-favorites' &&
    typeof item.id === 'string' &&
    item.id.length > 0 &&
    typeof item.status === 'string' &&
    SYNC_PENDING_STATUSES.has(item.status)
  );
}

/**
 * A pending item this old is abandoned, not outstanding.
 *
 * Nothing else ages one out. The bot can die after patching `running`, or never
 * be deployed at all and leave the item at `approved` — and without a bound the
 * check below would then report `alreadyRunning` on that same file forever: a
 * sync permanently in flight on the admin screen, favorites that can never be
 * refreshed, and no way out from inside the app. Same clock a stranded payment
 * gets (`KBIZ_STALE_MS`), for the same reason. An unparsable `createdAt` counts
 * as abandoned too — a scrape moves no money, so the safe way to fail is
 * towards being able to ask again.
 */
function isAbandonedSyncItem(item: KbizSyncFavoritesItem, now: number): boolean {
  const createdAt = Date.parse(item.createdAt);
  return Number.isNaN(createdAt) || now - createdAt > KBIZ_STALE_MS;
}

/**
 * The one sync ask still expected to run, if there is one.
 *
 * An abandoned item is withdrawn into `queue/archive/` on the way past rather
 * than merely skipped — the same treatment `withdrawQueuedIntent` gives a
 * payment the bot never picked up — so a bot that wakes up hours later cannot
 * start a scrape nobody is waiting for.
 */
async function findOutstandingSyncItem(): Promise<KbizSyncFavoritesItem | null> {
  const now = Date.now();
  for (const fileName of await listQueueFiles()) {
    const raw = await readQueueFile(fileName);
    if (!isPendingSyncItem(raw)) continue;
    if (!isAbandonedSyncItem(raw, now)) return raw;

    // NEVER archive a stale item at `running` — the bot may genuinely still be
    // mid-scrape (its batch can sit behind a 5-minute phone-tap wait), and
    // yanking the file makes its completion patch throw. Same asymmetry as
    // withdrawQueuedIntent: only a provably never-started ask is withdrawn.
    // A stale `running` item simply stops counting as outstanding, so a new
    // sync may be queued; the bot's patch guard tolerates the old file's fate.
    if (raw.status === 'running') {
      console.error(`[kbiz] sync item ${raw.id} stale at 'running' — not archived, no longer blocks a re-sync`);
      continue;
    }

    try {
      await archiveQueueFile(fileName);
      console.error(`[kbiz] sync item ${raw.id} was never finished — archived; a new sync may run`);
    } catch (error) {
      // Refusing every future sync because one file could not be moved is the
      // exact wedge this bound exists to undo, so it is still not outstanding.
      console.error(`[kbiz] could not archive the abandoned sync item ${raw.id}:`, error);
    }
  }
  return null;
}

/**
 * Stage the ask, exclusively — true only for the caller that now owns publishing.
 *
 * `wx` is the whole mechanism: the create either succeeds or raises EEXIST, so
 * exactly one caller can sit between staging and publishing. A claim older than
 * a stranded payment belonged to a process that died in that gap rather than to
 * a request in flight (which holds it for a rename's worth of time), and is
 * taken over — nothing downstream ever reads a `.tmp`.
 */
async function claimSyncFavorites(path: string, item: KbizSyncFavoritesItem): Promise<boolean> {
  const body = `${JSON.stringify(item, null, 2)}\n`;
  try {
    await writeFile(path, body, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    // Anything other than "somebody already holds it" is a real filesystem
    // problem, and has to surface as a failed sync rather than as a phantom one
    // already in flight.
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
  }

  const held = await stat(path).catch(() => null);
  if (held === null || Date.now() - held.mtimeMs <= KBIZ_STALE_MS) return false;

  await rm(path, { force: true });
  try {
    await writeFile(path, body, { encoding: 'utf8', flag: 'wx' });
    return true;
  } catch (error) {
    if ((error as { code?: string }).code !== 'EEXIST') throw error;
    return false;
  }
}

async function releaseSyncClaim(path: string): Promise<void> {
  try {
    await rm(path, { force: true });
  } catch (error) {
    console.error('[kbiz] could not release the favorites-sync claim:', error);
  }
}

/**
 * Ask the bot for a fresh favorites list — at most one outstanding ask.
 *
 * An item still `approved` or `running` is reported back instead of being
 * duplicated: a second click while the bot is driving KBIZ would otherwise queue
 * a second browser session for work already in flight that lands on the same
 * file anyway. Anything already `done`/`failed` does not count — asking again is
 * exactly what "ซิงค์ใหม่" means — and neither does an abandoned one (see
 * `isAbandonedSyncItem`).
 *
 * The scan is NOT what enforces that, though: two clicks can pass it together.
 * The claim file is. It is taken exclusively, the queue is re-read while holding
 * it, and publishing releases it in the same atomic rename — so whoever holds
 * the claim can already see anything that was published, and the loser of a race
 * joins that ask rather than queueing a second scrape.
 *
 * Published dot-tmp → rename like `writeIntent`, for the same reason: the bot
 * globs `queue/*.json` and may only ever see a finished file.
 *
 * `id` is null in one case only: the caller lost the claim to a request that had
 * not published yet, so there was no id to report — `alreadyRunning` is still
 * the honest answer.
 */
export async function writeSyncFavoritesItem(): Promise<{
  id: string | null;
  alreadyRunning: boolean;
}> {
  await ensureSubdirs();

  const outstanding = await findOutstandingSyncItem();
  if (outstanding) return { id: outstanding.id, alreadyRunning: true };

  const item: KbizSyncFavoritesItem = {
    id: `sync_${crypto.randomUUID().replaceAll('-', '')}`,
    app: 'reimbursement',
    type: 'list-favorites',
    status: 'approved',
    createdAt: new Date().toISOString(),
  };

  const claim = queueFilePath(SYNC_CLAIM_FILE);
  if (!(await claimSyncFavorites(claim, item))) {
    const rival = await findOutstandingSyncItem();
    return { id: rival?.id ?? null, alreadyRunning: true };
  }

  // Under the claim: a rival that got here first has already published (that is
  // how it released the claim), so it is visible now even though it was not
  // during the scan above.
  const published = await findOutstandingSyncItem();
  if (published) {
    await releaseSyncClaim(claim);
    return { id: published.id, alreadyRunning: true };
  }

  try {
    await rename(claim, queueFilePath(`${item.id}.json`));
  } catch (error) {
    // Never leave the claim behind on a failed publish — the next sync would
    // have to wait out the whole stale window for a scrape that never queued.
    await releaseSyncClaim(claim);
    throw error;
  }

  return { id: item.id, alreadyRunning: false };
}

/**
 * Take a typed account number back out of an intent that has been filed away.
 *
 * A `custom` destination is the one shape carrying a REAL account number, and
 * the queue file is the only place this app ever writes one — the database
 * keeps the last four (`auditDestination` in routes/bundles.ts) because this
 * app stores no bank data (ADR 0001, decision 4). The file was the single
 * exception, and it was justified by being consumed: archiving it verbatim
 * instead left full account numbers in the shared tree forever, including for a
 * withdrawn intent that never moved a baht. By the time anything is archived
 * the bot is done with it, so the digits have no reader left and the kept copy
 * carries the same last four as the audit trail.
 *
 * Best effort by construction: the move has already happened when this runs, and
 * a failed redaction must never un-archive a reconciled payment. It logs and
 * leaves the copy as it found it.
 */
async function redactArchivedAccountNo(path: string): Promise<void> {
  try {
    const parsed: unknown = JSON.parse(await Bun.file(path).text());
    if (typeof parsed !== 'object' || parsed === null) return;

    // Ours only: the archive is shared with the payroll stack's own items.
    const intent = parsed as { app?: unknown; destination?: unknown };
    if (intent.app !== 'reimbursement') return;
    if (typeof intent.destination !== 'object' || intent.destination === null) return;

    const destination = intent.destination as {
      kind?: unknown;
      accountNo?: unknown;
      accountLast4?: unknown;
    };
    if (destination.kind !== 'custom' || typeof destination.accountNo !== 'string') return;

    destination.accountLast4 = destination.accountNo.slice(-4);
    delete destination.accountNo;
    await writeFile(path, `${JSON.stringify(intent, null, 2)}\n`, 'utf8');
  } catch (error) {
    console.error(`[kbiz] could not redact the account number in ${path}:`, error);
  }
}

/**
 * Move a reconciled intent out of the hot queue into `queue/archive/`.
 *
 * Called only AFTER the database has committed the outcome, so a crash between
 * the two leaves the file in place and the next sweep simply reconciles it
 * again — against a bundle that is no longer PAYING, which archives it as a
 * no-op. Losing the file first would lose the evidence instead.
 *
 * The move itself stays one atomic rename — the file is never briefly in both
 * places, so a crash can never hand the poller the same result twice — and the
 * account number is redacted out of the archived copy afterwards.
 */
export async function archiveQueueFile(name: string): Promise<void> {
  await ensureSubdirs();
  const archived = join(requireQueueDir(), ARCHIVE_SUBDIR, name);
  await rename(queueFilePath(name), archived);
  await redactArchivedAccountNo(archived);
}

/** How far an intent has got, as far as the queue directory can prove. */
export type KbizIntentState =
  /** No file in `queue/` — nothing was ever published for the bot to act on. */
  | 'unqueued'
  /** Published and still untouched (`status: 'approved'`): the bot has not started. */
  | 'queued'
  /** The bot claimed it (running, or terminal) — the outcome is its to report. */
  | 'in-flight'
  /** The queue is not readable right now, so nothing can be proved either way. */
  | 'unknown';

/**
 * Ask the queue what happened to an intent.
 *
 * This is what lets a human safely un-stick a bundle that the bot never picked
 * up: `unqueued` and `queued` both mean *nothing has been armed at the bank*,
 * which is provable from the filesystem rather than assumed. Everything else is
 * conservative on purpose — an unreadable or half-written file counts as
 * `in-flight`, because "cannot tell" must never read as "nothing moved".
 */
export async function readIntentState(intentId: string | null): Promise<KbizIntentState> {
  if (!intentId) return 'unqueued';
  if (!(await isKbizConfigured())) return 'unknown';

  const raw = await readQueueFile(intentFileName(intentId));
  if (raw === null) {
    // Missing (never written, or already archived) vs. present-but-unparsable.
    return (await intentFileExists(intentId)) ? 'in-flight' : 'unqueued';
  }

  const status = (raw as Partial<KbizPaymentIntent>).status;
  return status === 'approved' ? 'queued' : 'in-flight';
}

/**
 * Take an intent the bot has not started back out of `queue/`, so it can never
 * be picked up later.
 *
 * Returns true only when the bundle behind it is provably safe to release:
 * either there was nothing queued at all, or the untouched file has been moved
 * into `queue/archive/` (kept as evidence — a withdrawn intent is exactly the
 * sort of thing someone asks about later).
 */
export async function withdrawQueuedIntent(intentId: string): Promise<boolean> {
  const state = await readIntentState(intentId);
  if (state === 'unqueued') return true;
  if (state !== 'queued') return false;

  try {
    await archiveQueueFile(intentFileName(intentId));
  } catch (error) {
    console.error(`[kbiz] could not withdraw ${intentId} from the queue:`, error);
    return false;
  }

  // The bot claims an item by patching `status: 'running'` back into the very
  // path we just emptied. A file there again means it grabbed the intent inside
  // the rename window and owns it after all, so the withdrawal has failed even
  // though the move succeeded.
  if (await intentFileExists(intentId)) {
    console.error(`[kbiz] ${intentId} reappeared in queue/ after withdrawal — kbiz-bot claimed it`);
    return false;
  }

  return true;
}

/**
 * Resolve a bot-reported slip to an absolute path under `slips/`.
 *
 * `result.slipFile` is a basename by contract, but it arrives from another
 * process, so it is treated as untrusted input: anything with a separator, a
 * traversal segment or a character outside the uploads allowlist is refused
 * (null) rather than joined. A refused slip costs a proof image; an accepted
 * `../../etc/passwd` would cost rather more.
 */
export function slipSourcePath(slipFile: string): string | null {
  const name = slipFile.trim();
  if (name.length === 0 || name === '.' || name === '..') return null;
  if (name.includes('/') || name.includes('\\') || name !== basename(name)) return null;
  if (!SAFE_FILENAME.test(name)) return null;
  return join(requireQueueDir(), SLIPS_SUBDIR, name);
}

/**
 * What the serializers need to answer "can this bundle be paid through KBIZ?"
 * — loaded once per request and handed down, never re-read per bundle.
 *
 * Just the queue state since the pay-time destination picker landed: the payee
 * mapping is no longer part of the answer (see `computeKbizPayable`), so it is
 * not read here either.
 */
export interface KbizPaymentContext {
  configured: boolean;
}

export async function loadKbizPaymentContext(): Promise<KbizPaymentContext> {
  return { configured: await isKbizConfigured() };
}
