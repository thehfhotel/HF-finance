-- Cloudflare Access replaces LINE OAuth as the interactive login (card login
-- unchanged). Add the admin-managed login email used to map a verified Access
-- identity (JWT `email` claim, stored lowercased) to this row, and drop every
-- LINE column — the code paths were removed in the same change.

ALTER TABLE "users" ADD COLUMN "email" TEXT;
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

DROP INDEX IF EXISTS "users_lineId_key";
DROP INDEX IF EXISTS "users_lineLinkingCode_key";
ALTER TABLE "users" DROP COLUMN "lineId";
ALTER TABLE "users" DROP COLUMN "lineDisplayName";
ALTER TABLE "users" DROP COLUMN "linePictureUrl";
ALTER TABLE "users" DROP COLUMN "lineLinkingCode";
ALTER TABLE "users" DROP COLUMN "lineLinkingCodeGeneratedAt";
