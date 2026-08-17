-- Several files per receipt.
--
-- Hand-written (CLAUDE.md: no `prisma migrate dev` here — it needs a TTY).
--
-- One expense is often several files: a paper receipt photographed as three
-- shots, or an invoice plus its delivery note. Until now each file had to become
-- its own receipt, which either double-counted the amount or forced people to
-- drop evidence.
--
-- `receipts.photoPath` is deliberately NOT dropped. It is read in fourteen files
-- including the approver's review and pay screens, and every one of the ~1,550
-- existing rows carries it. It stays as a mirror of the first file, so any
-- screen that has not learned about `files` still renders something correct
-- rather than a receipt with no photo. See
-- docs/change-requests/CR-2026-08-16-ios-share-to-receipt.md.

CREATE TABLE "receipt_files" (
    "id"           TEXT NOT NULL,
    "receiptId"    TEXT NOT NULL,
    "photoPath"    TEXT NOT NULL,
    "originalPath" TEXT,
    "mimeType"     TEXT NOT NULL DEFAULT 'image/jpeg',
    "filename"     TEXT,
    "sizeBytes"    INTEGER NOT NULL DEFAULT 0,
    "position"     INTEGER NOT NULL DEFAULT 0,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_files_pkey" PRIMARY KEY ("id")
);

-- The only access pattern: "this receipt's files, in display order".
CREATE INDEX "receipt_files_receiptId_position_idx" ON "receipt_files"("receiptId", "position");

ALTER TABLE "receipt_files" ADD CONSTRAINT "receipt_files_receiptId_fkey"
  FOREIGN KEY ("receiptId") REFERENCES "receipts"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── Backfill ──────────────────────────────────────────────────────────────
-- Every existing photo becomes that receipt's file at position 0, so `files`
-- is the complete truth from the first request after this migration and no
-- screen has to special-case "receipts from before multi-file".
--
-- IDEMPOTENT: re-running inserts nothing, because of the NOT EXISTS guard.
-- `gen_random_uuid()` is core in Postgres 13+; both compose files pin
-- postgres:16-alpine.
--
-- mimeType is left at its 'image/jpeg' default rather than guessed from the
-- extension: it is display metadata only, every one of these rows is already a
-- displayable image, and inventing a value would make the column look more
-- authoritative than it is for historical rows.
INSERT INTO "receipt_files" ("id", "receiptId", "photoPath", "position", "createdAt")
SELECT gen_random_uuid()::text, r."id", r."photoPath", 0, r."createdAt"
FROM "receipts" r
WHERE r."photoPath" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "receipt_files" f WHERE f."receiptId" = r."id"
  );
