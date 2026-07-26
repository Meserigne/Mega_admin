"use server";

import { revalidatePath } from "next/cache";
import {
  approvalFieldsForCreate,
  approvalFieldsForUpdate,
  needsCeoApproval,
  whereOperationApprouvee,
} from "@/lib/approbation";
import { guardWrite, isGuardError } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import {
  deleteCaisseAndJournalMirror,
  ensureJournalMirrorFromCaisse,
} from "@/lib/cash-sync";
import { nextNumeroPieceCaisse } from "@/lib/numero-piece";
import { prisma } from "@/lib/prisma";
import { computeSoldeCaisseApres } from "@/lib/tresorerie";
import { syncSignatureForCaisseOperation } from "@/lib/signatures";
import { OperationInput, montantOperationInchange, validateOperation } from "@/lib/validation";

function parseDate(value: string): Date | null {
  if (!value.trim()) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

function toDbFields(input: OperationInput, numeroPiece?: string | null) {
  return {
    date: parseDate(input.date),
    numeroPiece: numeroPiece ?? (input.numeroPiece.trim() || null),
    libelle: input.libelle.trim(),
    categorieId: input.categorieId,
    codeBudgetaireId: input.codeBudgetaireId || null,
    entree: input.montantType === "entree" ? input.montant : null,
    sortie: input.montantType === "sortie" ? input.montant : null,
    observations: input.observations.trim() || null,
    validePar: input.validePar.trim() || null,
  };
}

async function getSoldeCaisseActuel(excludeId?: string) {
  const params = await prisma.parametre.findFirst();
  if (!params) return 0;
  const ops = await prisma.operationCaisse.findMany({
    where: whereOperationApprouvee,
    select: { id: true, entree: true, sortie: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return computeSoldeCaisseApres([], params.soldeInitialCaisse, excludeId, ops);
}

type OpResult =
  | { ok: true; message?: string }
  | { ok: false; error: string };

export async function createOperationCaisse(
  input: OperationInput
): Promise<OpResult> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const params = await prisma.parametre.findFirst();
  if (!params) return { ok: false, error: "Paramètres non configurés." };

  const categorie = await prisma.categorie.findUnique({
    where: { id: input.categorieId },
  });
  if (!categorie) return { ok: false, error: "Catégorie introuvable." };

  const ceoPending = needsCeoApproval(input.montant, params.seuilDoubleValidation);
  const soldeActuel = await getSoldeCaisseActuel();
  const enriched = { ...input, categorieNom: categorie.nom, validePar: "" };
  const err = validateOperation(enriched, params.seuilDoubleValidation, {
    checkCaisseBalance:
      !ceoPending && input.montantType === "sortie" ? soldeActuel : undefined,
    ceoApprovalPending: ceoPending,
  });
  if (err) return { ok: false, error: err };

  const approval = approvalFieldsForCreate(
    input.montant,
    params.seuilDoubleValidation,
    guard.nom
  );
  const opDate = parseDate(input.date);
  const numeroPiece = await nextNumeroPieceCaisse(prisma, opDate);
  const created = await prisma.operationCaisse.create({
    data: { ...toDbFields(enriched, numeroPiece), ...approval },
  });

  await ensureJournalMirrorFromCaisse(created.id);

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "CREATE",
    entity: "OperationCaisse",
    entityId: created.id,
    details: ceoPending
      ? `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA · En attente CEO`
      : `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA`,
  });

  if (ceoPending) {
    await syncSignatureForCaisseOperation(created.id, {
      id: guard.id,
      nom: guard.nom,
    });
  }

  revalidatePath("/caisse");
  revalidatePath("/journal");
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/tresorerie");
  revalidatePath("/budget");
  revalidatePath("/codes-budgetaires");
  revalidatePath("/approbations");
  revalidatePath("/signatures");

  return ceoPending
    ? {
        ok: true,
        message:
          "Opération enregistrée. En attente d'approbation CEO avant impact sur le solde caisse.",
      }
    : { ok: true };
}

export async function updateOperationCaisse(
  id: string,
  input: OperationInput
): Promise<OpResult> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const params = await prisma.parametre.findFirst();
  if (!params) return { ok: false, error: "Paramètres non configurés." };

  const categorie = await prisma.categorie.findUnique({
    where: { id: input.categorieId },
  });
  if (!categorie) return { ok: false, error: "Catégorie introuvable." };

  const existing = await prisma.operationCaisse.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Opération introuvable." };

  const montantInchange = montantOperationInchange(existing, input);
  const ceoPending =
    needsCeoApproval(input.montant, params.seuilDoubleValidation) &&
    !montantInchange;

  let soldeAvant = params.soldeInitialCaisse;
  const ops = await prisma.operationCaisse.findMany({
    where: whereOperationApprouvee,
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  for (const op of ops) {
    if (op.id === id) break;
    soldeAvant += (op.entree ?? 0) - (op.sortie ?? 0);
  }

  const enriched = { ...input, categorieNom: categorie.nom, validePar: "" };
  const err = validateOperation(enriched, params.seuilDoubleValidation, {
    checkCaisseBalance:
      !ceoPending && input.montantType === "sortie" ? soldeAvant : undefined,
    skipValidePar: montantInchange && existing.statutApprobation === "APPROUVE",
    ceoApprovalPending: ceoPending,
  });
  if (err) return { ok: false, error: err };

  const approvalUpdate = approvalFieldsForUpdate(
    input.montant,
    params.seuilDoubleValidation,
    existing,
    input,
    guard.nom,
    montantInchange
  );

  await prisma.operationCaisse.update({
    where: { id },
    data: {
      ...toDbFields(enriched, existing.numeroPiece),
      ...approvalUpdate,
    },
  });

  await ensureJournalMirrorFromCaisse(id);

  await syncSignatureForCaisseOperation(id, {
    id: guard.id,
    nom: guard.nom,
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "UPDATE",
    entity: "OperationCaisse",
    entityId: id,
    details: `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA`,
  });

  revalidatePath("/caisse");
  revalidatePath("/journal");
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/tresorerie");
  revalidatePath("/budget");
  revalidatePath("/codes-budgetaires");
  revalidatePath("/approbations");
  revalidatePath("/signatures");

  return ceoPending
    ? { ok: true, message: "Modification enregistrée. Approbation CEO requise." }
    : { ok: true };
}

export async function deleteOperationCaisse(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const existing = await prisma.operationCaisse.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Opération introuvable." };

  await deleteCaisseAndJournalMirror(id);

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "DELETE",
    entity: "OperationCaisse",
    entityId: id,
    details: existing.libelle,
  });

  revalidatePath("/caisse");
  revalidatePath("/journal");
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/tresorerie");
  revalidatePath("/budget");
  revalidatePath("/codes-budgetaires");
  revalidatePath("/approbations");
  revalidatePath("/signatures");
  return { ok: true };
}
