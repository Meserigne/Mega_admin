import {
  deleteArchiveFile,
  isDbArchivePath,
  readArchiveBytes,
  saveArchiveBytes,
} from "@/lib/archive-storage";
import { signatureContactEmail } from "@/lib/mail";
import {
  buildSignedPdf,
  type SignatureAuditReport,
  type StampAnnotation,
} from "@/lib/signature-flatten";
import { ENVELOPE_STATUT_LABELS, type EnvelopeStatut } from "@/lib/signature-docs";
import { prisma } from "@/lib/prisma";

type ChampLike = {
  type: string;
  valeur: string | null;
  posX: number;
  posY: number;
  largeur: number;
  hauteur: number;
  page: number;
  destinataireId: string | null;
};

type DestLike = {
  id: string;
  signatureImage: string | null;
};

function isStampChampType(type: string) {
  const t = type.toUpperCase();
  return (
    t === "SIGNATURE" ||
    t === "BLOC_SIGNATURE" ||
    t === "PARAPHE" ||
    t === "INITIALES"
  );
}

/** Valeur affichable : champ rempli, sinon image du destinataire pour signature/paraphe. */
export function resolveChampValeur(
  champ: ChampLike,
  destById: Map<string, DestLike>
): string | null {
  const v = champ.valeur?.trim();
  if (v) return v;
  if (!champ.destinataireId) return null;
  const dest = destById.get(champ.destinataireId);
  if (!dest) return null;
  const t = champ.type.toUpperCase();
  if (isStampChampType(t) && dest.signatureImage) {
    return dest.signatureImage;
  }
  return null;
}

export function buildAnnotationsFromEnvelope(
  champs: ChampLike[],
  destinataires: DestLike[]
): StampAnnotation[] {
  const destById = new Map(destinataires.map((d) => [d.id, d]));
  return champs.map((c) => ({
    type: c.type,
    valeur: resolveChampValeur(c, destById),
    posX: c.posX,
    posY: c.posY,
    largeur: c.largeur,
    hauteur: c.hauteur,
    page: c.page,
  }));
}

function buildAuditReport(envelope: {
  id: string;
  titre: string;
  statut: string;
  createurNom: string;
  createdAt: Date;
  envoyeAt: Date | null;
  completeAt: Date | null;
  destinataires: {
    nom: string;
    email: string;
    role: string;
    statut: string;
    signeAt: Date | null;
    createdAt: Date;
  }[];
}): SignatureAuditReport {
  const contact = signatureContactEmail();
  const events: SignatureAuditReport["events"] = [
    {
      at: envelope.createdAt,
      title: "Document créé",
      detail: `Par ${envelope.createurNom} (${contact})`,
    },
  ];

  const signers = envelope.destinataires.filter((d) => d.role === "SIGNATAIRE");
  const emailedAt = envelope.envoyeAt ?? envelope.createdAt;
  for (const d of signers) {
    events.push({
      at: emailedAt,
      title: "Document envoyé par e-mail pour signature",
      detail: `À ${d.nom} (${d.email})`,
    });
  }

  for (const d of envelope.destinataires) {
    if (d.statut === "SIGNE" && d.signeAt) {
      events.push({
        at: d.signeAt,
        title: "Document signé électroniquement",
        detail: `Par ${d.nom} (${d.email}) — Source horaire : serveur MEGA — Apparence : signature électronique`,
      });
    }
    if (d.statut === "REFUSE" && d.signeAt) {
      events.push({
        at: d.signeAt,
        title: "Document refusé",
        detail: `Par ${d.nom} (${d.email})`,
      });
    }
  }

  const allSignersDone =
    signers.length > 0 && signers.every((d) => d.statut === "SIGNE");
  if (
    (envelope.statut === "COMPLETE" || allSignersDone) &&
    (envelope.completeAt || allSignersDone)
  ) {
    events.push({
      at: envelope.completeAt || new Date(),
      title: "Accord terminé",
      detail: "Document certifié et verrouillé par MEGA Signature.",
    });
  }

  const statusLabel =
    ENVELOPE_STATUT_LABELS[envelope.statut as EnvelopeStatut] ??
    envelope.statut;

  return {
    documentTitle: envelope.titre,
    createdAt: envelope.createdAt,
    createdBy: `${envelope.createurNom} (${contact})`,
    status:
      envelope.statut === "COMPLETE"
        ? "Signé / Certifié"
        : statusLabel,
    transactionId: envelope.id,
    events,
  };
}

async function readCachedSignedPdf(envelopeId: string): Promise<{
  bytes: Uint8Array;
  fileName: string;
} | null> {
  const meta = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    select: {
      statut: true,
      fichierSigneChemin: true,
      fichierSigneNom: true,
      fichierSigneAt: true,
    },
  });
  if (!meta || meta.statut !== "COMPLETE") return null;
  if (!meta.fichierSigneChemin || !meta.fichierSigneAt) return null;

  try {
    let contenu: Uint8Array | null = null;
    if (isDbArchivePath(meta.fichierSigneChemin)) {
      const row = await prisma.signatureEnvelope.findUnique({
        where: { id: envelopeId },
        select: { fichierSigneContenu: true },
      });
      contenu = row?.fichierSigneContenu ?? null;
    }
    const bytes = await readArchiveBytes(meta.fichierSigneChemin, contenu);
    if (!bytes.length) return null;
    return {
      bytes,
      fileName: meta.fichierSigneNom || "document-signe.pdf",
    };
  } catch (e) {
    console.warn("[signature-pdf] cache signed PDF unreadable", e);
    return null;
  }
}

async function persistSignedPdfCache(
  envelopeId: string,
  pdf: { bytes: Uint8Array; fileName: string },
  previousChemin: string | null
): Promise<void> {
  try {
    const saved = await saveArchiveBytes(pdf.bytes, {
      subdir: `signatures/signed/${envelopeId}`,
      fileName: pdf.fileName,
      mimeType: "application/pdf",
    });
    await prisma.signatureEnvelope.update({
      where: { id: envelopeId },
      data: {
        fichierSigneNom: pdf.fileName,
        fichierSigneChemin: saved.cheminStockage,
        fichierSigneContenu: saved.contenu
          ? Buffer.from(saved.contenu)
          : null,
        fichierSigneTaille: saved.tailleOctets,
        fichierSigneAt: new Date(),
      },
    });
    if (
      previousChemin &&
      previousChemin !== saved.cheminStockage &&
      !isDbArchivePath(previousChemin)
    ) {
      await deleteArchiveFile(previousChemin).catch(() => null);
    }
  } catch (e) {
    console.error("[signature-pdf] persist signed cache failed", e);
  }
}

export async function buildSignedPdfForEnvelope(
  envelopeId: string
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
  const cached = await readCachedSignedPdf(envelopeId);
  if (cached) return cached;

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: {
      champs: { orderBy: { createdAt: "asc" } },
      destinataires: { orderBy: { ordre: "asc" } },
    },
  });
  if (!envelope) return null;

  if (
    (!envelope.fichierContenu || envelope.fichierContenu.length === 0) &&
    isDbArchivePath(envelope.fichierChemin)
  ) {
    return null;
  }

  const body = await readArchiveBytes(
    envelope.fichierChemin,
    envelope.fichierContenu
  );

  const signers = envelope.destinataires.filter((d) => d.role === "SIGNATAIRE");
  const allSignersDone =
    signers.length > 0 && signers.every((d) => d.statut === "SIGNE");
  const anySigned = envelope.destinataires.some((d) => d.statut === "SIGNE");

  // Répare les enveloppes restées « en cours » alors que tous les signataires ont signé
  let envelopeForAudit = envelope;
  if (allSignersDone && envelope.statut !== "COMPLETE") {
    const completeAt = new Date();
    const initiateur = envelope.destinataires.find((d) => d.role === "INITIATEUR");
    if (initiateur && initiateur.statut !== "SIGNE") {
      await prisma.signatureDestinataire.update({
        where: { id: initiateur.id },
        data: { statut: "SIGNE", signeAt: completeAt, motifRefus: null },
      });
    }
    envelopeForAudit = await prisma.signatureEnvelope.update({
      where: { id: envelope.id },
      data: { statut: "COMPLETE", completeAt },
      include: {
        champs: { orderBy: { createdAt: "asc" } },
        destinataires: { orderBy: { ordre: "asc" } },
      },
    });
  }

  const isComplete =
    envelopeForAudit.statut === "COMPLETE" || allSignersDone;
  const audit =
    anySigned || isComplete ? buildAuditReport(envelopeForAudit) : null;

  // Assurer que chaque champ tampon a une image (fallback signatureImage)
  for (const c of envelopeForAudit.champs) {
    if ((c.valeur || "").trim()) continue;
    if (!isStampChampType(c.type) || !c.destinataireId) continue;
    const dest = envelopeForAudit.destinataires.find(
      (d) => d.id === c.destinataireId
    );
    if (!dest?.signatureImage) continue;
    await prisma.signatureChamp.update({
      where: { id: c.id },
      data: { valeur: dest.signatureImage },
    });
    c.valeur = dest.signatureImage;
  }

  const built = await buildSignedPdf({
    fileBytes: new Uint8Array(body),
    fileMime: envelopeForAudit.fichierMime ?? "application/octet-stream",
    fileName: envelopeForAudit.fichierNom,
    annotations: buildAnnotationsFromEnvelope(
      envelopeForAudit.champs,
      envelopeForAudit.destinataires
    ),
    audit,
    lock: isComplete,
  });

  if (isComplete) {
    await persistSignedPdfCache(
      envelope.id,
      built,
      envelope.fichierSigneChemin
    );
  }

  return built;
}
