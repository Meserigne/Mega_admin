"use server";

import { revalidatePath } from "next/cache";
import { logAudit } from "@/lib/audit";
import { guardWrite, isGuardError } from "@/lib/auth-guard";
import { computeTotauxFacture } from "@/lib/facturation";
import { prisma } from "@/lib/prisma";
import { canApproveCeo } from "@/lib/roles";
import type { SessionUser } from "@/lib/session";
import {
  markSignatureRefused,
  markSignatureSigned,
  validateSignatureImage,
} from "@/lib/signatures";
import {
  ensureCaisseMirrorFromJournal,
  ensureJournalMirrorFromCaisse,
  isCashMode,
} from "@/lib/cash-sync";
import {
  ensureApprovisionnementCaisse,
  isTransfertVersCaisse,
} from "@/lib/transfert-caisse";

const PATHS = [
  "/",
  "/journal",
  "/caisse",
  "/tresorerie",
  "/budget",
  "/codes-budgetaires",
  "/approbations",
  "/signatures",
  "/finance",
  "/facturation",
];

function revalidateAll() {
  for (const p of PATHS) revalidatePath(p);
}

export type ApprobationRow = {
  id: string;
  source: "journal" | "caisse" | "facture";
  date: string | null;
  libelle: string;
  montant: number;
  montantType: "entree" | "sortie" | "facture";
  demandePar: string | null;
  demandeAt: string | null;
  categorieNom: string;
};

export async function getPendingApprovals(): Promise<ApprobationRow[]> {
  const [journal, caisse, factures] = await Promise.all([
    prisma.operation.findMany({
      where: { statutApprobation: "EN_ATTENTE_CEO" },
      include: { categorie: true },
      orderBy: [{ demandeAt: "asc" }],
    }),
    prisma.operationCaisse.findMany({
      // Les miroirs Cash sont déjà listés côté journal
      where: { statutApprobation: "EN_ATTENTE_CEO", operationId: null },
      include: { categorie: true },
      orderBy: [{ demandeAt: "asc" }],
    }),
    prisma.facture.findMany({
      where: { statutApprobation: "EN_ATTENTE_CEO" },
      include: { client: true, lignes: true },
      orderBy: [{ demandeAt: "asc" }],
    }),
  ]);

  const rows: ApprobationRow[] = [
    ...journal.map((op) => ({
      id: op.id,
      source: "journal" as const,
      date: op.date?.toISOString() ?? null,
      libelle: op.libelle,
      montant: op.entree ?? op.sortie ?? 0,
      montantType: (op.entree ? "entree" : "sortie") as "entree" | "sortie",
      demandePar: op.demandePar,
      demandeAt: op.demandeAt?.toISOString() ?? null,
      categorieNom: op.categorie.nom,
    })),
    ...caisse.map((op) => ({
      id: op.id,
      source: "caisse" as const,
      date: op.date?.toISOString() ?? null,
      libelle: op.libelle,
      montant: op.entree ?? op.sortie ?? 0,
      montantType: (op.entree ? "entree" : "sortie") as "entree" | "sortie",
      demandePar: op.demandePar,
      demandeAt: op.demandeAt?.toISOString() ?? null,
      categorieNom: op.categorie.nom,
    })),
    ...factures.map((f) => {
      const totaux = computeTotauxFacture(
        f.lignes,
        f.reliquat,
        f.tauxTVA,
        f.montantPaye
      );
      return {
        id: f.id,
        source: "facture" as const,
        date: f.date.toISOString(),
        libelle: `Facture ${f.numero} · ${f.client.nom}`,
        montant: totaux.totalGeneral,
        montantType: "facture" as const,
        demandePar: f.demandePar,
        demandeAt: f.demandeAt?.toISOString() ?? null,
        categorieNom: "Facturation",
      };
    }),
  ];

  return rows.sort((a, b) => {
    const da = a.demandeAt ? new Date(a.demandeAt).getTime() : 0;
    const db = b.demandeAt ? new Date(b.demandeAt).getTime() : 0;
    return da - db;
  });
}

export async function countPendingApprovals(): Promise<number> {
  const [j, c, f] = await Promise.all([
    prisma.operation.count({ where: { statutApprobation: "EN_ATTENTE_CEO" } }),
    prisma.operationCaisse.count({
      where: { statutApprobation: "EN_ATTENTE_CEO", operationId: null },
    }),
    prisma.facture.count({ where: { statutApprobation: "EN_ATTENTE_CEO" } }),
  ]);
  return j + c + f;
}

async function requireCeoApprover(): Promise<
  SessionUser | { ok: false; error: string }
> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;
  if (!canApproveCeo(guard.role)) {
    return {
      ok: false,
      error: "Seule la CEO peut approuver ou refuser ces opérations.",
    };
  }
  return guard;
}

export async function approveOperation(
  id: string,
  source: "journal" | "caisse" | "facture",
  signatureImage: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireCeoApprover();
  if ("ok" in guard && guard.ok === false) return guard;
  const approver = guard as SessionUser;

  const sigErr = validateSignatureImage(signatureImage);
  if (sigErr) return { ok: false, error: sigErr };

  const now = new Date();
  const data = {
    statutApprobation: "APPROUVE",
    approuvePar: approver.nom,
    approuveAt: now,
    validePar: approver.nom,
    motifRefus: null,
  };

  if (source === "journal") {
    const op = await prisma.operation.findUnique({
      where: { id },
      include: { caisseMiroir: true },
    });
    if (!op || op.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.operation.update({ where: { id }, data });
    if (op.caisseMiroir) {
      await prisma.operationCaisse.update({
        where: { id: op.caisseMiroir.id },
        data,
      });
    }

    // Transfert banque → caisse : créer l'entrée caisse à l'approbation
    if (
      (op.sortie ?? 0) > 0 &&
      (await isTransfertVersCaisse(op.categorieId))
    ) {
      await ensureApprovisionnementCaisse({
        montant: op.sortie!,
        date: op.date,
        codeBudgetaireId: op.codeBudgetaireId,
        libelleJournal: op.libelle,
      });
    } else if (isCashMode(op.modePaiement)) {
      await ensureCaisseMirrorFromJournal(id);
    }
  } else if (source === "caisse") {
    const op = await prisma.operationCaisse.findUnique({ where: { id } });
    if (!op || op.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.operationCaisse.update({ where: { id }, data });
    if (op.operationId) {
      await prisma.operation.update({ where: { id: op.operationId }, data });
    } else {
      await ensureJournalMirrorFromCaisse(id);
    }
  } else {
    const f = await prisma.facture.findUnique({ where: { id } });
    if (!f || f.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.facture.update({
      where: { id },
      data: {
        statutApprobation: "APPROUVE",
        approuvePar: approver.nom,
        approuveAt: now,
        motifRefus: null,
      },
    });
  }

  const entityLabel =
    source === "journal"
      ? "Operation"
      : source === "caisse"
        ? "OperationCaisse"
        : "Facture";

  await logAudit({
    userId: approver.id,
    userNom: approver.nom,
    action: "UPDATE",
    entity: entityLabel,
    entityId: id,
    details: "Approbation CEO avec signature électronique",
  });

  await markSignatureSigned(source, id, signatureImage.trim(), {
    id: approver.id,
    nom: approver.nom,
  });

  revalidateAll();
  return { ok: true };
}

export async function rejectOperation(
  id: string,
  source: "journal" | "caisse" | "facture",
  motif: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await requireCeoApprover();
  if ("ok" in guard && guard.ok === false) return guard;
  const approver = guard as SessionUser;

  const motifTrim = motif.trim();
  if (!motifTrim) return { ok: false, error: "Le motif de refus est obligatoire." };

  const data = {
    statutApprobation: "REFUSE",
    approuvePar: approver.nom,
    approuveAt: new Date(),
    motifRefus: motifTrim,
  };

  if (source === "journal") {
    const op = await prisma.operation.findUnique({
      where: { id },
      include: { caisseMiroir: true },
    });
    if (!op || op.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.operation.update({ where: { id }, data });
    if (op.caisseMiroir) {
      await prisma.operationCaisse.update({
        where: { id: op.caisseMiroir.id },
        data,
      });
    }
  } else if (source === "caisse") {
    const op = await prisma.operationCaisse.findUnique({ where: { id } });
    if (!op || op.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.operationCaisse.update({ where: { id }, data });
    if (op.operationId) {
      await prisma.operation.update({ where: { id: op.operationId }, data });
    }
  } else {
    const f = await prisma.facture.findUnique({ where: { id } });
    if (!f || f.statutApprobation !== "EN_ATTENTE_CEO") {
      return { ok: false, error: "Demande introuvable ou déjà traitée." };
    }
    await prisma.facture.update({
      where: { id },
      data: {
        statutApprobation: "REFUSE",
        approuvePar: approver.nom,
        approuveAt: new Date(),
        motifRefus: motifTrim,
      },
    });
  }

  const entityLabel =
    source === "journal"
      ? "Operation"
      : source === "caisse"
        ? "OperationCaisse"
        : "Facture";

  await logAudit({
    userId: approver.id,
    userNom: approver.nom,
    action: "UPDATE",
    entity: entityLabel,
    entityId: id,
    details: `Refus CEO : ${motifTrim}`,
  });

  await markSignatureRefused(source, id, motifTrim, {
    id: approver.id,
    nom: approver.nom,
  });

  revalidateAll();
  return { ok: true };
}
