-- AlterTable: add LINE auth profile + binding-code fields to users.
ALTER TABLE "users" ADD COLUMN "lineDisplayName" TEXT;
ALTER TABLE "users" ADD COLUMN "linePictureUrl" TEXT;
ALTER TABLE "users" ADD COLUMN "lineLinkingCode" TEXT;
ALTER TABLE "users" ADD COLUMN "lineLinkingCodeGeneratedAt" TIMESTAMP(3);

-- CreateIndex: linking codes are 6-digit numeric, unique per active code.
CREATE UNIQUE INDEX "users_lineLinkingCode_key" ON "users"("lineLinkingCode");
