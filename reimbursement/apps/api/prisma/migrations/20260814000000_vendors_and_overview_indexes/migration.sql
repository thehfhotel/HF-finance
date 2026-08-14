-- Vendor as a first-class concept + the indexes the ภาพรวม rebuild needs.
--
-- Hand-written (CLAUDE.md forbids `prisma migrate dev` here). `gen_random_uuid()`
-- is core in Postgres 13+; both docker-compose files pin postgres:16-alpine.
--
-- The backfill is IDEMPOTENT: re-running it creates no duplicate vendors
-- (ON CONFLICT DO NOTHING on the unique normalized name) and re-links nothing
-- that is already linked (WHERE r."vendorId" IS NULL).

-- ── the normalization rule: one definition, used by the backfill below and by
--    apps/api/src/vendors.ts at runtime. Never mirror this in TypeScript: JS
--    `\s` includes U+FEFF and Postgres `[[:space:]]` does not, so two
--    implementations drift and the drift creates a second vendor row per shop.
CREATE OR REPLACE FUNCTION vendor_normalize(input text)
RETURNS text LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT lower(btrim(regexp_replace(input, '[[:space:]]+', ' ', 'g')))
$$;

-- CreateTable
CREATE TABLE "vendors" (
    "id"             TEXT NOT NULL DEFAULT gen_random_uuid()::text,
    "name"           TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vendors_normalizedName_key" ON "vendors"("normalizedName");

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN "vendorId" TEXT;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "vendors"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- ── one-time backfill ────────────────────────────────────────────────────
-- (1) one vendor per distinct normalized merchant. `name` takes the OLDEST
--     receipt's spelling — the first way the team wrote it, not an arbitrary
--     row. Blank / whitespace-only merchants are skipped entirely.
INSERT INTO "vendors" ("name", "normalizedName")
SELECT DISTINCT ON (vendor_normalize(r."merchant"))
       btrim(r."merchant"),
       vendor_normalize(r."merchant")
FROM "receipts" r
WHERE vendor_normalize(r."merchant") <> ''
ORDER BY vendor_normalize(r."merchant"), r."createdAt" ASC, r."id" ASC
ON CONFLICT ("normalizedName") DO NOTHING;

-- (2) link every existing receipt to its vendor.
UPDATE "receipts" r
SET "vendorId" = v."id"
FROM "vendors" v
WHERE v."normalizedName" = vendor_normalize(r."merchant")
  AND vendor_normalize(r."merchant") <> ''
  AND r."vendorId" IS NULL;

-- ── indexes for the ภาพรวม queries ───────────────────────────────────────
CREATE INDEX "receipts_vendorId_idx"             ON "receipts"("vendorId");
CREATE INDEX "receipts_bundleId_vendorId_idx"    ON "receipts"("bundleId", "vendorId");
CREATE INDEX "receipts_bundleId_category_idx"    ON "receipts"("bundleId", "category");
CREATE INDEX "receipts_bundleId_property_idx"    ON "receipts"("bundleId", "property");
CREATE INDEX "receipts_bundleId_userId_idx"      ON "receipts"("bundleId", "userId");
CREATE INDEX "bundles_status_paidAt_idx"         ON "bundles"("status", "paidAt");
CREATE INDEX "bundles_status_submittedAt_idx"    ON "bundles"("status", "submittedAt");
-- The flow query's intake arm carries no status, so the composite above cannot
-- serve it; without this one the planner seq-scans bundles per request.
CREATE INDEX "bundles_submittedAt_idx"           ON "bundles"("submittedAt");
CREATE INDEX "bundles_approvedAt_idx"            ON "bundles"("approvedAt");
CREATE INDEX "audit_events_type_createdAt_idx"   ON "audit_events"("type", "createdAt");
