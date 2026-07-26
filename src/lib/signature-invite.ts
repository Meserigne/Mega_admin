import { randomBytes } from "crypto";
import { prisma } from "@/lib/prisma";
import {
  sendSignatureInviteEmail,
  signUrlForToken,
} from "@/lib/signature-mail";
import type { SendMailResult } from "@/lib/mail";

function newAccessToken() {
  return randomBytes(32).toString("hex");
}

export type InviteLink = { id: string; email: string; nom: string; url: string };

export type InviteSendResult = {
  links: InviteLink[];
  results: { email: string; mail: SendMailResult }[];
  allOk: boolean;
};

async function ensureToken(destId: string, existing: string | null) {
  if (existing) return existing;
  const token = newAccessToken();
  await prisma.signatureDestinataire.update({
    where: { id: destId },
    data: { accessToken: token },
  });
  return token;
}

/** Envoie les e-mails d’invitation et marque inviteSentAt si succès. */
export async function sendInviteEmailsToDestinataires(
  envelopeId: string,
  destinataireIds: string[]
): Promise<InviteSendResult> {
  if (destinataireIds.length === 0) {
    return { links: [], results: [], allOk: true };
  }

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: true },
  });
  if (!envelope) {
    return { links: [], results: [], allOk: false };
  }

  const targets = envelope.destinataires.filter((d) =>
    destinataireIds.includes(d.id)
  );
  const links: InviteLink[] = [];
  const results: { email: string; mail: SendMailResult }[] = [];

  for (const d of targets) {
    const token = await ensureToken(d.id, d.accessToken);
    const url = signUrlForToken(token);
    links.push({ id: d.id, email: d.email, nom: d.nom, url });

    console.info("[signature-invite] sending", {
      envelopeId,
      to: d.email,
      destId: d.id,
    });

    const mail = await sendSignatureInviteEmail({
      to: d.email,
      destinataireNom: d.nom,
      createurNom: envelope.createurNom,
      documentTitle: envelope.titre,
      message: envelope.message,
      accessToken: token,
    });

    results.push({ email: d.email, mail });

    if (mail.ok) {
      await prisma.signatureDestinataire.update({
        where: { id: d.id },
        data: { inviteSentAt: new Date() },
      });
      console.info("[signature-invite] ok", d.email, mail.mode, mail.messageId);
    } else {
      console.error(
        "[signature-invite] FAILED",
        d.email,
        mail.mode,
        mail.error
      );
    }
  }

  return {
    links,
    results,
    allOk: results.length > 0 && results.every((r) => r.mail.ok),
  };
}

/**
 * Rattrapage : envoie le mail à tout destinataire « À signer »
 * qui n’a pas encore reçu d’invitation pour ce tour.
 */
export async function ensurePendingInvites(
  envelopeId: string
): Promise<InviteSendResult> {
  const pending = await prisma.signatureDestinataire.findMany({
    where: {
      envelopeId,
      statut: "A_SIGNER",
      inviteSentAt: null,
      role: { in: ["SIGNATAIRE", "INITIATEUR"] },
    },
    select: { id: true },
  });
  if (pending.length === 0) {
    return { links: [], results: [], allOk: true };
  }
  return sendInviteEmailsToDestinataires(
    envelopeId,
    pending.map((d) => d.id)
  );
}
