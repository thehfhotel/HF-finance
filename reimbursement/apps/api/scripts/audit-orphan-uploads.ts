/**
 * audit-orphan-uploads.ts — find (and optionally delete) files in the uploads
 * volume that no database row references any more.
 *
 * WHY THIS EXISTS
 *
 * Until 2026-08-17 nothing deleted uploaded bytes: discarding a shared file or
 * deleting a receipt removed the row and left the file forever. That is fixed
 * going forward (`deleteUploadedFiles`, CR-2026-08-16), but the historical
 * leftovers are invisible to the app and stay until something like this sweeps
 * them.
 *
 * SAFETY — read this before running with --delete
 *
 * This volume holds evidence for real expense claims: ~1,500 receipt photos and
 * the bank-transfer slips that prove payments were made. A bug in the
 * "unreferenced" query deletes proof of money moving. So:
 *
 *   - Report-only by DEFAULT. Deleting requires an explicit `--delete`.
 *   - It enumerates EVERY column in the schema that can hold an uploads path
 *     (receipts.photoPath, receipt_inbox.photoPath + originalPath,
 *     bundles.transferProofPath). If a future migration adds another one and it
 *     is not added to REFERENCE_COLUMNS below, this script will happily delete
 *     live files — the check at the end guards against that by refusing to run
 *     if it finds a path-shaped column it does not know about.
 *   - A file younger than MIN_AGE_HOURS is never touched, so an upload that is
 *     mid-flight (row not yet committed) cannot be swept out from under itself.
 *
 * USAGE (on evergreen, from the deploy dir)
 *
 *   docker compose exec api bun run scripts/audit-orphan-uploads.ts
 *   docker compose exec api bun run scripts/audit-orphan-uploads.ts --delete
 */

import { readdir, stat, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { prisma } from '../src/db';

const UPLOADS_DIR = resolve(process.cwd(), 'uploads');
const THUMBS_DIR = join(UPLOADS_DIR, '.thumbs');
const PUBLIC_PREFIX = '/uploads/';

const DELETE = process.argv.includes('--delete');

/**
 * Never touch anything newer than this. An upload writes the file first and the
 * row second; without a floor, a sweep running in that window would delete a
 * file whose row is milliseconds away from existing.
 */
const MIN_AGE_HOURS = 24;

/** Files that are not uploads and must be left alone. */
const KEEP = new Set(['.gitkeep', '.thumbs']);

/**
 * Every place a path can be stored. Keep in sync with schema.prisma — the
 * guard below fails the run if the schema grows one this list is missing.
 */
const REFERENCE_COLUMNS = [
  { table: 'receipts', column: 'photoPath' },
  { table: 'receipt_inbox', column: 'photoPath' },
  { table: 'receipt_inbox', column: 'originalPath' },
  { table: 'bundles', column: 'transferProofPath' },
] as const;

function basenameOf(storedPath: string | null): string | null {
  if (!storedPath) return null;
  if (!storedPath.startsWith(PUBLIC_PREFIX)) return null;
  return storedPath.slice(PUBLIC_PREFIX.length);
}

function human(bytes: number): string {
  if (bytes > 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

async function main(): Promise<void> {
  // ── Guard: refuse to run if the schema has a path column we do not know ────
  const pathColumns = await prisma.$queryRaw<{ table_name: string; column_name: string }[]>`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name ILIKE '%path%')
  `;
  const known = new Set(REFERENCE_COLUMNS.map((c) => `${c.table}.${c.column}`));
  const unknown = pathColumns
    .map((c) => `${c.table_name}.${c.column_name}`)
    .filter((c) => !known.has(c));
  if (unknown.length > 0) {
    console.error(
      `✖ Schema has path columns this script does not know about:\n   ${unknown.join('\n   ')}\n` +
        `   Add them to REFERENCE_COLUMNS before running, or this sweep would treat\n` +
        `   the files they reference as orphans and delete live data.`,
    );
    process.exit(1);
  }

  // ── Everything the database still points at ───────────────────────────────
  const referenced = new Set<string>();
  const add = (p: string | null) => {
    const name = basenameOf(p);
    if (name) referenced.add(name);
  };

  for (const r of await prisma.receipt.findMany({ select: { photoPath: true } })) add(r.photoPath);
  for (const i of await prisma.receiptInbox.findMany({
    select: { photoPath: true, originalPath: true },
  })) {
    add(i.photoPath);
    add(i.originalPath);
  }
  for (const b of await prisma.bundle.findMany({ select: { transferProofPath: true } })) {
    add(b.transferProofPath);
  }

  // ── Everything actually on disk ───────────────────────────────────────────
  const entries = await readdir(UPLOADS_DIR).catch(() => [] as string[]);
  const cutoff = Date.now() - MIN_AGE_HOURS * 3600_000;

  const orphans: { name: string; bytes: number; age: string }[] = [];
  let liveCount = 0;
  let tooNew = 0;

  for (const name of entries) {
    if (KEEP.has(name)) continue;
    if (referenced.has(name)) {
      liveCount += 1;
      continue;
    }
    const info = await stat(join(UPLOADS_DIR, name)).catch(() => null);
    if (!info || !info.isFile()) continue;
    if (info.mtimeMs > cutoff) {
      tooNew += 1;
      continue;
    }
    const days = Math.floor((Date.now() - info.mtimeMs) / 86_400_000);
    orphans.push({ name, bytes: info.size, age: `${days}d` });
  }

  // ── Orphaned thumbnails: a cached render whose source is gone ─────────────
  const orphanThumbs: { path: string; bytes: number }[] = [];
  const widthDirs = await readdir(THUMBS_DIR).catch(() => [] as string[]);
  for (const w of widthDirs) {
    const dir = join(THUMBS_DIR, w);
    for (const thumb of await readdir(dir).catch(() => [] as string[])) {
      // Layout is <original-filename>.webp
      const source = thumb.replace(/\.webp$/, '');
      if (referenced.has(source)) continue;
      const info = await stat(join(dir, thumb)).catch(() => null);
      if (!info?.isFile()) continue;
      orphanThumbs.push({ path: join(dir, thumb), bytes: info.size });
    }
  }

  // ── Report ────────────────────────────────────────────────────────────────
  const orphanBytes = orphans.reduce((s, o) => s + o.bytes, 0);
  const thumbBytes = orphanThumbs.reduce((s, t) => s + t.bytes, 0);

  console.log(`\nuploads volume: ${resolve(UPLOADS_DIR)}`);
  console.log(`  referenced by the database : ${liveCount} files (kept)`);
  console.log(`  younger than ${MIN_AGE_HOURS}h        : ${tooNew} files (skipped, may be mid-upload)`);
  console.log(`  ORPHANED                   : ${orphans.length} files, ${human(orphanBytes)}`);
  console.log(`  orphaned thumbnails        : ${orphanThumbs.length} files, ${human(thumbBytes)}`);
  console.log(`  reclaimable total          : ${human(orphanBytes + thumbBytes)}\n`);

  if (orphans.length > 0) {
    console.log('orphaned files (oldest first):');
    for (const o of orphans.sort((a, b) => b.age.localeCompare(a.age)).slice(0, 50)) {
      console.log(`  ${o.name}  ${human(o.bytes).padStart(8)}  ${o.age}`);
    }
    if (orphans.length > 50) console.log(`  … and ${orphans.length - 50} more`);
    console.log('');
  }

  if (!DELETE) {
    console.log('REPORT ONLY — nothing was deleted. Re-run with --delete to reclaim.\n');
    return;
  }

  let removed = 0;
  for (const o of orphans) {
    await rm(join(UPLOADS_DIR, o.name), { force: true });
    removed += 1;
  }
  for (const t of orphanThumbs) await rm(t.path, { force: true });
  console.log(`deleted ${removed} files + ${orphanThumbs.length} thumbnails, freed ${human(orphanBytes + thumbBytes)}\n`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
