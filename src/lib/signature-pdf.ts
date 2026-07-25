import { readArchiveBytes, isDbArchivePath } from "@/lib/archive-storage";
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

/** Valeur affichable : champ rempli, sinon image du destinataire pour signature/paraphe. */
export function resolveChampValeur(
  champ: ChampLike,
  destById: Map<string, DestLike>
): string | null {
  const v = champ.valeur?.trim();
  if (v) return v;
  if (!champ.destinataireId) return null;
  const dest = destById.get(champ.destinataireId);
  if (!dest?.signatureImage) return null;
  const t = champ.type.toUpperCase();
  if (t === "SIGNATURE" || t === "PARAPHE" || t === "INITIALES") {
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

  if (envelope.statut === "COMPLETE" && envelope.completeAt) {
    events.push({
      at: envelope.completeAt,
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

export async function buildSignedPdfForEnvelope(
  envelopeId: string
): Promise<{ bytes: Uint8Array; fileName: string } | null> {
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

  const isComplete = envelope.statut === "COMPLETE";
  const audit = isComplete ? buildAuditReport(envelope) : null;

  return buildSignedPdf({
    fileBytes: new Uint8Array(body),
    fileMime: envelope.fichierMime ?? "application/octet-stream",
    fileName: envelope.fichierNom,
    annotations: buildAnnotationsFromEnvelope(
      envelope.champs,
      envelope.destinataires
    ),
    audit,
    lock: isComplete,
  });
}
