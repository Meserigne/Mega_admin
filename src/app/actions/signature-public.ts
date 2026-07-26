"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { waitUntil } from "@vercel/functions";
import { prisma } from "@/lib/prisma";
import { signatureContactEmail } from "@/lib/mail";
import {
  appBaseUrl,
  sendSignatureCompletedEmail,
  signUrlForToken,
} from "@/lib/signature-mail";
import { ensureSignatureSchema } from "@/lib/db-ensure";
import {
  ensurePendingInvites,
  sendInviteEmailsToDestinataires,
} from "@/lib/signature-invite";
import { buildSignedPdfForEnvelope } from "@/lib/signature-pdf";

export type PublicSignSession = {
  token: string;
  envelopeId: string;
  titre: string;
  objet: string | null;
  message: string | null;
  fichierNom: string;
  fichierMime: string | null;
  createurNom: string;
  createurEmail: string | null;
  destinataire: {
    id: string;
    nom: string;
    email: string;
    role: string;
    statut: string;
  };
  canSign: boolean;
  alreadySigned: boolean;
  refused: boolean;
  completed: boolean;
  documentUrl: string;
  signedPdfUrl: string;
  champs: {
    id: string;
    type: string;
    page: number;
    posX: number;
    posY: number;
    largeur: number;
    hauteur: number;
    valeur: string | null;
    mine: boolean;
  }[];
};

async function sendCompletedEmails(envelopeId: string) {
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: true },
  });
  if (!envelope || envelope.statut !== "COMPLETE") return;

  let pdf: { bytes: Uint8Array; fileName: string } | null = null;
  try {
    pdf = await buildSignedPdfForEnvelope(envelopeId);
  } catch (e) {
    console.error("[sendCompletedEmails] build PDF", e);
  }
  const to = [
    ...new Set(envelope.destinataires.map((d) => d.email.toLowerCase())),
  ];
  const viewUrl = `${appBaseUrl()}/sign/${envelope.destinataires[0]?.accessToken ?? ""}`;

  await sendSignatureCompletedEmail({
    to,
    documentTitle: envelope.titre,
    parties: envelope.destinataires.map((d) => d.nom),
    pdfBytes: pdf?.bytes ?? new Uint8Array(),
    pdfFileName: pdf?.fileName ?? "document-signe.pdf",
    viewUrl,
  });
}

async function activateNextSigners(
  envelopeId: string
): Promise<{ completed: boolean; newlyReadyIds: string[] }> {
  await ensureSignatureSchema();
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: { orderBy: { ordre: "asc" } } },
  });
  if (!envelope || envelope.statut !== "EN_COURS") {
    return { completed: false, newlyReadyIds: [] };
  }

  const actors = envelope.destinataires.filter(
    (d) => d.role === "SIGNATAIRE" || d.role === "INITIATEUR"
  );
  const signers = actors.filter((d) => d.role === "SIGNATAIRE");
  const initiateur = actors.find((d) => d.role === "INITIATEUR");

  // Complet dès que tous les SIGNATAIRES ont signé (l'initiateur n'bloque plus)
  const signersDone =
    signers.length > 0 && signers.every((d) => d.statut === "SIGNE");
  if (signersDone || actors.every((d) => d.statut === "SIGNE")) {
    if (initiateur && initiateur.statut !== "SIGNE") {
      await prisma.signatureDestinataire.update({
        where: { id: initiateur.id },
        data: {
          statut: "SIGNE",
          signeAt: new Date(),
          motifRefus: null,
        },
      });
    }
    await prisma.signatureEnvelope.update({
      where: { id: envelopeId },
      data: { statut: "COMPLETE", completeAt: new Date() },
    });
    return { completed: true, newlyReadyIds: [] };
  }

  const stillOpen = actors.filter(
    (d) => d.statut !== "SIGNE" && d.statut !== "REFUSE"
  );

  await prisma.signatureDestinataire.updateMany({
    where: {
      id: { in: stillOpen.map((d) => d.id) },
      statut: "A_SIGNER",
    },
    data: { statut: "EN_ATTENTE" },
  });

  const newlyReadyIds: string[] = [];

  if (envelope.ordreObligatoire) {
    const nextSigner = stillOpen.find((d) => d.role === "SIGNATAIRE");
    const next = nextSigner || stillOpen[0];
    if (next) {
      await prisma.signatureDestinataire.update({
        where: { id: next.id },
        data: { statut: "A_SIGNER", inviteSentAt: null },
      });
      newlyReadyIds.push(next.id);
    }
    return { completed: false, newlyReadyIds };
  }

  const unsignedSigners = signers.filter(
    (d) => d.statut !== "SIGNE" && d.statut !== "REFUSE"
  );
  if (unsignedSigners.length > 0) {
    await prisma.signatureDestinataire.updateMany({
      where: { id: { in: unsignedSigners.map((d) => d.id) } },
      data: { statut: "A_SIGNER", inviteSentAt: null },
    });
    newlyReadyIds.push(...unsignedSigners.map((d) => d.id));
  }
  return { completed: false, newlyReadyIds };
}

export async function getPublicSignSession(
  token: string
): Promise<PublicSignSession | null> {
  const t = token.trim();
  if (!t || t.length < 16) return null;

  const dest = await prisma.signatureDestinataire.findUnique({
    where: { accessToken: t },
    include: {
      envelope: {
        include: {
          champs: { orderBy: { createdAt: "asc" } },
        },
      },
    },
  });
  if (!dest) return null;

  const envelope = dest.envelope;
  if (envelope.deletedAt) return null;

  const canSign =
    envelope.statut === "EN_COURS" && dest.statut === "A_SIGNER";

  return {
    token: t,
    envelopeId: envelope.id,
    titre: envelope.titre,
    objet: envelope.objet,
    message: envelope.message,
    fichierNom: envelope.fichierNom,
    fichierMime: envelope.fichierMime,
    createurNom: envelope.createurNom,
    createurEmail: signatureContactEmail(),
    destinataire: {
      id: dest.id,
      nom: dest.nom,
      email: dest.email,
      role: dest.role,
      statut: dest.statut,
    },
    canSign,
    alreadySigned: dest.statut === "SIGNE",
    refused: dest.statut === "REFUSE" || envelope.statut === "REFUSE",
    completed: envelope.statut === "COMPLETE",
    documentUrl: `/api/signatures/public/${t}`,
    signedPdfUrl: `/api/signatures/public/${t}?signed=1`,
    champs: envelope.champs.map((c) => ({
      id: c.id,
      type: c.type,
      page: c.page,
      posX: c.posX,
      posY: c.posY,
      largeur: c.largeur,
      hauteur: c.hauteur,
      valeur: c.valeur,
      mine: c.destinataireId === dest.id,
    })),
  };
}

export async function submitPublicSignature(
  token: string,
  fieldValues: Record<string, string>,
  primarySignature?: string | null
): Promise<{ ok: true } | { ok: false; error: string }> {
  const session = await getPublicSignSession(token);
  if (!session) return { ok: false, error: "Lien invalide ou expiré." };
  if (!session.canSign) {
    return {
      ok: false,
      error: session.alreadySigned
        ? "Vous avez déjà signé ce document."
        : "Ce n'est pas votre tour de signer.",
    };
  }

  const myFields = session.champs.filter((c) => c.mine);
  const required = myFields.filter((c) => {
    const t = c.type.toUpperCase();
    return (
      t === "SIGNATURE" ||
      t === "BLOC_SIGNATURE" ||
      t === "PARAPHE" ||
      t === "INITIALES" ||
      t === "TEXTE" ||
      t === "DATE"
    );
  });

  for (const f of required) {
    const v = (fieldValues[f.id] || f.valeur || "").trim();
    if (!v) {
      return {
        ok: false,
        error: `Champ requis manquant (${f.type}).`,
      };
    }
  }

  const sig =
    primarySignature?.startsWith("data:image/")
      ? primarySignature
      : Object.values(fieldValues).find((v) => v.startsWith("data:image/")) ||
        null;

  for (const f of myFields) {
    const valeur = (fieldValues[f.id] || "").trim() || null;
    if (!valeur) continue;
    await prisma.signatureChamp.update({
      where: { id: f.id },
      data: { valeur },
    });
  }

  // Remplit les tampons vides du destinataire avec la signature principale
  if (sig) {
    const stampTypes = new Set([
      "SIGNATURE",
      "BLOC_SIGNATURE",
      "PARAPHE",
      "INITIALES",
    ]);
    for (const f of myFields) {
      const t = f.type.toUpperCase();
      if (!stampTypes.has(t)) continue;
      const existing = (fieldValues[f.id] || f.valeur || "").trim();
      if (existing) continue;
      await prisma.signatureChamp.update({
        where: { id: f.id },
        data: { valeur: sig },
      });
    }
  }

  // Date auto si champ DATE vide
  const today = new Date().toLocaleDateString("fr-FR");
  for (const f of myFields) {
    if (f.type.toUpperCase() !== "DATE") continue;
    const existing = (fieldValues[f.id] || f.valeur || "").trim();
    if (existing) continue;
    await prisma.signatureChamp.update({
      where: { id: f.id },
      data: { valeur: today },
    });
  }

  await prisma.signatureDestinataire.update({
    where: { id: session.destinataire.id },
    data: {
      statut: "SIGNE",
      signatureImage: sig,
      signeAt: new Date(),
      motifRefus: null,
    },
  });

  const progress = await activateNextSigners(session.envelopeId);

  revalidatePath(`/sign/${token}`);
  revalidatePath(`/signatures/${session.envelopeId}`);

  const envelopeId = session.envelopeId;

  // Invitation suivante : await + waitUntil (filet de sécurité Vercel)
  if (progress.newlyReadyIds.length > 0) {
    const ids = progress.newlyReadyIds;
    try {
      const invited = await sendInviteEmailsToDestinataires(envelopeId, ids);
      if (!invited.allOk) {
        console.error(
          "[submitPublicSignature] invite incomplete",
          invited.results.map((r) => [r.email, r.mail.error])
        );
        // Relance en arrière-plan si SMTP a échoué / timeout partiel
        waitUntil(
          ensurePendingInvites(envelopeId).catch((e) =>
            console.error("[submitPublicSignature] ensurePending", e)
          )
        );
      }
    } catch (e) {
      console.error("[submitPublicSignature] invite mail", e);
      waitUntil(
        ensurePendingInvites(envelopeId).catch((err) =>
          console.error("[submitPublicSignature] ensurePending", err)
        )
      );
    }
  }

  if (progress.completed) {
    after(async () => {
      try {
        await sendCompletedEmails(envelopeId);
      } catch (e) {
        console.error("[submitPublicSignature] completed mail/pdf", e);
      }
    });
  }

  return { ok: true };
}

/** Appelé depuis la page merci pour rattraper un mail non parti. */
export async function ensureInviteAfterPublicSign(
  token: string
): Promise<{ ok: true; sent: number } | { ok: false; error: string }> {
  const t = token.trim();
  if (!t || t.length < 16) return { ok: false, error: "Lien invalide." };

  const dest = await prisma.signatureDestinataire.findUnique({
    where: { accessToken: t },
    select: {
      statut: true,
      envelopeId: true,
      envelope: { select: { statut: true, deletedAt: true } },
    },
  });
  if (!dest || dest.envelope.deletedAt) {
    return { ok: false, error: "Document introuvable." };
  }
  if (dest.statut !== "SIGNE") {
    return { ok: true, sent: 0 };
  }
  if (dest.envelope.statut !== "EN_COURS") {
    return { ok: true, sent: 0 };
  }

  const invited = await ensurePendingInvites(dest.envelopeId);
  return { ok: true, sent: invited.results.filter((r) => r.mail.ok).length };
}

export async function refusePublicSignature(
  token: string,
  motif: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const motifTrim = motif.trim();
  if (!motifTrim) return { ok: false, error: "Motif de refus obligatoire." };

  const session = await getPublicSignSession(token);
  if (!session) return { ok: false, error: "Lien invalide ou expiré." };
  if (!session.canSign) {
    return { ok: false, error: "Vous ne pouvez pas refuser maintenant." };
  }

  await prisma.signatureDestinataire.update({
    where: { id: session.destinataire.id },
    data: {
      statut: "REFUSE",
      motifRefus: motifTrim,
      signeAt: new Date(),
    },
  });
  await prisma.signatureEnvelope.update({
    where: { id: session.envelopeId },
    data: { statut: "REFUSE" },
  });

  revalidatePath(`/sign/${token}`);
  return { ok: true };
}

export { signUrlForToken };
