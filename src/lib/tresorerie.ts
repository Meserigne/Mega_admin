import { MOIS_LABELS } from "@/lib/constants";
import { whereOperationApprouvee } from "@/lib/approbation";
import { MODE_CASH, whereJournalBanque } from "@/lib/cash-sync";
import { prisma } from "@/lib/prisma";

export type Mouvement = {
  date: Date | null;
  entree: number | null;
  sortie: number | null;
};

export type LigneMensuelle = {
  mois: number;
  label: string;
  debut: number;
  entrees: number;
  sorties: number;
  fin: number;
};

function getMois(date: Date | null): number | null {
  if (!date) return null;
  return date.getUTCMonth() + 1;
}

/** Fenêtre UTC de l'exercice comptable. */
export function plageExercice(annee: number) {
  return {
    gte: new Date(Date.UTC(annee, 0, 1)),
    lt: new Date(Date.UTC(annee + 1, 0, 1)),
  };
}

function buildMensuel(
  ops: Mouvement[],
  soldeInitial: number,
  annee: number
): LigneMensuelle[] {
  const parMois = new Map<number, { entrees: number; sorties: number }>();

  for (let m = 1; m <= 12; m++) {
    parMois.set(m, { entrees: 0, sorties: 0 });
  }

  for (const op of ops) {
    if (!op.date) continue;
    if (op.date.getUTCFullYear() !== annee) continue;
    const mois = getMois(op.date);
    if (!mois) continue;
    const row = parMois.get(mois)!;
    row.entrees += op.entree ?? 0;
    row.sorties += op.sortie ?? 0;
  }

  let solde = soldeInitial;
  const lignes: LigneMensuelle[] = [];

  for (let m = 1; m <= 12; m++) {
    const { entrees, sorties } = parMois.get(m)!;
    const debut = solde;
    const fin = debut + entrees - sorties;
    lignes.push({
      mois: m,
      label: MOIS_LABELS[m - 1],
      debut,
      entrees,
      sorties,
      fin,
    });
    solde = fin;
  }

  return lignes;
}

/**
 * Soldes courants de l'exercice (Parametre.annee).
 * Aligné sur le solde fin décembre de getTresorerieMensuelle.
 */
export async function getSoldes() {
  const params = await prisma.parametre.findFirst();
  if (!params) return null;

  const date = plageExercice(params.annee);
  const whereExerciceBanque = {
    ...whereOperationApprouvee,
    ...whereJournalBanque,
    date,
  };
  const whereExerciceCaisse = {
    ...whereOperationApprouvee,
    date,
  };

  const [journalAgg, caisseAgg, pendingJournal, pendingCaisse] =
    await Promise.all([
      prisma.operation.aggregate({
        where: whereExerciceBanque,
        _sum: { entree: true, sortie: true },
      }),
      prisma.operationCaisse.aggregate({
        where: whereExerciceCaisse,
        _sum: { entree: true, sortie: true },
      }),
      // Cash = côté caisse ; on évite le double comptage des miroirs
      prisma.operation.aggregate({
        where: {
          statutApprobation: "EN_ATTENTE_CEO",
          date,
          ...whereJournalBanque,
        },
        _sum: { entree: true, sortie: true },
        _count: true,
      }),
      prisma.operationCaisse.aggregate({
        where: {
          statutApprobation: "EN_ATTENTE_CEO",
          date,
        },
        _sum: { entree: true, sortie: true },
        _count: true,
      }),
    ]);

  const entreesBanque = journalAgg._sum.entree ?? 0;
  const sortiesBanque = journalAgg._sum.sortie ?? 0;
  const entreesCaisse = caisseAgg._sum.entree ?? 0;
  const sortiesCaisse = caisseAgg._sum.sortie ?? 0;

  const soldeBanque =
    params.soldeInitialBanque + entreesBanque - sortiesBanque;
  const soldeCaisse =
    params.soldeInitialCaisse + entreesCaisse - sortiesCaisse;

  const pendingCount =
    (pendingJournal._count ?? 0) + (pendingCaisse._count ?? 0);
  const pendingMontant =
    (pendingJournal._sum.entree ?? 0) +
    (pendingJournal._sum.sortie ?? 0) +
    (pendingCaisse._sum.entree ?? 0) +
    (pendingCaisse._sum.sortie ?? 0);

  return {
    params,
    soldeBanque,
    soldeCaisse,
    tresorerieTotale: soldeBanque + soldeCaisse,
    entreesBanque,
    sortiesBanque,
    entreesCaisse,
    sortiesCaisse,
    entreesAnnee: entreesBanque + entreesCaisse,
    sortiesAnnee: sortiesBanque + sortiesCaisse,
    resultat:
      entreesBanque + entreesCaisse - (sortiesBanque + sortiesCaisse),
    pendingCount,
    pendingMontant,
  };
}

export async function getTresorerieMensuelle() {
  const params = await prisma.parametre.findFirst();
  if (!params) return null;

  const date = plageExercice(params.annee);
  const whereExerciceBanque = {
    ...whereOperationApprouvee,
    ...whereJournalBanque,
    date,
  };
  const whereExerciceCaisse = {
    ...whereOperationApprouvee,
    date,
  };

  const [journal, caisse, soldes] = await Promise.all([
    prisma.operation.findMany({
      where: whereExerciceBanque,
      select: { date: true, entree: true, sortie: true },
    }),
    prisma.operationCaisse.findMany({
      where: whereExerciceCaisse,
      select: { date: true, entree: true, sortie: true },
    }),
    getSoldes(),
  ]);

  const banque = buildMensuel(journal, params.soldeInitialBanque, params.annee);
  const caisseRows = buildMensuel(
    caisse,
    params.soldeInitialCaisse,
    params.annee
  );

  const total = banque.map((b, i) => ({
    mois: b.mois,
    label: b.label,
    debut: b.debut + caisseRows[i].debut,
    entrees: b.entrees + caisseRows[i].entrees,
    sorties: b.sorties + caisseRows[i].sorties,
    fin: b.fin + caisseRows[i].fin,
  }));

  return {
    params,
    banque,
    caisse: caisseRows,
    total,
    soldesActuels: soldes
      ? {
          soldeBanque: soldes.soldeBanque,
          soldeCaisse: soldes.soldeCaisse,
          tresorerieTotale: soldes.tresorerieTotale,
          pendingCount: soldes.pendingCount,
          pendingMontant: soldes.pendingMontant,
        }
      : null,
    anomalies: await getAnomaliesTresorerie(params.annee, params.plafondCaisse),
  };
}

export type AnomalieTresorerie = {
  id: string;
  type: "DOUBLON_BANQUE_CAISSE" | "CAISSE_SUR_PLAFOND" | "CAISSE_MONTANT_ELEVE";
  severity: "error" | "warning";
  message: string;
  date: string | null;
  montant: number;
  /** Compte où l'écriture est (à tort ou à vérifier) */
  compte: "banque" | "caisse";
  reference: string;
  href: string;
  /** Si doublon : l'écriture correcte (souvent banque) */
  contrepartie?: {
    compte: "banque" | "caisse";
    reference: string;
    href: string;
    id: string;
  };
  /** Action de correction proposée */
  correction?: {
    action: "supprimer_caisse" | "ouvrir_caisse" | "ouvrir_journal";
    label: string;
    targetId: string;
  };
};

/**
 * Détecte les écritures mal classées (ex. paiement chèque banque
 * aussi saisi en petite caisse) et les montants caisse anormaux.
 */
export async function getAnomaliesTresorerie(
  annee: number,
  plafondCaisse: number
): Promise<AnomalieTresorerie[]> {
  const date = plageExercice(annee);
  const whereExercice = { ...whereOperationApprouvee, date };

  const [journal, caisse] = await Promise.all([
    prisma.operation.findMany({
      where: { ...whereExercice, ...whereJournalBanque },
      select: {
        id: true,
        date: true,
        numeroPiece: true,
        libelle: true,
        entree: true,
        sortie: true,
        modePaiement: true,
      },
    }),
    prisma.operationCaisse.findMany({
      where: whereExercice,
      select: {
        id: true,
        date: true,
        numeroPiece: true,
        libelle: true,
        entree: true,
        sortie: true,
        operationId: true,
      },
    }),
  ]);

  const anomalies: AnomalieTresorerie[] = [];
  const seenCaisse = new Set<string>();

  for (const c of caisse) {
    // Synchro Cash volontaire : pas une anomalie
    if (c.operationId) continue;

    const montant = c.entree ?? c.sortie ?? 0;
    const sens = (c.entree ?? 0) > 0 ? "entree" : "sortie";
    const lib = (c.libelle || "").trim().toLowerCase();
    const d = c.date?.toISOString().slice(0, 10) ?? null;

    const match = journal.find((j) => {
      if (j.modePaiement === MODE_CASH) return false;
      const jm = j.entree ?? j.sortie ?? 0;
      const js = (j.entree ?? 0) > 0 ? "entree" : "sortie";
      const jd = j.date?.toISOString().slice(0, 10) ?? null;
      return (
        jm === montant &&
        js === sens &&
        (j.libelle || "").trim().toLowerCase() === lib &&
        jd === d
      );
    });

    if (match && !seenCaisse.has(c.id)) {
      seenCaisse.add(c.id);
      anomalies.push({
        id: `dup-${c.id}`,
        type: "DOUBLON_BANQUE_CAISSE",
        severity: "error",
        message: `Saisi en banque ET en petite caisse : « ${c.libelle} ». Le montant doit rester sur un seul compte (souvent la banque pour un chèque / virement).`,
        date: c.date?.toISOString() ?? null,
        montant,
        compte: "caisse",
        reference: c.numeroPiece || c.id.slice(0, 8),
        href: `/caisse?op=${c.id}`,
        contrepartie: {
          compte: "banque",
          reference: match.numeroPiece || match.id.slice(0, 8),
          href: `/journal?op=${match.id}`,
          id: match.id,
        },
        correction: {
          action: "supprimer_caisse",
          label: "Retirer de la petite caisse (garder la banque)",
          targetId: c.id,
        },
      });
    }

    // Sortie caisse > plafond : souvent une erreur de compte
    if (sens === "sortie" && montant > plafondCaisse) {
      anomalies.push({
        id: `plafond-${c.id}`,
        type: "CAISSE_SUR_PLAFOND",
        severity: "warning",
        message: `Sortie caisse ${montant.toLocaleString("fr-FR")} FCFA supérieure au plafond (${plafondCaisse.toLocaleString("fr-FR")} FCFA) : vérifier si ce n'est pas une opération banque.`,
        date: c.date?.toISOString() ?? null,
        montant,
        compte: "caisse",
        reference: c.numeroPiece || c.id.slice(0, 8),
        href: `/caisse?op=${c.id}`,
        correction: {
          action: "ouvrir_caisse",
          label: "Corriger dans la petite caisse",
          targetId: c.id,
        },
      });
    }
  }

  return anomalies;
}

export async function getDonneesGraphiques() {
  const params = await prisma.parametre.findFirst();
  if (!params) return null;

  const tresorerie = await getTresorerieMensuelle();
  if (!tresorerie) return null;

  const fluxMensuel = tresorerie.total.map((t) => ({
    mois: t.label,
    entrees: t.entrees,
    sorties: t.sorties,
  }));

  const evolution = tresorerie.total.map((t) => ({
    mois: t.label,
    tresorerie: t.fin,
  }));

  return { params, fluxMensuel, evolution };
}

export function computeSoldeCaisseApres(
  ops: { entree: number | null; sortie: number | null }[],
  soldeInitial: number,
  excludeId?: string,
  opsWithId?: { id: string; entree: number | null; sortie: number | null }[]
) {
  let solde = soldeInitial;
  const list = opsWithId ?? ops.map((o, i) => ({ id: String(i), ...o }));
  for (const op of list) {
    if (excludeId && op.id === excludeId) continue;
    solde += (op.entree ?? 0) - (op.sortie ?? 0);
  }
  return solde;
}
