-- When a bundle entered PAYING, so a payment nobody ever hears back about can
-- be noticed instead of sitting in the approver's list forever.
--
-- Stamped by the same atomic APPROVED→PAYING claim that writes
-- `paymentIntentId`, cleared on every exit (PAID, released back to APPROVED).
-- The poller's stranded-payment watchdog reads it to decide when an in-flight
-- payment has gone quiet for too long.
--
-- Hand-written (CLAUDE.md forbids `prisma migrate dev` here) and NOT applied to
-- any database. Additive and nullable: rows written before this migration —
-- there are none in PAYING, the status ships in the migration right before
-- this one — simply carry NULL and are skipped by the watchdog.

-- AlterTable
ALTER TABLE "bundles" ADD COLUMN "payingSince" TIMESTAMP(3);
