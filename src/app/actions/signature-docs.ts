"use server";

import { randomBytes } from "crypto";
import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { deleteArchiveFile, saveArchiveFile } from "@/lib/archive-storage";
import { guardAuth, guardWrite, isGuardError } from "@/lib/auth-guard";
import { prisma } from "@/lib/prisma";
import {
  DEST_STATUT_LABELS,
  ENVELOPE_STATUT_LABELS,
  isAllowedSignatureFile,
  SIGNATURE_TRASH_DAYS,
  type DestStatut,
  type EnvelopeStatut,
} from "@/lib/signature-docs";
import {
  appBaseUrl,
  isMailConfigured,
  sendSignatureCompletedEmail,
  sendSignatureInviteEmail,
  signUrlForToken,
} from "@/lib/signature-mail";
import { buildSignedPdfForEnvelope } from "@/lib/signature-pdf";
import { verifyMailTransport, type SendMailResult } from "@/lib/mail";

const PATHS = [
  "/signatures",
  "/signatures/nouveau",
  "/signatures/editer",
  "/profil",
];

function revalidateSignatureApp() {
  for (const p of PATHS) revalidatePath(p);
  revalidatePath("/signatures", "layout");
}

export type DestinataireInput = {
  email: string;
  nom: string;
};

export type EnvelopeListItem = {
  id: string;
  titre: string;
  statut: string;
  statutLabel: string;
  createurNom: string;
  fichierNom: string;
  destCount: number;
  signesCount: number;
  createdAt: string;
  envoyeAt: string | null;
  completeAt: string | null;
  role: "createur" | "signataire";
  monStatut: string | null;
  deletedAt?: string | null;
};

export type EnvelopeDetail = {
  id: string;
  titre: string;
  objet: string | null;
  message: string | null;
  statut: string;
  statutLabel: string;
  ordreObligatoire: boolean;
  rappelFrequence: string;
  createurNom: string;
  createurId: string | null;
  fichierNom: string;
  fichierMime: string | null;
  downloadHref: string;
  createdAt: string;
  envoyeAt: string | null;
  completeAt: string | null;
  destinataires: {
    id: string;
    ordre: number;
    email: string;
    nom: string;
    role: string;
    roleLabel: string;
    statut: string;
    statutLabel: string;
    signeAt: string | null;
    hasSignature: boolean;
    isMe: boolean;
    canSignNow: boolean;
  }[];
  annotations: {
    id: string;
    type: string;
    valeur: string | null;
    posX: number;
    posY: number;
    largeur: number;
    hauteur: number;
  }[];
  canCancel: boolean;
  canDelete: boolean;
};

function emailsMatch(a: string | null | undefined, b: string | null | undefined) {
  return Boolean(a && b && a.trim().toLowerCase() === b.trim().toLowerCase());
}

function newAccessToken() {
  return randomBytes(32).toString("hex");
}

async function ensureDestAccessToken(destId: string, existing: string | null) {
  if (existing) return existing;
  const token = newAccessToken();
  await prisma.signatureDestinataire.update({
    where: { id: destId },
    data: { accessToken: token },
  });
  return token;
}

async function sendInviteEmails(
  envelopeId: string,
  destinataireIds: string[]
): Promise<{
  links: { email: string; nom: string; url: string }[];
  mail: SendMailResult | null;
}> {
  if (destinataireIds.length === 0) return { links: [], mail: null };

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: true },
  });
  if (!envelope) return { links: [], mail: null };

  const creator = envelope.createurId
    ? await prisma.user.findUnique({
        where: { id: envelope.createurId },
        select: { email: true },
      })
    : null;

  const links: { email: string; nom: string; url: string }[] = [];
  const targets = envelope.destinataires.filter((d) =>
    destinataireIds.includes(d.id)
  );

  let lastMail: SendMailResult | null = null;
  for (const d of targets) {
    const token = await ensureDestAccessToken(d.id, d.accessToken);
    const url = signUrlForToken(token);
    links.push({ email: d.email, nom: d.nom, url });
    lastMail = await sendSignatureInviteEmail({
      to: d.email,
      destinataireNom: d.nom,
      createurNom: envelope.createurNom,
      createurEmail: creator?.email,
      documentTitle: envelope.titre,
      message: envelope.message,
      accessToken: token,
    });
  }
  return { links, mail: lastMail };
}

async function sendCompletedEmails(envelopeId: string) {
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: true },
  });
  if (!envelope || envelope.statut !== "COMPLETE") return;

  const pdf = await buildSignedPdfForEnvelope(envelopeId);
  if (!pdf) {
    console.error("[signature] PDF final indisponible", envelopeId);
    return;
  }

  const parties = envelope.destinataires.map((d) => d.nom);
  const emails = [
    ...new Set(envelope.destinataires.map((d) => d.email.toLowerCase())),
  ];

  await sendSignatureCompletedEmail({
    to: emails,
    documentTitle: envelope.titre,
    parties,
    pdfBytes: pdf.bytes,
    pdfFileName: pdf.fileName,
    viewUrl: `${appBaseUrl()}/signatures/${envelopeId}`,
  });
}

async function activateNextSigners(
  envelopeId: string
): Promise<{ completed: boolean; newlyReadyIds: string[] }> {
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: {
      destinataires: { orderBy: { ordre: "asc" } },
    },
  });
  if (!envelope || envelope.statut !== "EN_COURS") {
    return { completed: false, newlyReadyIds: [] };
  }

  const actors = envelope.destinataires.filter(
    (d) => d.role === "SIGNATAIRE" || d.role === "INITIATEUR"
  );
  const signers = actors.filter((d) => d.role === "SIGNATAIRE");
  const initiateur = actors.find((d) => d.role === "INITIATEUR");

  if (actors.every((d) => d.statut === "SIGNE")) {
    await prisma.signatureEnvelope.update({
      where: { id: envelopeId },
      data: { statut: "COMPLETE", completeAt: new Date() },
    });
    return { completed: true, newlyReadyIds: [] };
  }

  // Remettre à EN_ATTENTE tous les A_SIGNER non encore traités
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
    // Un seul à la fois, dans l'ordre (signataires puis initiateur)
    const next = stillOpen[0];
    if (next) {
      await prisma.signatureDestinataire.update({
        where: { id: next.id },
        data: { statut: "A_SIGNER" },
      });
      newlyReadyIds.push(next.id);
    }
    return { completed: false, newlyReadyIds };
  }

  // Parallèle : tous les signataires restants ; initiateur seulement après
  const unsignedSigners = signers.filter(
    (d) => d.statut !== "SIGNE" && d.statut !== "REFUSE"
  );
  if (unsignedSigners.length > 0) {
    await prisma.signatureDestinataire.updateMany({
      where: { id: { in: unsignedSigners.map((d) => d.id) } },
      data: { statut: "A_SIGNER" },
    });
    newlyReadyIds.push(...unsignedSigners.map((d) => d.id));
    return { completed: false, newlyReadyIds };
  }

  if (initiateur && initiateur.statut !== "SIGNE") {
    await prisma.signatureDestinataire.update({
      where: { id: initiateur.id },
      data: { statut: "A_SIGNER" },
    });
    newlyReadyIds.push(initiateur.id);
  }
  return { completed: false, newlyReadyIds };
}

function trashCutoffDate() {
  return new Date(Date.now() - SIGNATURE_TRASH_DAYS * 24 * 60 * 60 * 1000);
}

async function purgeExpiredTrash() {
  const expired = await prisma.signatureEnvelope.findMany({
    where: {
      deletedAt: { not: null, lt: trashCutoffDate() },
    },
    select: { id: true, fichierChemin: true, titre: true, createurId: true, createurNom: true },
    take: 40,
  });
  for (const e of expired) {
    try {
      await deleteArchiveFile(e.fichierChemin);
    } catch {
      /* ignore missing blob */
    }
    await prisma.signatureEnvelope.delete({ where: { id: e.id } }).catch(() => null);
    await logAudit({
      userId: e.createurId,
      userNom: e.createurNom || "Système",
      action: "PURGE",
      entity: "SignatureEnvelope",
      entityId: e.id,
      details: `Document signature purgé (corbeille > ${SIGNATURE_TRASH_DAYS} j) · ${e.titre}`,
    });
  }
}

function mapEnvelopeListItem(
  r: {
    id: string;
    titre: string;
    statut: string;
    createurNom: string;
    createurId: string | null;
    fichierNom: string;
    createdAt: Date;
    envoyeAt: Date | null;
    completeAt: Date | null;
    deletedAt?: Date | null;
    destinataires: {
      role: string;
      statut: string;
      userId: string | null;
      email: string;
    }[];
  },
  guardId: string,
  email: string
): EnvelopeListItem {
  const signers = r.destinataires.filter((d) => d.role === "SIGNATAIRE");
  const me = r.destinataires.find(
    (d) => d.userId === guardId || emailsMatch(d.email, email)
  );
  return {
    id: r.id,
    titre: r.titre,
    statut: r.statut,
    statutLabel: ENVELOPE_STATUT_LABELS[r.statut as EnvelopeStatut] ?? r.statut,
    createurNom: r.createurNom,
    fichierNom: r.fichierNom,
    destCount: signers.length,
    signesCount: signers.filter((d) => d.statut === "SIGNE").length,
    createdAt: r.createdAt.toISOString(),
    envoyeAt: r.envoyeAt?.toISOString() ?? null,
    completeAt: r.completeAt?.toISOString() ?? null,
    role: r.createurId === guardId ? "createur" : "signataire",
    monStatut: me?.statut ?? null,
    deletedAt: r.deletedAt?.toISOString() ?? null,
  };
}

export async function listMyEnvelopes(): Promise<EnvelopeListItem[]> {
  const guard = await guardAuth();
  if (isGuardError(guard)) return [];

  await purgeExpiredTrash().catch(() => null);

  const email = guard.email?.toLowerCase() ?? "";
  const rows = await prisma.signatureEnvelope.findMany({
    where: {
      deletedAt: null,
      OR: [
        { createurId: guard.id },
        ...(email
          ? [{ destinataires: { some: { email: { equals: email, mode: "insensitive" as const } } } }]
          : []),
        { destinataires: { some: { userId: guard.id } } },
      ],
    },
    include: {
      destinataires: true,
    },
    orderBy: { createdAt: "desc" },
    take: 80,
  });

  return rows.map((r) => mapEnvelopeListItem(r, guard.id, email));
}

/** Documents en corbeille (émetteur uniquement, < 30 jours). */
export async function listTrashedEnvelopes(): Promise<EnvelopeListItem[]> {
  const guard = await guardAuth();
  if (isGuardError(guard)) return [];

  await purgeExpiredTrash().catch(() => null);

  const email = guard.email?.toLowerCase() ?? "";
  const rows = await prisma.signatureEnvelope.findMany({
    where: {
      createurId: guard.id,
      deletedAt: { not: null, gte: trashCutoffDate() },
    },
    include: { destinataires: true },
    orderBy: { deletedAt: "desc" },
    take: 80,
  });

  return rows.map((r) => mapEnvelopeListItem(r, guard.id, email));
}

export async function getEnvelopeDetail(
  id: string
): Promise<EnvelopeDetail | null> {
  const guard = await guardAuth();
  if (isGuardError(guard)) return null;

  const email = guard.email?.toLowerCase() ?? "";
  const r = await prisma.signatureEnvelope.findUnique({
    where: { id },
    include: {
      destinataires: { orderBy: { ordre: "asc" } },
      champs: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!r || r.deletedAt) return null;

  const canSee =
    r.createurId === guard.id ||
    r.destinataires.some(
      (d) => d.userId === guard.id || emailsMatch(d.email, email)
    );
  if (!canSee) return null;

  return {
    id: r.id,
    titre: r.titre,
    objet: r.objet,
    message: r.message,
    statut: r.statut,
    statutLabel: ENVELOPE_STATUT_LABELS[r.statut as EnvelopeStatut] ?? r.statut,
    ordreObligatoire: r.ordreObligatoire,
    rappelFrequence: r.rappelFrequence,
    createurNom: r.createurNom,
    createurId: r.createurId,
    fichierNom: r.fichierNom,
    fichierMime: r.fichierMime,
    downloadHref: `/api/signatures/documents/${r.id}`,
    createdAt: r.createdAt.toISOString(),
    envoyeAt: r.envoyeAt?.toISOString() ?? null,
    completeAt: r.completeAt?.toISOString() ?? null,
    destinataires: r.destinataires.map((d) => {
      const isMe = d.userId === guard.id || emailsMatch(d.email, email);
      return {
        id: d.id,
        ordre: d.ordre,
        email: d.email,
        nom: d.nom,
        role: d.role,
        roleLabel:
          d.role === "INITIATEUR" ? "Initiateur (retour final)" : "Signataire",
        statut: d.statut,
        statutLabel: DEST_STATUT_LABELS[d.statut as DestStatut] ?? d.statut,
        signeAt: d.signeAt?.toISOString() ?? null,
        hasSignature: Boolean(d.signatureImage),
        isMe,
        canSignNow:
          isMe &&
          r.statut === "EN_COURS" &&
          (d.role === "SIGNATAIRE" || d.role === "INITIATEUR") &&
          d.statut === "A_SIGNER",
      };
    }),
    annotations: r.champs.map((c) => ({
      id: c.id,
      type: c.type,
      valeur: c.valeur,
      posX: c.posX,
      posY: c.posY,
      largeur: c.largeur,
      hauteur: c.hauteur,
    })),
    canCancel: r.createurId === guard.id && r.statut === "EN_COURS",
    canDelete: r.createurId === guard.id,
  };
}

/** Métadonnées légères pour précharger une demande sans re-télécharger le fichier. */
export async function getEnvelopeShareSource(id: string): Promise<
  | {
      ok: true;
      id: string;
      titre: string;
      fichierNom: string;
      fichierMime: string | null;
      downloadHref: string;
    }
  | { ok: false; error: string }
> {
  const guard = await guardAuth();
  if (isGuardError(guard)) return { ok: false, error: "Non authentifié." };

  const email = guard.email?.toLowerCase() ?? "";
  const r = await prisma.signatureEnvelope.findUnique({
    where: { id },
    select: {
      id: true,
      titre: true,
      fichierNom: true,
      fichierMime: true,
      createurId: true,
      deletedAt: true,
      destinataires: { select: { userId: true, email: true } },
    },
  });
  if (!r || r.deletedAt) return { ok: false, error: "Document introuvable." };

  const canSee =
    r.createurId === guard.id ||
    r.destinataires.some(
      (d) => d.userId === guard.id || emailsMatch(d.email, email)
    );
  if (!canSee) return { ok: false, error: "Accès refusé." };

  return {
    ok: true,
    id: r.id,
    titre: r.titre,
    fichierNom: r.fichierNom,
    fichierMime: r.fichierMime,
    downloadHref: `/api/signatures/documents/${r.id}`,
  };
}

export async function createAndSendEnvelope(input: {
  titre: string;
  objet?: string;
  message?: string;
  ordreObligatoire: boolean;
  rappelFrequence: string;
  destinataires: DestinataireInput[];
  /** Nouveau fichier (base64) — inutile si sourceEnvelopeId est fourni */
  fileBase64?: string;
  fileName?: string;
  fileMime?: string;
  /** Réutilise le fichier d'une enveloppe existante (rapide, sans re-upload) */
  sourceEnvelopeId?: string;
  champs?: {
    type: string;
    destinataireIndex: number;
    page?: number;
    posX: number;
    posY: number;
    largeur: number;
    hauteur: number;
  }[];
}): Promise<
  | {
      ok: true;
      id: string;
      inviteLinks: { email: string; nom: string; url: string }[];
      mailConfigured: boolean;
      mailDelivered: boolean;
      mailMode: string;
      mailError: string | null;
    }
  | { ok: false; error: string }
> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const titre = input.titre.trim();
  if (!titre) return { ok: false, error: "Indiquez un nom pour l'accord." };

  const dests = input.destinataires
    .map((d, i) => ({
      ordre: i + 1,
      email: d.email.trim().toLowerCase(),
      nom: d.nom.trim() || d.email.trim(),
    }))
    .filter((d) => d.email);

  if (dests.length === 0) {
    return { ok: false, error: "Ajoutez au moins un destinataire." };
  }

  for (const d of dests) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) {
      return { ok: false, error: `E-mail invalide : ${d.email}` };
    }
  }

  let fichierNom = input.fileName?.trim() || "";
  let fichierMime = input.fileMime || "application/octet-stream";
  let fichierChemin = "";
  let fichierContenu: Uint8Array | null = null;
  let fichierTaille = 0;

  if (input.sourceEnvelopeId) {
    const email = guard.email?.toLowerCase() ?? "";
    const source = await prisma.signatureEnvelope.findUnique({
      where: { id: input.sourceEnvelopeId },
      select: {
        id: true,
        createurId: true,
        deletedAt: true,
        fichierNom: true,
        fichierMime: true,
        fichierChemin: true,
        fichierContenu: true,
        fichierTaille: true,
        destinataires: { select: { userId: true, email: true } },
      },
    });
    if (!source || source.deletedAt) {
      return { ok: false, error: "Document source introuvable." };
    }
    const canSee =
      source.createurId === guard.id ||
      source.destinataires.some(
        (d) => d.userId === guard.id || emailsMatch(d.email, email)
      );
    if (!canSee) return { ok: false, error: "Accès refusé au document source." };

    fichierNom = source.fichierNom;
    fichierMime = source.fichierMime || "application/octet-stream";
    fichierChemin = source.fichierChemin;
    fichierContenu = source.fichierContenu
      ? new Uint8Array(source.fichierContenu)
      : null;
    fichierTaille = source.fichierTaille ?? 0;
  } else {
    if (!input.fileBase64 || !fichierNom) {
      return { ok: false, error: "Ajoutez un document (PDF, Word, image)." };
    }
    if (!isAllowedSignatureFile(fichierNom, fichierMime)) {
      return {
        ok: false,
        error: "Format non supporté. Utilisez PDF, Word (.doc/.docx) ou image.",
      };
    }

    const base64 = input.fileBase64.includes(",")
      ? input.fileBase64.split(",")[1]
      : input.fileBase64;
    let buffer: Buffer;
    try {
      buffer = Buffer.from(base64, "base64");
    } catch {
      return { ok: false, error: "Fichier illisible." };
    }
    if (buffer.length > 15 * 1024 * 1024) {
      return { ok: false, error: "Fichier trop volumineux (max 15 Mo)." };
    }

    const file = new File([new Uint8Array(buffer)], fichierNom, {
      type: fichierMime,
    });

    let saved;
    try {
      saved = await saveArchiveFile(file, "signatures");
    } catch (e) {
      return {
        ok: false,
        error:
          e instanceof Error ? e.message : "Échec enregistrement du fichier.",
      };
    }

    fichierMime = fichierMime || saved.mimeType;
    fichierChemin = saved.cheminStockage;
    fichierContenu = saved.contenu
      ? new Uint8Array(saved.contenu)
      : null;
    fichierTaille = saved.tailleOctets;
  }

  if (!isAllowedSignatureFile(fichierNom, fichierMime)) {
    return {
      ok: false,
      error: "Format non supporté. Utilisez PDF, Word (.doc/.docx) ou image.",
    };
  }

  const users = await prisma.user.findMany({
    where: {
      email: { in: dests.map((d) => d.email), mode: "insensitive" },
      actif: true,
    },
    select: { id: true, email: true, nom: true },
  });
  const byEmail = new Map(
    users
      .filter((u) => u.email)
      .map((u) => [u.email!.toLowerCase(), u] as const)
  );

  const now = new Date();
  // Parcours toujours séquentiel : signataires puis retour initiateur
  const sequential = true;
  const initiatorEmail =
    guard.email?.trim().toLowerCase() ||
    `${guard.identifiant}@mega.local`;

  const created = await prisma.signatureEnvelope.create({
    data: {
      titre,
      objet:
        input.objet?.trim() ||
        `Signature demandée sur « ${titre} »`,
      message:
        input.message?.trim() || "Veuillez vérifier et signer l'accord.",
      statut: "EN_COURS",
      ordreObligatoire: sequential,
      rappelFrequence: input.rappelFrequence || "HEBDO",
      createurId: guard.id,
      createurNom: guard.nom,
      fichierNom,
      fichierMime,
      fichierChemin,
      fichierContenu: fichierContenu
        ? Buffer.from(fichierContenu)
        : null,
      fichierTaille,
      envoyeAt: now,
      destinataires: {
        create: [
          ...dests.map((d, index) => {
            const user = byEmail.get(d.email);
            return {
              ordre: index + 1,
              email: d.email,
              nom: d.nom || user?.nom || d.email,
              role: "SIGNATAIRE",
              statut: index === 0 ? "A_SIGNER" : "EN_ATTENTE",
              userId: user?.id ?? null,
              accessToken: newAccessToken(),
            };
          }),
          {
            ordre: dests.length + 1,
            email: initiatorEmail,
            nom: guard.nom,
            role: "INITIATEUR",
            statut: "EN_ATTENTE",
            userId: guard.id,
            accessToken: newAccessToken(),
          },
        ],
      },
    },
    include: { destinataires: { orderBy: { ordre: "asc" } } },
  });

  const signersOnly = created.destinataires.filter(
    (d) => d.role === "SIGNATAIRE"
  );

  await prisma.signatureChamp.createMany({
    data:
      input.champs && input.champs.length > 0
        ? input.champs.map((c) => {
            const dest =
              signersOnly[
                Math.min(
                  Math.max(c.destinataireIndex, 0),
                  Math.max(signersOnly.length - 1, 0)
                )
              ];
            return {
              envelopeId: created.id,
              destinataireId: dest?.id ?? null,
              type: c.type,
              page: c.page ?? 1,
              posX: c.posX,
              posY: c.posY,
              largeur: c.largeur,
              hauteur: c.hauteur,
            };
          })
        : signersOnly.map((d, index) => ({
            envelopeId: created.id,
            destinataireId: d.id,
            type: "SIGNATURE",
            page: 1,
            posX: 0.1,
            posY: Math.max(0.2, 0.78 - index * 0.12),
            largeur: 0.28,
            hauteur: 0.08,
          })),
  });

  const firstReady = created.destinataires.filter((d) => d.statut === "A_SIGNER");
  const invited = await sendInviteEmails(
    created.id,
    firstReady.map((d) => d.id)
  );
  const transport = await verifyMailTransport();

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "CREATE",
    entity: "SignatureEnvelope",
    entityId: created.id,
    details: `${titre} · ${dests.length} signataire(s) + retour initiateur`,
  });

  revalidateSignatureApp();
  return {
    ok: true,
    id: created.id,
    inviteLinks: invited.links,
    mailConfigured: isMailConfigured(),
    mailDelivered: invited.mail?.mode === "smtp" || invited.mail?.mode === "resend",
    mailMode: invited.mail?.mode ?? "none",
    mailError:
      invited.mail?.error ||
      (!transport.ok ? transport.error ?? null : null),
  };
}

export async function signEnvelopeDocument(
  envelopeId: string,
  signatureImage: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  if (!signatureImage?.startsWith("data:image/")) {
    return { ok: false, error: "Signature invalide." };
  }

  const email = guard.email?.toLowerCase() ?? "";
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: { orderBy: { ordre: "asc" } } },
  });
  if (!envelope || envelope.statut !== "EN_COURS") {
    return { ok: false, error: "Document introuvable ou déjà clôturé." };
  }

  const me = envelope.destinataires.find(
    (d) =>
      (d.role === "SIGNATAIRE" || d.role === "INITIATEUR") &&
      (d.userId === guard.id || emailsMatch(d.email, email))
  );
  if (!me) {
    return { ok: false, error: "Vous n'êtes pas destinataire de ce document." };
  }
  if (me.statut !== "A_SIGNER") {
    return {
      ok: false,
      error: envelope.ordreObligatoire
        ? "Ce n'est pas encore votre tour de signer."
        : "Vous avez déjà traité ce document.",
    };
  }

  await prisma.signatureDestinataire.update({
    where: { id: me.id },
    data: {
      statut: "SIGNE",
      signatureImage,
      signeAt: new Date(),
      userId: guard.id,
      motifRefus: null,
    },
  });

  const myChamps = await prisma.signatureChamp.findMany({
    where: { destinataireId: me.id },
  });
  for (const c of myChamps) {
    if (c.valeur?.trim()) continue;
    const t = c.type.toUpperCase();
    if (t === "SIGNATURE" || t === "PARAPHE" || t === "INITIALES") {
      await prisma.signatureChamp.update({
        where: { id: c.id },
        data: { valeur: signatureImage },
      });
    }
  }

  const progress = await activateNextSigners(envelopeId);
  if (progress.newlyReadyIds.length > 0) {
    await sendInviteEmails(envelopeId, progress.newlyReadyIds);
  }
  if (progress.completed) {
    await sendCompletedEmails(envelopeId);
  }

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "UPDATE",
    entity: "SignatureEnvelope",
    entityId: envelopeId,
    details: `Signature · ${envelope.titre}`,
  });

  revalidateSignatureApp();
  revalidatePath(`/signatures/${envelopeId}`);
  return { ok: true };
}

export async function refuseEnvelopeDocument(
  envelopeId: string,
  motif: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const motifTrim = motif.trim();
  if (!motifTrim) return { ok: false, error: "Motif de refus obligatoire." };

  const email = guard.email?.toLowerCase() ?? "";
  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    include: { destinataires: true },
  });
  if (!envelope || envelope.statut !== "EN_COURS") {
    return { ok: false, error: "Document introuvable ou déjà clôturé." };
  }

  const me = envelope.destinataires.find(
    (d) => d.userId === guard.id || emailsMatch(d.email, email)
  );
  if (!me || me.statut !== "A_SIGNER") {
    return { ok: false, error: "Vous ne pouvez pas refuser ce document maintenant." };
  }

  await prisma.signatureDestinataire.update({
    where: { id: me.id },
    data: {
      statut: "REFUSE",
      motifRefus: motifTrim,
      signeAt: new Date(),
      userId: guard.id,
    },
  });
  await prisma.signatureEnvelope.update({
    where: { id: envelopeId },
    data: { statut: "REFUSE" },
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "UPDATE",
    entity: "SignatureEnvelope",
    entityId: envelopeId,
    details: `Refus · ${motifTrim}`,
  });

  revalidateSignatureApp();
  revalidatePath(`/signatures/${envelopeId}`);
  return { ok: true };
}

export async function cancelEnvelope(
  envelopeId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
  });
  if (!envelope) return { ok: false, error: "Document introuvable." };
  if (envelope.createurId !== guard.id) {
    return { ok: false, error: "Seul l'émetteur peut annuler." };
  }
  if (envelope.statut !== "EN_COURS" && envelope.statut !== "BROUILLON") {
    return { ok: false, error: "Ce document ne peut plus être annulé." };
  }

  await prisma.signatureEnvelope.update({
    where: { id: envelopeId },
    data: { statut: "ANNULE" },
  });

  revalidateSignatureApp();
  return { ok: true };
}

/** Met un document à la corbeille (émetteur uniquement, récupérable 30 j). */
export async function deleteEnvelope(
  envelopeId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    select: { id: true, createurId: true, titre: true, deletedAt: true },
  });
  if (!envelope || envelope.deletedAt) {
    return { ok: false, error: "Document introuvable." };
  }
  if (envelope.createurId !== guard.id) {
    return { ok: false, error: "Seul l'émetteur peut supprimer ce document." };
  }

  await prisma.signatureEnvelope.update({
    where: { id: envelopeId },
    data: { deletedAt: new Date() },
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "DELETE",
    entity: "SignatureEnvelope",
    entityId: envelopeId,
    details: `Document signature mis en corbeille · ${envelope.titre}`,
  });

  revalidateSignatureApp();
  return { ok: true };
}

/** Restaure un document depuis la corbeille. */
export async function restoreEnvelope(
  envelopeId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    select: { id: true, createurId: true, titre: true, deletedAt: true },
  });
  if (!envelope?.deletedAt) {
    return { ok: false, error: "Document introuvable en corbeille." };
  }
  if (envelope.createurId !== guard.id) {
    return { ok: false, error: "Seul l'émetteur peut restaurer ce document." };
  }
  if (envelope.deletedAt < trashCutoffDate()) {
    return {
      ok: false,
      error: `Ce document a dépassé ${SIGNATURE_TRASH_DAYS} jours en corbeille.`,
    };
  }

  await prisma.signatureEnvelope.update({
    where: { id: envelopeId },
    data: { deletedAt: null },
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "RESTORE",
    entity: "SignatureEnvelope",
    entityId: envelopeId,
    details: `Document signature restauré · ${envelope.titre}`,
  });

  revalidateSignatureApp();
  return { ok: true };
}

/** Suppression définitive depuis la corbeille. */
export async function purgeEnvelope(
  envelopeId: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id: envelopeId },
    select: {
      id: true,
      createurId: true,
      titre: true,
      deletedAt: true,
      fichierChemin: true,
    },
  });
  if (!envelope?.deletedAt) {
    return { ok: false, error: "Document introuvable en corbeille." };
  }
  if (envelope.createurId !== guard.id) {
    return { ok: false, error: "Seul l'émetteur peut supprimer définitivement." };
  }

  try {
    await deleteArchiveFile(envelope.fichierChemin);
  } catch {
    /* ignore */
  }

  await prisma.signatureEnvelope.delete({
    where: { id: envelopeId },
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "PURGE",
    entity: "SignatureEnvelope",
    entityId: envelopeId,
    details: `Document signature supprimé définitivement · ${envelope.titre}`,
  });

  revalidateSignatureApp();
  return { ok: true };
}

export type SelfSignAnnotation = {
  type: "SIGNATURE" | "PARAPHE" | "DATE" | "TEXTE" | "COCHE" | "IMAGE";
  valeur: string;
  page?: number;
  posX: number;
  posY: number;
  largeur: number;
  hauteur: number;
};

/** Remplir et signer soi-même → copie certifiée (pas un flux CEO). */
export async function saveSelfSignedDocument(input: {
  titre: string;
  fileBase64: string;
  fileName: string;
  fileMime: string;
  annotations: SelfSignAnnotation[];
  signatureImage?: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const titre = input.titre.trim() || input.fileName.replace(/\.[^.]+$/, "");
  if (!input.fileBase64 || !input.fileName) {
    return { ok: false, error: "Ajoutez un document." };
  }
  if (!isAllowedSignatureFile(input.fileName, input.fileMime)) {
    return {
      ok: false,
      error: "Format non supporté. Utilisez PDF, Word ou image.",
    };
  }
  if (!input.annotations.length) {
    return {
      ok: false,
      error: "Ajoutez au moins une signature, un paraphe, une date ou du texte.",
    };
  }

  const base64 = input.fileBase64.includes(",")
    ? input.fileBase64.split(",")[1]
    : input.fileBase64;
  let buffer: Buffer;
  try {
    buffer = Buffer.from(base64, "base64");
  } catch {
    return { ok: false, error: "Fichier illisible." };
  }
  if (buffer.length > 15 * 1024 * 1024) {
    return { ok: false, error: "Fichier trop volumineux (max 15 Mo)." };
  }

  const file = new File([new Uint8Array(buffer)], input.fileName, {
    type: input.fileMime || "application/octet-stream",
  });

  let saved;
  try {
    saved = await saveArchiveFile(file, "signatures");
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Échec enregistrement du fichier.",
    };
  }

  const now = new Date();
  const email =
    guard.email?.trim().toLowerCase() ||
    `${guard.identifiant}@mega.local`;

  const created = await prisma.signatureEnvelope.create({
    data: {
      titre,
      objet: `Copie certifiée · ${titre}`,
      message: "Document rempli et signé par l'émetteur.",
      statut: "COMPLETE",
      ordreObligatoire: false,
      rappelFrequence: "AUCUN",
      createurId: guard.id,
      createurNom: guard.nom,
      fichierNom: input.fileName,
      fichierMime: input.fileMime || saved.mimeType,
      fichierChemin: saved.cheminStockage,
      fichierContenu: saved.contenu ? Buffer.from(saved.contenu) : null,
      fichierTaille: saved.tailleOctets,
      envoyeAt: now,
      completeAt: now,
      destinataires: {
        create: {
          ordre: 1,
          email,
          nom: guard.nom,
          role: "SIGNATAIRE",
          statut: "SIGNE",
          userId: guard.id,
          signatureImage: input.signatureImage ?? null,
          signeAt: now,
        },
      },
    },
    include: { destinataires: true },
  });

  const destId = created.destinataires[0]?.id;
  await prisma.signatureChamp.createMany({
    data: input.annotations.map((a) => ({
      envelopeId: created.id,
      destinataireId: destId,
      type: a.type,
      page: a.page ?? 1,
      posX: a.posX,
      posY: a.posY,
      largeur: a.largeur,
      hauteur: a.hauteur,
      valeur: a.valeur,
    })),
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "CREATE",
    entity: "SignatureEnvelope",
    entityId: created.id,
    details: `Copie certifiée · ${titre} · ${input.annotations.length} annotation(s)`,
  });

  revalidateSignatureApp();
  return { ok: true, id: created.id };
}
