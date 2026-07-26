-- Synchro Cash journal ↔ petite caisse
ALTER TABLE "OperationCaisse" ADD COLUMN IF NOT EXISTS "operationId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "OperationCaisse_operationId_key" ON "OperationCaisse"("operationId");

CREATE INDEX IF NOT EXISTS "Operation_modePaiement_idx" ON "Operation"("modePaiement");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'OperationCaisse_operationId_fkey'
  ) THEN
    ALTER TABLE "OperationCaisse"
      ADD CONSTRAINT "OperationCaisse_operationId_fkey"
      FOREIGN KEY ("operationId") REFERENCES "Operation"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
