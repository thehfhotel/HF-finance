-- The company expense ledger moves to income.thehfhotel.org; this app is
-- reimbursement-only. Both tables were never written to in production
-- (0 rows, 0 inserts ever), so the drop is a clean feature extraction.

UPDATE "users" SET "role" = 'EMPLOYEE' WHERE "role" = 'ADMIN';

DROP TABLE IF EXISTS "expenses";
DROP TABLE IF EXISTS "revenue_entries";

ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('EMPLOYEE', 'APPROVER');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'EMPLOYEE';
DROP TYPE "Role_old";
