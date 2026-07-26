-- Suivi d'envoi des invitations (évite les relances en double, permet rattrapage)
ALTER TABLE "SignatureDestinataire" ADD COLUMN IF NOT EXISTS "inviteSentAt" TIMESTAMP(3);
