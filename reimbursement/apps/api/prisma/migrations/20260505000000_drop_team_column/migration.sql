-- Drop the team column from users. We only need user/approver as roles;
-- there's no team / department concept.
ALTER TABLE "users" DROP COLUMN "team";
