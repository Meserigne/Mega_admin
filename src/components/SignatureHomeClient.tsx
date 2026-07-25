"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  CheckCircle2,
  FileSignature,
  PenLine,
  RotateCcw,
  Send,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import {
  deleteEnvelope,
  purgeEnvelope,
  restoreEnvelope,
  type EnvelopeListItem,
} from "@/app/actions/signature-docs";
import { SIGNATURE_TRASH_DAYS } from "@/lib/signature-docs";
import { Alert, Button, Card, DataTable, PageHeader } from "@/components/ui";

function statusClass(statut: string) {
  if (statut === "COMPLETE") return "text-[var(--c-sage-700)]";
  if (statut === "REFUSE" || statut === "ANNULE") return "text-[var(--c-clay-700)]";
  if (statut === "EN_COURS") return "text-[var(--c-amber-700)]";
  return "text-slate-600";
}

export function SignatureHomeClient({
  envelopes,
  trash = [],
}: {
  envelopes: EnvelopeListItem[];
  trash?: EnvelopeListItem[];
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const aSigner = envelopes.filter(
    (e) => e.role === "signataire" && e.monStatut === "A_SIGNER"
  );
  const enCours = envelopes.filter((e) => e.statut === "EN_COURS");

  async function handleDelete(e: EnvelopeListItem) {
    if (e.role !== "createur") return;
    const ok = window.confirm(
      `Mettre « ${e.titre} » à la corbeille ?\nRécupérable pendant ${SIGNATURE_TRASH_DAYS} jours.`
    );
    if (!ok) return;
    setError(null);
    setSuccess(null);
    setBusyId(e.id);
    const result = await deleteEnvelope(e.id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess("Document mis à la corbeille.");
    router.refresh();
  }

  async function handleRestore(e: EnvelopeListItem) {
    setError(null);
    setSuccess(null);
    setBusyId(e.id);
    const result = await restoreEnvelope(e.id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess(`« ${e.titre} » restauré.`);
    setShowTrash(false);
    router.refresh();
  }

  async function handlePurge(e: EnvelopeListItem) {
    const ok = window.confirm(
      `Supprimer définitivement « ${e.titre} » ?\nCette action est irréversible.`
    );
    if (!ok) return;
    setError(null);
    setSuccess(null);
    setBusyId(e.id);
    const result = await purgeEnvelope(e.id);
    setBusyId(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setSuccess("Document supprimé définitivement.");
    router.refresh();
  }

  return (
    <div>
      <PageHeader
        title="Signature"
        description="Outil de signature électronique : éditez, paraphez, datez et partagez vos documents avec qui vous voulez"
      />

      {error && (
        <div className="mb-4">
          <Alert type="error">{error}</Alert>
        </div>
      )}
      {success && (
        <div className="mb-4">
          <Alert type="success">{success}</Alert>
        </div>
      )}

      <div className="mb-8 grid gap-4 lg:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--border)] bg-[var(--c-blue-50)] px-6 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--c-blue-700)]">
              Recueillir des signatures
            </p>
          </div>
          <div className="p-6">
            <Link
              href="/signatures/nouveau"
              className="group flex items-start gap-4 rounded-xl border border-[var(--border)] bg-white p-5 transition hover:border-[var(--c-blue-400)] hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--c-blue-800)] text-white">
                <Send className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-[var(--foreground)] group-hover:text-[var(--c-blue-800)]">
                  Demander des signatures électroniques
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Envoyez un PDF ou Word à n&apos;importe qui pour signature en
                  ligne (collègues, partenaires, clients…).
                </p>
              </div>
            </Link>
            <ul className="mt-5 space-y-2.5 text-sm text-[var(--c-stone-600)]">
              <li className="flex gap-2">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-blue-600)]" />
                Signatures horodatées et tracées
              </li>
              <li className="flex gap-2">
                <FileSignature className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-blue-600)]" />
                Parcours libre ou dans l&apos;ordre que vous choisissez
              </li>
              <li className="flex gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-[var(--c-blue-600)]" />
                Document certifié une fois signé
              </li>
            </ul>
          </div>
        </Card>

        <Card className="overflow-hidden p-0">
          <div className="border-b border-[var(--border)] bg-[var(--c-gold-100)]/40 px-6 py-4">
            <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-[var(--c-blue-800)]">
              Remplir et signer vous-même
            </p>
          </div>
          <div className="space-y-4 p-6">
            <Link
              href="/signatures/editer"
              className="group flex items-start gap-4 rounded-xl border border-[var(--border)] bg-white p-5 transition hover:border-[var(--c-gold-400)] hover:shadow-md"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[var(--c-gold-500)] text-[var(--c-blue-950)]">
                <PenLine className="h-5 w-5" />
              </div>
              <div>
                <p className="font-semibold text-[var(--foreground)]">
                  Éditer et signer un document
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  Ajoutez votre signature, un paraphe, une date ou du texte, puis
                  enregistrez une copie certifiée.
                </p>
              </div>
            </Link>

            {aSigner.length > 0 && (
              <div className="rounded-xl border border-[var(--border)] bg-[var(--c-stone-50)] p-4">
                <p className="text-sm font-medium">
                  {aSigner.length} document
                  {aSigner.length > 1 ? "s" : ""} à signer
                </p>
                <div className="mt-3 space-y-2">
                  {aSigner.slice(0, 4).map((e) => (
                    <Link
                      key={e.id}
                      href={`/signatures/${e.id}`}
                      className="flex items-center justify-between rounded-lg border border-[var(--border)] bg-white px-3 py-2.5 text-sm hover:border-[var(--c-gold-400)]"
                    >
                      <span className="truncate font-medium">{e.titre}</span>
                      <span className="shrink-0 text-xs text-[var(--c-blue-700)]">
                        Signer →
                      </span>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            <Link
              href="/profil"
              className="inline-flex w-full items-center justify-center rounded-md border border-[var(--border-strong)] bg-[var(--card)] px-4 py-2.5 text-sm font-medium shadow-xs hover:border-[var(--c-blue-400)]"
            >
              Gérer ma signature &amp; paraphe
            </Link>
          </div>
        </Card>
      </div>

      <div className="mb-4 flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-[var(--foreground)]">
            {showTrash ? "Corbeille" : "Mes documents"}
          </h2>
          <p className="text-sm text-[var(--muted)]">
            {showTrash
              ? `${trash.length} document${trash.length > 1 ? "s" : ""} · restitution pendant ${SIGNATURE_TRASH_DAYS} jours`
              : `${enCours.length} en cours · ${envelopes.length} au total`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="secondary"
            className="gap-1.5"
            onClick={() => setShowTrash((v) => !v)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showTrash ? "Documents actifs" : `Corbeille${trash.length ? ` (${trash.length})` : ""}`}
          </Button>
          {!showTrash && (
            <>
              <Link href="/signatures/editer">
                <Button variant="secondary">Éditer &amp; signer</Button>
              </Link>
              <Link href="/signatures/nouveau">
                <Button>Partager pour signature</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      <Card className="overflow-hidden p-0">
        <DataTable>
          <thead>
            <tr>
              <th>Document</th>
              <th>Émetteur</th>
              <th>{showTrash ? "Supprimé le" : "Progression"}</th>
              <th>Statut</th>
              <th>Rôle</th>
              <th className="text-right">Action</th>
            </tr>
          </thead>
          <tbody>
            {(showTrash ? trash : envelopes).length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                  {showTrash
                    ? "Corbeille vide."
                    : "Aucun document. Éditez un fichier ou demandez une signature."}
                </td>
              </tr>
            )}
            {(showTrash ? trash : envelopes).map((e) => (
              <tr key={e.id}>
                <td>
                  <p className="max-w-[220px] truncate font-medium">{e.titre}</p>
                  <p className="text-xs text-slate-500">{e.fichierNom}</p>
                </td>
                <td className="text-sm">{e.createurNom}</td>
                <td className="text-sm tabular-nums">
                  {showTrash
                    ? e.deletedAt
                      ? new Date(e.deletedAt).toLocaleDateString("fr-FR")
                      : "—"
                    : `${e.signesCount}/${e.destCount || 1}`}
                </td>
                <td className={`text-sm font-medium ${statusClass(e.statut)}`}>
                  {showTrash ? "Corbeille" : e.statutLabel}
                </td>
                <td className="text-xs uppercase text-slate-500">
                  {e.role === "createur" ? "Émetteur" : "Signataire"}
                  {!showTrash && e.monStatut === "A_SIGNER" && (
                    <span className="ml-1 text-[var(--c-amber-700)]">
                      · à signer
                    </span>
                  )}
                </td>
                <td className="text-right">
                  <div className="inline-flex items-center justify-end gap-2">
                    {showTrash ? (
                      <>
                        <Button
                          type="button"
                          variant="secondary"
                          className="gap-1 px-2.5 py-1.5 text-xs"
                          disabled={busyId === e.id}
                          onClick={() => handleRestore(e)}
                          title="Restaurer"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          {busyId === e.id ? "…" : "Restaurer"}
                        </Button>
                        <Button
                          type="button"
                          variant="danger"
                          className="gap-1 px-2.5 py-1.5 text-xs"
                          disabled={busyId === e.id}
                          onClick={() => handlePurge(e)}
                          title="Supprimer définitivement"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Définitif
                        </Button>
                      </>
                    ) : (
                      <>
                        <Link href={`/signatures/${e.id}`}>
                          <Button
                            variant="secondary"
                            className="px-3 py-1.5 text-xs"
                          >
                            Ouvrir
                          </Button>
                        </Link>
                        {e.role === "createur" && (
                          <Button
                            type="button"
                            variant="danger"
                            className="gap-1 px-2.5 py-1.5 text-xs"
                            disabled={busyId === e.id}
                            onClick={() => handleDelete(e)}
                            title="Mettre à la corbeille"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            {busyId === e.id ? "…" : "Supprimer"}
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      </Card>
    </div>
  );
}
