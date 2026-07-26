import { prisma } from "@/lib/prisma";

let ensured = false;
let ensurePromise: Promise<void> | null = null;

/**
 * Garantit les colonnes Signature récentes (migrate deploy parfois « no pending »
 * alors que le SQL n’a pas tourné). Idempotent.
 */
export async function ensureSignatureSchema(): Promise<void> {
  if (ensured) return;
  if (!ensurePromise) {
    ensurePromise = (async () => {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureDestinataire" ADD COLUMN IF NOT EXISTS "inviteSentAt" TIMESTAMP(3)`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneNom" TEXT`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneChemin" TEXT`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneContenu" BYTEA`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneTaille" INTEGER`
      );
      await prisma.$executeRawUnsafe(
        `ALTER TABLE "SignatureEnvelope" ADD COLUMN IF NOT EXISTS "fichierSigneAt" TIMESTAMP(3)`
      );
      ensured = true;
    })().catch((e) => {
      ensurePromise = null;
      console.error("[db-ensure] failed", e);
      throw e;
    });
  }
  await ensurePromise;
}
