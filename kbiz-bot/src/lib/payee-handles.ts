import { rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CONFIG_PATH, loadTransferConfig, type TransferConfig } from "./transfer-config";

/**
 * Publish the payee-book HANDLE NAMES into the shared queue dir, so the
 * reimbursement admin screen can offer a dropdown instead of free text.
 *
 * Only the handles cross the boundary — the payee book itself (bank names,
 * account numbers) never leaves this container; that separation is the whole
 * reason the book mounts from its own kbiz-bot-only dir. A handle like
 * "revew" is an opaque label with nothing to leak.
 *
 * The file lives INSIDE queue/ (`queue/payee-handles.json`) because that is
 * the only bot→reimbursement-visible path that needs no new mount: the
 * nested binds cover exactly queue/, slips/ and vouchers/. Both queue
 * scanners skip it by name.
 *
 * Republished on every watch tick, gated on the payee book's mtime — editing
 * the book on the host shows up in the admin dropdown within one poll
 * interval, no restart needed. Never throws: a broken/missing book logs once
 * per change and leaves the previous manifest in place (better a stale list
 * than none while ops mid-edits the file).
 */

export const HANDLES_FILE = "payee-handles.json";

export interface HandlesManifest {
  handles: string[];
  updatedAt: string;
}

/** Pure: manifest content from a loaded config. Sorted for stable diffs. */
export function buildHandlesManifest(config: TransferConfig, now: Date = new Date()): HandlesManifest {
  return {
    handles: Object.keys(config.recipients).sort(),
    updatedAt: now.toISOString(),
  };
}

let lastPublishedMtimeMs: number | null = null;
let warnedForMtimeMs: number | null = null;

export async function publishPayeeHandles(queueDir: string): Promise<void> {
  let mtimeMs: number;
  try {
    mtimeMs = (await stat(CONFIG_PATH)).mtimeMs;
  } catch {
    return; // no payee book on this machine (dev) — nothing to publish
  }
  if (mtimeMs === lastPublishedMtimeMs) return;

  let manifest: HandlesManifest;
  try {
    manifest = buildHandlesManifest(loadTransferConfig());
  } catch (e) {
    if (mtimeMs !== warnedForMtimeMs) {
      console.warn(`⚠ payee book unreadable, handles manifest not updated: ${(e as Error).message}`);
      warnedForMtimeMs = mtimeMs;
    }
    return;
  }

  // Atomic tmp+rename, dot-prefixed so no queue scanner ever sees a half-write.
  const target = join(queueDir, HANDLES_FILE);
  const tmp = join(queueDir, `.${HANDLES_FILE}.tmp`);
  try {
    await writeFile(tmp, JSON.stringify(manifest, null, 2), "utf8");
    await rename(tmp, target);
    lastPublishedMtimeMs = mtimeMs;
    console.log(`→ published ${manifest.handles.length} payee handle(s) to ${HANDLES_FILE}`);
  } catch (e) {
    console.warn(`⚠ could not publish handles manifest: ${(e as Error).message}`);
  }
}
