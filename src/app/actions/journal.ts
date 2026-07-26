"use server";

import { revalidatePath } from "next/cache";
import {
  TRANSFERT_VERS_CAISSE,
} from "@/lib/constants";
import {
  approvalFieldsForCreate,
  approvalFieldsForUpdate,
  needsCeoApproval,
} from "@/lib/approbation";
import { guardWrite, isGuardError } from "@/lib/auth-guard";
import { logAudit } from "@/lib/audit";
import { nextNumeroPieceBanque } from "@/lib/numero-piece";
import { syncTvaDeclarationMois } from "@/lib/impots";
import { prisma } from "@/lib/prisma";
import { syncSignatureForJournalOperation } from "@/lib/signatures";
import {
  ensureCaisseMirrorFromJournal,
  isCashMode,
} from "@/lib/cash-sync";
import { ensureApprovisionnementCaisse } from "@/lib/transfert-caisse";
import { OperationInput, montantOperationInchange, validateOperation } from "@/lib/validation";

function parseDate(value: string): Date | null {
  if (!value.trim()) return null;
  return new Date(`${value}T00:00:00.000Z`);
}

async function syncTvaForDate(date: Date | null) {
  if (!date) return;
  await syncTvaDeclarationMois(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function toDbFields(input: OperationInput, numeroPiece?: string | null) {
  return {
    date: parseDate(input.date),
    numeroPiece: numeroPiece ?? (input.numeroPiece.trim() || null),
    libelle: input.libelle.trim(),
    categorieId: input.categorieId,
    codeBudgetaireId: input.codeBudgetaireId || null,
    modePaiement: input.modePaiement || null,
    entree: input.montantType === "entree" ? input.montant : null,
    sortie: input.montantType === "sortie" ? input.montant : null,
    tauxTVA: input.tauxTVA && input.tauxTVA > 0 ? input.tauxTVA : 0,
    observations: input.observations.trim() || null,
    validePar: input.validePar.trim() || null,
  };
}

type OpResult =
  | { ok: true; id?: string; message?: string }
  | { ok: false; error: string };

export async function createOperation(input: OperationInput): Promise<OpResult> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const params = await prisma.parametre.findFirst();
  if (!params) return { ok: false, error: "Paramètres non configurés." };

  const categorie = await prisma.categorie.findUnique({
    where: { id: input.categorieId },
  });
  if (!categorie) return { ok: false, error: "Catégorie introuvable." };

  const ceoPending = needsCeoApproval(input.montant, params.seuilDoubleValidation);
  const enriched = { ...input, categorieNom: categorie.nom, validePar: "" };
  const err = validateOperation(enriched, params.seuilDoubleValidation, {
    requireMode: false,
    ceoApprovalPending: ceoPending,
  });
  if (err) return { ok: false, error: err };

  const approval = approvalFieldsForCreate(
    input.montant,
    params.seuilDoubleValidation,
    guard.nom
  );
  const opDate = parseDate(input.date);
  const numeroPiece = await nextNumeroPieceBanque(prisma, opDate);
  const created = await prisma.operation.create({
    data: { ...toDbFields(enriched, numeroPiece), ...approval },
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "CREATE",
    entity: "Operation",
    entityId: created.id,
    details: ceoPending
      ? `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA · En attente CEO`
      : `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA`,
  });

  if (
    categorie.nom === TRANSFERT_VERS_CAISSE &&
    input.montantType === "sortie" &&
    !ceoPending
  ) {
    await ensureApprovisionnementCaisse({
      montant: input.montant,
      date: parseDate(input.date),
      codeBudgetaireId: input.codeBudgetaireId || null,
      libelleJournal: enriched.libelle,
    });
  } else if (isCashMode(enriched.modePaiement)) {
    await ensureCaisseMirrorFromJournal(created.id);
  }

  if ((input.tauxTVA ?? 0) > 0) {
    await syncTvaForDate(opDate);
  }

  if (ceoPending) {
    await syncSignatureForJournalOperation(created.id, {
      id: guard.id,
      nom: guard.nom,
    });
  }

  revalidatePath("/journal");
  revalidatePath("/caisse");
  revalidatePath("/impots");
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
        id: created.id,
        message:
          "Opération enregistrée. Elle est en attente d'approbation par la CEO avant d'être comptabilisée.",
      }
    : { ok: true, id: created.id };
}

export async function updateOperation(
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

  const existing = await prisma.operation.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Opération introuvable." };

  const montantInchange = montantOperationInchange(existing, input);
  const ceoPending =
    needsCeoApproval(input.montant, params.seuilDoubleValidation) &&
    !montantInchange;

  const enriched = { ...input, categorieNom: categorie.nom, validePar: "" };
  const err = validateOperation(enriched, params.seuilDoubleValidation, {
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

  await prisma.operation.update({
    where: { id },
    data: {
      ...toDbFields(enriched, existing.numeroPiece),
      ...approvalUpdate,
    },
  });

  await ensureCaisseMirrorFromJournal(id);

  await syncSignatureForJournalOperation(id, {
    id: guard.id,
    nom: guard.nom,
  });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "UPDATE",
    entity: "Operation",
    entityId: id,
    details: `${enriched.libelle} · ${enriched.montant.toLocaleString("fr-FR")} FCFA`,
  });

  const oldHadTva = (existing.tauxTVA ?? 0) > 0;
  const newHasTva = (input.tauxTVA ?? 0) > 0;
  if (oldHadTva || newHasTva) {
    await syncTvaForDate(existing.date);
    await syncTvaForDate(parseDate(input.date));
  }

  revalidatePath("/journal");
  revalidatePath("/caisse");
  revalidatePath("/impots");
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
        message: "Modification enregistrée. Nouvelle approbation CEO requise.",
      }
    : { ok: true };
}

export async function deleteOperation(
  id: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const guard = await guardWrite();
  if (isGuardError(guard)) return guard;

  const existing = await prisma.operation.findUnique({ where: { id } });
  if (!existing) return { ok: false, error: "Opération introuvable." };

  await prisma.operation.delete({ where: { id } });

  await logAudit({
    userId: guard.id,
    userNom: guard.nom,
    action: "DELETE",
    entity: "Operation",
    entityId: id,
    details: existing.libelle,
  });

  if ((existing.tauxTVA ?? 0) > 0) {
    await syncTvaForDate(existing.date);
  }

  revalidatePath("/journal");
  revalidatePath("/caisse");
  revalidatePath("/impots");
  revalidatePath("/");
  revalidatePath("/finance");
  revalidatePath("/tresorerie");
  revalidatePath("/budget");
  revalidatePath("/codes-budgetaires");
  revalidatePath("/approbations");
  revalidatePath("/signatures");
  return { ok: true };
}
