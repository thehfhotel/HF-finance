-- Receipt inbox + share tokens: the iPhone/Android share-sheet path.
--
-- Hand-written (CLAUDE.md: no `prisma migrate dev` here — it needs a TTY).
--
-- Two new tables, ZERO changes to existing ones. That is the point of the
-- design: a shared file never becomes a half-populated `receipts` row, so
-- nothing downstream (bundle totals, KBIZ category mapping, the approver
-- inbox, stats) has to learn a new shape. See
-- docs/change-requests/CR-2026-08-16-ios-share-to-receipt.md.

-- ── receipt_inbox ─────────────────────────────────────────────────────────
-- A file with an owner, waiting to become a Receipt. Deleted when drained;
-- this is a queue, not history.
CREATE TABLE "receipt_inbox" (
    "id"           TEXT NOT NULL,
    "userId"       TEXT NOT NULL,
    "photoPath"    TEXT NOT NULL,
    "originalPath" TEXT,
    "mimeType"     TEXT NOT NULL,
    "filename"     TEXT,
    "sizeBytes"    INTEGER NOT NULL,
    "source"       TEXT NOT NULL DEFAULT 'ios-share',
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_inbox_pkey" PRIMARY KEY ("id")
);

-- The only query this table serves: "my inbox, newest first". Composite so the
-- sort is served by the index too, not a re-sort of the owner's rows.
CREATE INDEX "receipt_inbox_userId_createdAt_idx" ON "receipt_inbox"("userId", "createdAt");

ALTER TABLE "receipt_inbox" ADD CONSTRAINT "receipt_inbox_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- ── share_tokens ──────────────────────────────────────────────────────────
-- Opaque per-employee upload credentials. Only the SHA-256 hash is stored, so
-- a dump of this table cannot be replayed against the API.
CREATE TABLE "share_tokens" (
    "id"         TEXT NOT NULL,
    "userId"     TEXT NOT NULL,
    "tokenHash"  TEXT NOT NULL,
    "hint"       TEXT NOT NULL,
    "label"      TEXT NOT NULL DEFAULT '',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt"  TIMESTAMP(3),
    "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "share_tokens_pkey" PRIMARY KEY ("id")
);

-- Unique, so the database itself refuses to hold one token twice — and so the
-- verify path is a single indexed lookup on the hash rather than a scan.
CREATE UNIQUE INDEX "share_tokens_tokenHash_key" ON "share_tokens"("tokenHash");

CREATE INDEX "share_tokens_userId_idx" ON "share_tokens"("userId");

ALTER TABLE "share_tokens" ADD CONSTRAINT "share_tokens_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
