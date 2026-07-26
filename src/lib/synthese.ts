import { whereOperationApprouvee } from "@/lib/approbation";
import { whereJournalBanque } from "@/lib/cash-sync";
import { prisma } from "@/lib/prisma";

export type LigneSynthese = {
  codeCompte: string;
  intitule: string;
  entrees: number;
  sorties: number;
  solde: number;
};

export async function getSyntheseComptable(): Promise<LigneSynthese[]> {
  const [journal, caisse] = await Promise.all([
    prisma.operation.findMany({
      where: { ...whereOperationApprouvee, ...whereJournalBanque },
      include: { categorie: true },
    }),
    prisma.operationCaisse.findMany({
      where: whereOperationApprouvee,
      include: { categorie: true },
    }),
  ]);

  const map = new Map<
    string,
    { intitule: string; entrees: number; sorties: number }
  >();

  function add(
    code: string,
    intitule: string,
    entree: number,
    sortie: number
  ) {
    const existing = map.get(code) ?? { intitule, entrees: 0, sorties: 0 };
    existing.entrees += entree;
    existing.sorties += sortie;
    map.set(code, existing);
  }

  for (const op of journal) {
    add(
      op.categorie.codeCompte,
      op.categorie.intituleCompte,
      op.entree ?? 0,
      op.sortie ?? 0
    );
  }
  for (const op of caisse) {
    add(
      op.categorie.codeCompte,
      op.categorie.intituleCompte,
      op.entree ?? 0,
      op.sortie ?? 0
    );
  }

  return Array.from(map.entries())
    .map(([codeCompte, data]) => ({
      codeCompte,
      intitule: data.intitule,
      entrees: data.entrees,
      sorties: data.sorties,
      solde: data.entrees - data.sorties,
    }))
    .sort((a, b) => a.codeCompte.localeCompare(b.codeCompte, "fr"));
}

export function syntheseToCsv(
  lignes: LigneSynthese[],
  entreprise: string,
  annee: number
): string {
  const header = [
    "Code compte",
    "Intitulé",
    "Entrées (FCFA)",
    "Sorties (FCFA)",
    "Solde (FCFA)",
  ];
  const rows = lignes.map((l) => [
    l.codeCompte,
    `"${l.intitule.replace(/"/g, '""')}"`,
    String(l.entrees),
    String(l.sorties),
    String(l.solde),
  ]);

  const totaux = lignes.reduce(
    (acc, l) => ({
      entrees: acc.entrees + l.entrees,
      sorties: acc.sorties + l.sorties,
    }),
    { entrees: 0, sorties: 0 }
  );

  return [
    `# Synthèse comptable SYSCOHADA · ${entreprise} · ${annee}`,
    header.join(";"),
    ...rows.map((r) => r.join(";")),
    "",
    `TOTAL;Total général;${totaux.entrees};${totaux.sorties};${totaux.entrees - totaux.sorties}`,
  ].join("\n");
}
