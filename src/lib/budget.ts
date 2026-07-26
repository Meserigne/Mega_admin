import { isMouvementInterne } from "@/lib/constants";
import { MOIS_LABELS } from "@/lib/constants";
import { whereOperationApprouvee } from "@/lib/approbation";
import { whereJournalBanque } from "@/lib/cash-sync";
import { prisma } from "@/lib/prisma";

export async function getBudgetData(annee: number) {
  const categories = await prisma.categorie.findMany({
    orderBy: [{ sens: "asc" }, { nom: "asc" }],
  });

  const budgetLignes = await prisma.budgetLigne.findMany({
    include: { categorie: true },
  });

  const [journal, caisse] = await Promise.all([
    prisma.operation.findMany({
      // Cash comptabilisé via la petite caisse (évite double comptage)
      where: { ...whereOperationApprouvee, ...whereJournalBanque },
      include: { categorie: true },
    }),
    prisma.operationCaisse.findMany({
      where: whereOperationApprouvee,
      include: { categorie: true },
    }),
  ]);

  const realise = new Map<string, number>();

  function addRealise(categorieId: string, date: Date | null, montant: number) {
    if (!date || date.getUTCFullYear() !== annee) return;
    const mois = date.getUTCMonth() + 1;
    const key = `${categorieId}-${mois}`;
    realise.set(key, (realise.get(key) ?? 0) + montant);
  }

  for (const op of journal) {
    const m = (op.entree ?? 0) + (op.sortie ?? 0);
    if (m > 0) addRealise(op.categorieId, op.date, m);
  }
  for (const op of caisse) {
    const m = (op.entree ?? 0) + (op.sortie ?? 0);
    if (m > 0) addRealise(op.categorieId, op.date, m);
  }

  const budgetMap = new Map<string, number>();
  for (const l of budgetLignes) {
    budgetMap.set(`${l.categorieId}-${l.mois}`, l.montant);
  }

  const lignes = categories.map((cat) => {
    const mois = MOIS_LABELS.map((label, idx) => {
      const m = idx + 1;
      const key = `${cat.id}-${m}`;
      const budget = budgetMap.get(key) ?? 0;
      const real = realise.get(key) ?? 0;
      return { mois: m, label, budget, realise: real, ecart: budget - real };
    });
    const totalBudget = mois.reduce((s, x) => s + x.budget, 0);
    const totalRealise = mois.reduce((s, x) => s + x.realise, 0);
    return {
      categorie: cat,
      mois,
      totalBudget,
      totalRealise,
      totalEcart: totalBudget - totalRealise,
    };
  });

  return { lignes, moisLabels: [...MOIS_LABELS] };
}

export async function getDepenseParCodeBudgetaire() {
  const codes = await prisma.codeBudgetaire.findMany({ orderBy: { code: "asc" } });

  const [journal, caisse] = await Promise.all([
    prisma.operation.findMany({
      where: {
        ...whereOperationApprouvee,
        ...whereJournalBanque,
        codeBudgetaireId: { not: null },
      },
      include: { categorie: true },
    }),
    prisma.operationCaisse.findMany({
      where: { ...whereOperationApprouvee, codeBudgetaireId: { not: null } },
      include: { categorie: true },
    }),
  ]);

  const depenses = new Map<string, number>();

  for (const op of [...journal, ...caisse]) {
    if (!op.codeBudgetaireId) continue;
    if (isMouvementInterne(op.categorie.nom, op.categorie.codeCompte)) continue;
    const montant = op.sortie ?? 0;
    if (montant > 0) {
      depenses.set(
        op.codeBudgetaireId,
        (depenses.get(op.codeBudgetaireId) ?? 0) + montant
      );
    }
  }

  return codes.map((code) => {
    const depense = depenses.get(code.id) ?? 0;
    const reste = code.enveloppe - depense;
    const pct =
      code.enveloppe > 0
        ? Math.round((depense / code.enveloppe) * 100)
        : depense > 0
          ? 100
          : 0;
    return { ...code, depense, reste, pct, depasse: depense > code.enveloppe };
  });
}
