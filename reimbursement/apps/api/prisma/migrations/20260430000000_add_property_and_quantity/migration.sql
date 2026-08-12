-- AlterTable: add hotel-vs-ville property dimension and optional quantity to receipts.
ALTER TABLE "receipts" ADD COLUMN "property" TEXT NOT NULL DEFAULT 'hf-hotel';
ALTER TABLE "receipts" ADD COLUMN "quantity" INTEGER;
