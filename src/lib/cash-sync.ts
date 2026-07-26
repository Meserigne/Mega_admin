import {
  APPROVISIONNEMENT_CAISSE,
  TRANSFERT_VERS_CAISSE,
  isMouvementInterne,
} from "@/lib/constants";
import {
  nextNumeroPieceBanque,
  nextNumeroPieceCaisse,
} from "@/lib/numero-piece";
import { prisma } from "@/lib/prisma";

export const MODE_CASH = "Cash";

export function isCashMode(modePaiement: string | null | undefined): boolean {
  return (modePaiement ?? "").trim() === MODE_CASH;
}

/** Journal hors Cash : compte dans le solde banque / trésorerie banque. */
export const whereJournalBanque = {
  NOT: { modePaiement: MODE_CASH },
} as const;

type ApprovalSlice = {
  statutApprobation: string;
  demandePar: string | null;
  demandeAt: Date | null;
  approuvePar: string | null;
  approuveAt: Date | null;
  motifRefus: string | null;
  validePar: string | null;
};

function approvalFrom(op: ApprovalSlice): ApprovalSlice {
  return {
    statutApprobation: op.statutApprobation,
    demandePar: op.demandePar,
    demandeAt: op.demandeAt,
    approuvePar: op.approuvePar,
    approuveAt: op.approuveAt,
    motifRefus: op.motifRefus,
    validePar: op.validePar,
  };
}

/**
 * Journal Cash → miroir petite caisse (même sens / montant / statut).
 * Ignore les transferts internes banque→caisse (déjà gérés ailleurs).
 */
export async function ensureCaisseMirrorFromJournal(
  journalId: string
): Promise<void> {
  const op = await prisma.operation.findUnique({
    where: { id: journalId },
    include: { categorie: true, caisseMiroir: true },
  });
  if (!op) return;

  if (!isCashMode(op.modePaiement)) {
    if (op.caisseMiroir) {
      await prisma.operationCaisse.delete({ where: { id: op.caisseMiroir.id } });
    }
    return;
  }

  if (
    isMouvementInterne(op.categorie.nom, op.categorie.codeCompte) ||
    op.categorie.nom === TRANSFERT_VERS_CAISSE
  ) {
    return;
  }

  const data = {
    date: op.date,
    libelle: op.libelle,
    categorieId: op.categorieId,
    codeBudgetaireId: op.codeBudgetaireId,
    entree: op.entree,
    sortie: op.sortie,
    observations: op.observations,
    ...approvalFrom(op),
  };

  if (op.caisseMiroir) {
    await prisma.operationCaisse.update({
      where: { id: op.caisseMiroir.id },
      data,
    });
    return;
  }

  await prisma.operationCaisse.create({
    data: {
      ...data,
      operationId: op.id,
      numeroPiece: await nextNumeroPieceCaisse(prisma, op.date),
    },
  });
}

/**
 * Petite caisse → miroir journal en mode Cash.
 * Ignore les approvisionnements issus d'un transfert banque.
 */
export async function ensureJournalMirrorFromCaisse(
  caisseId: string
): Promise<void> {
  const op = await prisma.operationCaisse.findUnique({
    where: { id: caisseId },
    include: { categorie: true, operation: true },
  });
  if (!op) return;

  if (
    isMouvementInterne(op.categorie.nom, op.categorie.codeCompte) ||
    op.categorie.nom === APPROVISIONNEMENT_CAISSE
  ) {
    return;
  }

  const data = {
    date: op.date,
    libelle: op.libelle,
    categorieId: op.categorieId,
    codeBudgetaireId: op.codeBudgetaireId,
    modePaiement: MODE_CASH,
    entree: op.entree,
    sortie: op.sortie,
    observations: op.observations,
    tauxTVA: 0,
    ...approvalFrom(op),
  };

  if (op.operationId && op.operation) {
    await prisma.operation.update({
      where: { id: op.operationId },
      data,
    });
    return;
  }

  const created = await prisma.operation.create({
    data: {
      ...data,
      numeroPiece: await nextNumeroPieceBanque(prisma, op.date),
    },
  });

  await prisma.operationCaisse.update({
    where: { id: caisseId },
    data: { operationId: created.id },
  });
}

/** Supprime le journal lié (cascade → caisse) ou seulement la caisse. */
export async function deleteCaisseAndJournalMirror(
  caisseId: string
): Promise<void> {
  const op = await prisma.operationCaisse.findUnique({
    where: { id: caisseId },
    select: { id: true, operationId: true },
  });
  if (!op) return;
  if (op.operationId) {
    await prisma.operation.delete({ where: { id: op.operationId } });
    return;
  }
  await prisma.operationCaisse.delete({ where: { id: caisseId } });
}
