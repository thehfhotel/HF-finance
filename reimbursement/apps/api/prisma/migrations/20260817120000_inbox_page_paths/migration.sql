-- A shared PDF becomes one image PER PAGE, so the queue has to carry all of
-- them through to the receipt — otherwise draining a three-page invoice would
-- silently produce a one-page receipt.
--
-- Hand-written (CLAUDE.md: no `prisma migrate dev` here — it needs a TTY).

ALTER TABLE "receipt_inbox" ADD COLUMN "pagePaths" TEXT[] NOT NULL DEFAULT '{}';

-- Backfill: existing rows are single-page by construction (they predate
-- per-page rendering), so their one displayable path IS their page list.
-- Idempotent — re-running only touches rows still holding the default.
UPDATE "receipt_inbox"
SET "pagePaths" = ARRAY["photoPath"]
WHERE cardinality("pagePaths") = 0;
