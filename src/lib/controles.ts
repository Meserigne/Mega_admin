import {
  APPROVISIONNEMENT_CAISSE,
  TRANSFERT_VERS_CAISSE,
  isMouvementInterne,
} from "@/lib/constants";
import type { Controle, ControleSource } from "@/lib/controle-helpers";
import { resolveStatutEcheance } from "@/lib/impots-statut";
import { whereOperationApprouvee } from "@/lib/approbation";
import { prisma } from "@/lib/prisma";
import { getSoldes } from "@/lib/tresorerie";

export type { Controle };

const MAX_SOURCES = 12;

type OpLike = {
  id: string;
  libelle: string;
  date: Date | null;
  entree: number | null;
  sortie: number | null;
  numeroPiece: string | null;
  codeBudgetaireId: string | null;
  categorie: { nom: string; codeCompte: string };
};

function formatOpLabel(op: OpLike): string {
  const date = op.date
    ? new Date(op.date).toLocaleDateString("fr-FR")
    : "Sans date";
  const montant = op.entree ?? op.sortie ?? 0;
  return `${date} · ${op.libelle} (${montant.toLocaleString("fr-FR")} FCFA)`;
}

function journalSource(op: OpLike): ControleSource {
  return { label: formatOpLabel(op), href: `/journal?op=${op.id}` };
}

function caisseSource(op: OpLike): ControleSource {
  return { label: formatOpLabel(op), href: `/caisse?op=${op.id}` };
}

function limitSources(
  sources: ControleSource[],
  href: string,
  filter?: string
): { sources: ControleSource[]; href: string } {
  if (sources.length <= MAX_SOURCES) {
    return { sources, href };
  }
  const voirTout: ControleSource = {
    label: `Voir les ${sources.length} écritures concernées →`,
    href: filter ? `${href}?controle=${filter}` : href,
  };
  return { sources: [...sources.slice(0, MAX_SOURCES), voirTout], href };
}

export async function runControles(): Promise<Controle[]> {
  const params = await prisma.parametre.findFirst();
  if (!params) return [];

  const [journal, caisse, codes, echeances] = await Promise.all([
    prisma.operation.findMany({
      where: whereOperationApprouvee,
      include: { categorie: true },
    }),
    prisma.operationCaisse.findMany({
      where: whereOperationApprouvee,
      include: { categorie: true },
    }),
    prisma.codeBudgetaire.findMany(),
    prisma.echeanceImpot.findMany(),
  ]);

  // Miroirs Cash déjà couverts par le journal : éviter les faux doublons
  const caisseSansMiroir = caisse.filter((o) => !o.operationId);
  const journalSansCash = journal.filter((o) => o.modePaiement !== "Cash");

  const controles: Controle[] = [];

  const opsSansDate = [
    ...journal.filter((o) => !o.date).map(journalSource),
    ...caisseSansMiroir.filter((o) => !o.date).map(caisseSource),
  ];
  const sansDate = opsSansDate.length;
  const s1 = limitSources(opsSansDate, "/journal", "sans-date");
  controles.push({
    id: 1,
    libelle: "Opérations sans date",
    statut: sansDate === 0 ? "OK" : "ALERTE",
    detail:
      sansDate === 0
        ? "Toutes les opérations ont une date."
        : `${sansDate} opération(s) sans date.`,
    href: "/journal?controle=sans-date",
    sources: sansDate > 0 ? s1.sources : undefined,
  });

  const sansCategorie = 0;
  controles.push({
    id: 2,
    libelle: "Opérations sans catégorie",
    statut: sansCategorie === 0 ? "OK" : "ALERTE",
    detail: "Toutes les opérations ont une catégorie.",
    href: "/journal",
  });

  const opsSansPiece = [
    ...journal.filter((o) => !o.numeroPiece?.trim()).map(journalSource),
    ...caisseSansMiroir.filter((o) => !o.numeroPiece?.trim()).map(caisseSource),
  ];
  const sansPiece = opsSansPiece.length;
  const s3 = limitSources(opsSansPiece, "/journal", "sans-piece");
  controles.push({
    id: 3,
    libelle: "Opérations sans n° de pièce",
    statut: sansPiece === 0 ? "OK" : "ALERTE",
    detail:
      sansPiece === 0
        ? "Tous les numéros de pièce sont renseignés."
        : `${sansPiece} opération(s) sans n° de pièce.`,
    href: "/journal?controle=sans-piece",
    sources: sansPiece > 0 ? s3.sources : undefined,
  });

  const journalSortiesSansCode = journal.filter(
    (o) =>
      (o.sortie ?? 0) > 0 &&
      !o.codeBudgetaireId &&
      !isMouvementInterne(o.categorie.nom, o.categorie.codeCompte)
  );
  const caisseSortiesSansCode = caisseSansMiroir.filter(
    (o) =>
      (o.sortie ?? 0) > 0 &&
      !o.codeBudgetaireId &&
      !isMouvementInterne(o.categorie.nom, o.categorie.codeCompte)
  );
  const journalSortiesSansCodeBanq = journalSortiesSansCode.filter(
    (o) => o.modePaiement !== "Cash"
  );
  const sortiesSansCode =
    journalSortiesSansCodeBanq.length + caisseSortiesSansCode.length;
  const s4 = limitSources(
    [
      ...journalSortiesSansCodeBanq.map(journalSource),
      ...caisseSortiesSansCode.map(caisseSource),
    ],
    "/journal",
    "sans-code-budget"
  );
  controles.push({
    id: 4,
    libelle: "Sorties sans code budgétaire",
    statut: sortiesSansCode === 0 ? "OK" : "ALERTE",
    detail:
      sortiesSansCode === 0
        ? "Toutes les sorties ont un code budgétaire."
        : `${sortiesSansCode} sortie(s) sans code budgétaire.`,
    href: "/journal?controle=sans-code-budget",
    sources: sortiesSansCode > 0 ? s4.sources : undefined,
  });

  const journalDouble = journal.filter(
    (o) => (o.entree ?? 0) > 0 && (o.sortie ?? 0) > 0
  );
  const caisseDouble = caisseSansMiroir.filter(
    (o) => (o.entree ?? 0) > 0 && (o.sortie ?? 0) > 0
  );
  const doubleMontant = journalDouble.length + caisseDouble.length;
  const s5 = limitSources(
    [...journalDouble.map(journalSource), ...caisseDouble.map(caisseSource)],
    "/journal",
    "double-montant"
  );
  controles.push({
    id: 5,
    libelle: "Lignes avec entrée ET sortie",
    statut: doubleMontant === 0 ? "OK" : "ALERTE",
    detail:
      doubleMontant === 0
        ? "Aucune ligne avec entrée et sortie simultanées."
        : `${doubleMontant} ligne(s) incohérente(s).`,
    href: "/journal?controle=double-montant",
    sources: doubleMontant > 0 ? s5.sources : undefined,
  });

  const seen = new Set<string>();
  const doublonSources: ControleSource[] = [];
  for (const op of [...journalSansCash, ...caisseSansMiroir]) {
    const montant = op.entree ?? op.sortie ?? 0;
    const key = `${op.date?.toISOString() ?? "null"}|${op.libelle}|${montant}`;
    const src =
      "modePaiement" in op ? journalSource(op) : caisseSource(op);
    if (seen.has(key)) doublonSources.push(src);
    else seen.add(key);
  }
  const s6 = limitSources(doublonSources, "/journal", "doublon");
  controles.push({
    id: 6,
    libelle: "Doublons potentiels",
    statut: doublonSources.length === 0 ? "OK" : "ALERTE",
    detail:
      doublonSources.length === 0
        ? "Aucun doublon détecté."
        : `${doublonSources.length} doublon(s) potentiel(s).`,
    href: "/journal?controle=doublon",
    sources: doublonSources.length > 0 ? s6.sources : undefined,
  });

  const soldes = await getSoldes();
  const soldeCaisseNeg = soldes && soldes.soldeCaisse < 0;
  controles.push({
    id: 7,
    libelle: "Solde de caisse négatif",
    statut: soldeCaisseNeg ? "ALERTE" : "OK",
    detail: soldeCaisseNeg
      ? `Solde caisse : ${soldes!.soldeCaisse.toLocaleString("fr-FR")} FCFA.`
      : "Le solde de caisse est positif ou nul.",
    href: "/caisse",
    sources: soldeCaisseNeg
      ? [{ label: "Ouvrir la petite caisse", href: "/caisse" }]
      : undefined,
  });

  const { getTresorerieMensuelle } = await import("@/lib/tresorerie");
  const treso = await getTresorerieMensuelle();
  const moisNegatifs =
    treso?.banque.filter((m) => m.fin < 0).map((m) => m.label) ?? [];
  const banqueNeg = moisNegatifs.length > 0;
  controles.push({
    id: 8,
    libelle: "Solde bancaire mensuel négatif",
    statut: banqueNeg ? "ALERTE" : "OK",
    detail: banqueNeg
      ? `Mois concernés : ${moisNegatifs.join(", ")}.`
      : "Tous les soldes bancaires mensuels sont positifs ou nuls.",
    href: "/tresorerie",
    sources: banqueNeg
      ? moisNegatifs.map((m) => ({
          label: `Trésorerie · ${m}`,
          href: "/tresorerie",
        }))
      : undefined,
  });

  const transfertJournal = journal
    .filter((o) => o.categorie.nom === TRANSFERT_VERS_CAISSE)
    .reduce((s, o) => s + (o.sortie ?? 0), 0);
  const approCaisse = caisse
    .filter((o) => o.categorie.nom === APPROVISIONNEMENT_CAISSE)
    .reduce((s, o) => s + (o.entree ?? 0), 0);
  const ecartTransfert = transfertJournal - approCaisse;
  controles.push({
    id: 9,
    libelle: "Écart transferts banque ↔ caisse",
    statut: ecartTransfert === 0 ? "OK" : "ALERTE",
    detail:
      ecartTransfert === 0
        ? "Les transferts internes sont équilibrés."
        : `Écart de ${ecartTransfert.toLocaleString("fr-FR")} FCFA entre journal et caisse.`,
    href: "/journal",
    sources:
      ecartTransfert !== 0
        ? [
            {
              label: "Journal · transferts vers caisse",
              href: "/journal?controle=transfert-caisse",
            },
            {
              label: "Caisse · approvisionnements",
              href: "/caisse?controle=appro-caisse",
            },
          ]
        : undefined,
  });

  const { getDepenseParCodeBudgetaire } = await import("@/lib/budget");
  const codesData = await getDepenseParCodeBudgetaire();
  const codesDepasses = codesData.filter((c) => c.depasse);
  const depasses = codesDepasses.length;
  controles.push({
    id: 10,
    libelle: "Enveloppes budgétaires dépassées",
    statut: depasses === 0 ? "OK" : "ALERTE",
    detail:
      depasses === 0
        ? "Aucune enveloppe dépassée."
        : `${depasses} enveloppe(s) dépassée(s).`,
    href: "/codes-budgetaires",
    sources: codesDepasses.map((c) => ({
      label: `${c.code} · ${c.beneficiaire} (+${(c.depense - c.enveloppe).toLocaleString("fr-FR")} FCFA)`,
      href: "/codes-budgetaires",
    })),
  });

  const budgetData = await import("@/lib/budget").then((m) =>
    m.getBudgetData(params.annee)
  );
  const lignesDepasse = budgetData.lignes.filter(
    (l) =>
      l.categorie.sens === "sortie" &&
      l.totalRealise > l.totalBudget &&
      l.totalBudget > 0
  );
  const depasseBudget = lignesDepasse.length;
  controles.push({
    id: 11,
    libelle: "Réalisé sorties > budget annuel",
    statut: depasseBudget === 0 ? "OK" : "ALERTE",
    detail:
      depasseBudget === 0
        ? "Le réalisé est dans les budgets."
        : `${depasseBudget} catégorie(s) au-dessus du budget.`,
    href: "/budget",
    sources: lignesDepasse.map((l) => ({
      label: `${l.categorie.nom} (réalisé ${l.totalRealise.toLocaleString("fr-FR")} / budget ${l.totalBudget.toLocaleString("fr-FR")})`,
      href: "/budget",
    })),
  });

  const plafondDepasse = soldes && soldes.soldeCaisse > params.plafondCaisse;
  controles.push({
    id: 12,
    libelle: "Solde caisse > plafond autorisé",
    statut: plafondDepasse ? "ALERTE" : "OK",
    detail: plafondDepasse
      ? `Solde ${soldes!.soldeCaisse.toLocaleString("fr-FR")} > plafond ${params.plafondCaisse.toLocaleString("fr-FR")} FCFA.`
      : `Plafond caisse : ${params.plafondCaisse.toLocaleString("fr-FR")} FCFA respecté.`,
    href: "/caisse",
    sources: plafondDepasse
      ? [{ label: "Voir la petite caisse", href: "/caisse" }]
      : undefined,
  });

  const impotsEnRetard = echeances.filter(
    (e) => resolveStatutEcheance(e.statut, e.echeance) === "En retard"
  );
  const impotsRetard = impotsEnRetard.length;
  controles.push({
    id: 13,
    libelle: "Échéances d'impôts en retard",
    statut: impotsRetard === 0 ? "OK" : "ALERTE",
    detail:
      impotsRetard === 0
        ? "Aucune échéance en retard."
        : `${impotsRetard} échéance(s) en retard.`,
    href: "/impots",
    sources: impotsEnRetard.map((e) => ({
      label: `${e.impot} · ${e.periode} (${e.montantDu.toLocaleString("fr-FR")} FCFA)`,
      href: "/impots",
    })),
  });

  return controles;
}

export async function countAlertes(): Promise<number> {
  const controles = await runControles();
  return controles.filter((c) => c.statut === "ALERTE").length;
}
