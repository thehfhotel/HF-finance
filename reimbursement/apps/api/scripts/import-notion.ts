/**
 * import-notion.ts — backfill historical reimbursement records from a
 * Notion CSV export. Designed to run inside the api container with the
 * preprocessed bundle (`import.json` + `photos/`) mounted at /import.
 *
 * What it does, per record:
 *   1. Copy /import/photos/<file> → /app/apps/api/uploads/<file>
 *      (only if the photo is present in the bundle)
 *   2. Upsert a Bundle (status='paid', owned by OWNER_ID), then upsert a
 *      Receipt linked to it. Both keyed on stable ids derived from the
 *      Notion data, so re-running is idempotent.
 *
 * Each historical row becomes a 1-receipt paid bundle so it surfaces in
 * the approver inbox under "จ่ายแล้ว" — same bucket as receipts that
 * went through the live workflow.
 *
 * Run:
 *   docker run --rm \
 *     --network reimbursement_v2_internal \
 *     --env-file ~/production/.env \
 *     -v /tmp/notion-import:/import:ro \
 *     -v reimbursement_v2_uploads_data:/app/apps/api/uploads \
 *     ghcr.io/thehfhotel/payroll-reimbursement-api:latest \
 *     bun run scripts/import-notion.ts
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { prisma } from '../src/db';

const IMPORT_DIR = process.env.IMPORT_DIR ?? '/import';
const PHOTOS_DIR = process.env.PHOTOS_DIR ?? `${IMPORT_DIR}/photos`;
const JSON_PATH = process.env.JSON_PATH ?? `${IMPORT_DIR}/import.json`;
const UPLOADS_DIR = process.env.UPLOADS_DIR ?? '/app/apps/api/uploads';
const OWNER_ID = process.env.OWNER_ID ?? 'user_owner';

interface NotionRecord {
  id: string;
  title: string;
  category: string;
  property: 'hf-hotel' | 'hf-ville';
  quantity: number | null;
  amount: number;
  date: string;
  items: string[];
  photoFile: string | null;
  /** From Notion's สถานะการเบิก. Absent in manifests built before the column
   *  was carried through — those are treated as PAID, the old assumption. */
  status?: 'PAID' | 'PENDING';
}

const PALETTE: ReadonlyArray<readonly [string, string]> = [
  ['#F5EBD9', '#7E5E3A'],
  ['#FFE9D6', '#A04A1A'],
  ['#E8F0F4', '#1A4A6E'],
  ['#EDE3D2', '#5A3A1A'],
  ['#E6F4EA', '#0A6E40'],
];

function paletteFor(id: string): readonly [string, string] {
  let h = 0;
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length]!;
}

function bundleIdFor(receiptId: string): string {
  // Different prefix so bundle/receipt ids don't collide in queries.
  return receiptId.replace(/^imp_/, 'impb_');
}

function isoDate(yyyymmdd: string): Date {
  const [y, m, d] = yyyymmdd.split('-').map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0)); // noon UTC for stability
}

function copyPhoto(file: string): string | null {
  const src = resolve(PHOTOS_DIR, file);
  if (!existsSync(src)) return null;
  mkdirSync(UPLOADS_DIR, { recursive: true });
  const dest = resolve(UPLOADS_DIR, file);
  if (!existsSync(dest)) {
    copyFileSync(src, dest);
  }
  return `/uploads/${file}`;
}

async function ensureOwner(): Promise<void> {
  const owner = await prisma.user.findUnique({ where: { id: OWNER_ID } });
  if (!owner) {
    throw new Error(
      `User '${OWNER_ID}' does not exist in the DB. Seed the owner first ` +
        `before importing — historical receipts are attributed to her.`,
    );
  }
  if (owner.role !== 'APPROVER') {
    throw new Error(
      `User '${OWNER_ID}' is role=${owner.role}; the importer assumes she is APPROVER.`,
    );
  }
}

async function importOne(record: NotionRecord): Promise<'created' | 'updated' | 'skipped'> {
  const bundleId = bundleIdFor(record.id);
  const submittedAt = isoDate(record.date);
  // Older manifests have no `status` field; treat those as PAID, which is what
  // this script assumed for every row before the column was carried through.
  const isPending = record.status === 'PENDING';
  const [color, accent] = paletteFor(record.id);

  const photoPath = record.photoFile ? copyPhoto(record.photoFile) : null;

  // Items as the Receipt's `items` JSON: tuple [label, value]. We only
  // know labels from the Notion sub-items, so value is the empty string.
  const items: ReadonlyArray<readonly [string, string]> =
    record.items.length > 0
      ? record.items.map((label) => [label, ''] as const)
      : [['—', record.amount.toFixed(2)] as const];

  // Use a transaction: bundle + receipt go in together, or not at all.
  const result = await prisma.$transaction(async (tx) => {
    const before = await tx.bundle.findUnique({ where: { id: bundleId } });

    await tx.bundle.upsert({
      where: { id: bundleId },
      update: {
        // Idempotent re-run: don't change historical timestamps; only
        // refresh display fields.
        name: record.title,
      },
      create: {
        id: bundleId,
        userId: OWNER_ID,
        name: record.title,
        // Carried from Notion's สถานะการเบิก. The first import hardcoded PAID,
        // so rows still listed as รายการใหม่ arrived approved and paid; a
        // pending row must land with no approval and no payment against it.
        status: isPending ? 'PENDING' : 'PAID',
        submittedAt,
        approvedAt: isPending ? null : submittedAt,
        approvedById: isPending ? null : OWNER_ID,
        paidAt: isPending ? null : submittedAt,
        transferRef: null,
        transferAmount: isPending ? null : record.amount,
        transferProofPath: null,
        note: '',
      },
    });

    await tx.receipt.upsert({
      where: { id: record.id },
      update: {
        merchant: record.title,
        category: record.category,
        property: record.property,
        quantity: record.quantity,
        amount: record.amount,
        date: record.date,
        items: items as unknown as object,
        photoPath: photoPath ?? undefined,
      },
      create: {
        id: record.id,
        userId: OWNER_ID,
        merchant: record.title,
        category: record.category,
        property: record.property,
        quantity: record.quantity,
        amount: record.amount,
        date: record.date,
        note: null,
        color,
        accent,
        items: items as unknown as object,
        tax: '0',
        photoPath,
        bundleId,
      },
    });

    return before === null ? ('created' as const) : ('updated' as const);
  });

  return result;
}

async function main(): Promise<void> {
  if (!existsSync(JSON_PATH)) {
    throw new Error(`import.json not found at ${JSON_PATH}`);
  }
  await ensureOwner();

  const raw = readFileSync(JSON_PATH, 'utf-8');
  const records = JSON.parse(raw) as NotionRecord[];
  console.log(`Read ${records.length} records from ${JSON_PATH}`);

  let created = 0;
  let updated = 0;
  let failed = 0;
  const start = Date.now();

  for (const [i, rec] of records.entries()) {
    try {
      const status = await importOne(rec);
      if (status === 'created') created += 1;
      else if (status === 'updated') updated += 1;
    } catch (e) {
      failed += 1;
      const msg = e instanceof Error ? e.message : String(e);
      console.error(`  [${i}] ${rec.id} ${rec.title}: ${msg}`);
    }
    if ((i + 1) % 100 === 0) {
      const ms = Date.now() - start;
      console.log(`  …${i + 1}/${records.length} (${created} created, ${updated} updated, ${failed} failed, ${ms}ms)`);
    }
  }

  const ms = Date.now() - start;
  console.log('');
  console.log(`Done in ${ms}ms.`);
  console.log(`  created: ${created}`);
  console.log(`  updated: ${updated}`);
  console.log(`  failed:  ${failed}`);

  await prisma.$disconnect();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Importer crashed:', e);
  process.exit(1);
});
