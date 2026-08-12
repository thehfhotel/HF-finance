-- Add an optional HF-ID badge so a signed card assertion from the central HF-ID
-- service (id_token `sub` = badge) can be resolved to this app's internal User.
-- Unique so a badge maps to at most one employee. Rows without a badge simply
-- cannot card-login (they still log in via LINE as before).
ALTER TABLE "users" ADD COLUMN "badge" TEXT;
CREATE UNIQUE INDEX "users_badge_key" ON "users"("badge");
