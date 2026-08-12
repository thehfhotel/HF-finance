-- Add an optional reject reason so approvers can tell the submitter why a
-- request was rejected.
ALTER TABLE "bundles" ADD COLUMN "rejectReason" TEXT;
