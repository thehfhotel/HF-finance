-- KBIZ payment automation: the PAYING window, the payment-intent pointer, and
-- the runtime settings table backing the admin-editable category mapping and
-- payee handles. See docs/adr/0001-kbiz-transfer-automation.md.
--
-- Hand-written (CLAUDE.md forbids `prisma migrate dev` here) and NOT yet applied
-- to any database.
--
-- Postgres quirk, deliberate: `ALTER TYPE … ADD VALUE` may run inside the
-- transaction `prisma migrate deploy` wraps this file in (PG 12+), but the new
-- label may NOT be *used* in that same transaction. Nothing below references
-- 'PAYING' — no backfill, no default, no CHECK — so this file is safe as one
-- unit. If a future migration needs to write 'PAYING' rows, put that in a
-- separate migration that runs after this one has committed.
--
-- `BEFORE 'PAID'` keeps the on-disk label order matching the lifecycle order in
-- schema.prisma (DRAFT → PENDING → APPROVED → PAYING → PAID → REJECTED), which
-- is what `ORDER BY status` sorts on.

-- AlterEnum
ALTER TYPE "BundleStatus" ADD VALUE 'PAYING' BEFORE 'PAID';

-- AlterTable
ALTER TABLE "bundles" ADD COLUMN "paymentIntentId" TEXT;
ALTER TABLE "bundles" ADD COLUMN "paymentError" TEXT;

-- CreateIndex
-- Unique, so the database itself refuses to let one queued intent own two
-- bundles. NULLs do not collide in Postgres, so every bundle that has never
-- been paid through KBIZ is unaffected.
CREATE UNIQUE INDEX "bundles_paymentIntentId_key" ON "bundles"("paymentIntentId");

-- CreateTable
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);
