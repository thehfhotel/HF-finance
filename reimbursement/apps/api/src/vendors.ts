import { prisma } from './db';

/**
 * Resolve a typed merchant string to a Vendor id, creating the vendor on first
 * sight.
 *
 * Normalization happens in `vendor_normalize()` inside Postgres and NOWHERE
 * else: the backfill in migration 20260814000000 calls the same function, so a
 * receipt saved today and a receipt imported last year can never land on two
 * different vendor rows for one shop. `DO UPDATE SET "name" = vendors."name"`
 * is a deliberate no-op write — `DO NOTHING` returns no row, and this needs the
 * id back in one round trip.
 *
 * A blank or whitespace-only merchant normalizes to '' and yields null, which
 * is what leaves the receipt grouping by its raw string in ตามร้านค้า.
 */
export async function resolveVendorId(
  merchant: string | null | undefined,
): Promise<string | null> {
  if (merchant === null || merchant === undefined) return null;

  // The raw string goes in untouched. JS `trim()` strips U+00A0/U+FEFF/U+3000
  // where Postgres `[[:space:]]` does not, so trimming here would resolve a
  // merchant pasted with an NBSP to a different vendor than the migration's
  // backfill does — the drift the "normalize in one place" rule exists to
  // stop. `vendor_normalize(...) <> ''` is the only blank test; a blank
  // merchant yields no row and therefore null.
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "vendors" ("name", "normalizedName")
    SELECT btrim(${merchant}), vendor_normalize(${merchant})
    WHERE vendor_normalize(${merchant}) <> ''
    ON CONFLICT ("normalizedName")
      DO UPDATE SET "name" = "vendors"."name"
    RETURNING "id"
  `;
  return rows[0]?.id ?? null;
}
