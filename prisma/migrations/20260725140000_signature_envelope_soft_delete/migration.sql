-- Soft-delete / corbeille pour MEGA Signature
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "SignatureEnvelope_deletedAt_idx" ON "SignatureEnvelope"("deletedAt");
