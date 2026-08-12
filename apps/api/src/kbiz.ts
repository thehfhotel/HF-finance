import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import type { KbizPaymentIntent, KbizPayeeHandles } from '@reimbursement/shared';
import { getKbizPayees } from './settings';

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
 * Publish an intent for the bot, atomically.
 *
 * Written to a dot-prefixed `.tmp` sibling and renamed into place: the bot's
 * watcher globs `queue/*.json`, so it can only ever see the finished file. A
 * half-written intent — a truncated amount, a missing payee — must never be
 * pickable.
 */
export async function writeIntent(intent: KbizPaymentIntent): Promise<void> {
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

export interface PayeeHandlesManifest {
  handles: string[];
  updatedAt: string | null;
}

/** Read the bot-published handle list; null when absent/unreadable/garbled. */
export async function readPayeeHandlesManifest(): Promise<PayeeHandlesManifest | null> {
  if (!QUEUE_DIR) return null;
  try {
    const raw = JSON.parse(
      await Bun.file(join(QUEUE_DIR, QUEUE_SUBDIR, PAYEE_HANDLES_FILE)).text(),
    ) as { handles?: unknown; updatedAt?: unknown };
    if (!Array.isArray(raw.handles) || !raw.handles.every((h) => typeof h === 'string')) return null;
    return {
      handles: raw.handles,
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
      (name) => name.endsWith('.json') && !name.startsWith('.') && name !== PAYEE_HANDLES_FILE,
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
 * Move a reconciled intent out of the hot queue into `queue/archive/`.
 *
 * Called only AFTER the database has committed the outcome, so a crash between
 * the two leaves the file in place and the next sweep simply reconciles it
 * again — against a bundle that is no longer PAYING, which archives it as a
 * no-op. Losing the file first would lose the evidence instead.
 */
export async function archiveQueueFile(name: string): Promise<void> {
  await ensureSubdirs();
  await rename(queueFilePath(name), join(requireQueueDir(), ARCHIVE_SUBDIR, name));
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
 */
export interface KbizPaymentContext {
  configured: boolean;
  payees: KbizPayeeHandles;
}

export async function loadKbizPaymentContext(): Promise<KbizPaymentContext> {
  const [configured, payees] = await Promise.all([isKbizConfigured(), getKbizPayees()]);
  return { configured, payees };
}
