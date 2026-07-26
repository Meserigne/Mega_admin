-- Cache du PDF certifié (signatures + audit + verrouillage)
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneNom" TEXT;
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneChemin" TEXT;
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneContenu" BYTEA;
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneTaille" INTEGER;
ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneAt" TIMESTAMP(3);
