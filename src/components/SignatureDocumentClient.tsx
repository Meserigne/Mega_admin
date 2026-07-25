"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, FileText, Share2 } from "lucide-react";
import {
  cancelEnvelope,
  deleteEnvelope,
  refuseEnvelopeDocument,
  signEnvelopeDocument,
  type EnvelopeDetail,
} from "@/app/actions/signature-docs";
import { PdfPageViewer } from "@/components/PdfPageViewer";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";
import { usePermissions } from "@/components/PermissionsProvider";
import {
  Alert,
  Button,
  Card,
  Input,
  PageHeader,
} from "@/components/ui";
import { stashShareSource } from "@/lib/signature-share-handoff";
import { composeSignatureReturnStamp } from "@/lib/signature-image";

function isVisualValeur(valeur: string | null | undefined) {
  return Boolean(valeur?.startsWith("data:image/"));
}

function SignedDocumentPreview({
  detail,
}: {
  detail: EnvelopeDetail;
}) {
  const isPdf = Boolean(detail.fichierMime?.includes("pdf"));
  const isImage = Boolean(detail.fichierMime?.startsWith("image/"));
  const src = detail.downloadHref;
  const pageRef = useRef<HTMLDivElement>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    "portrait"
  );
  const [pageBox, setPageBox] = useState<{ w: number; h: number } | null>(null);
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  // Dimensionne la page selon portrait / paysage
  useEffect(() => {
    function measure() {
      const el = pageRef.current?.parentElement;
      if (!el) return;
      const availW = Math.max(el.clientWidth - 8, 280);

      if (isImage && natural) {
        const ratio = natural.w / Math.max(natural.h, 1);
        if (orientation === "landscape") {
          const w = Math.min(availW, 960);
          const h = Math.round(w / Math.max(ratio, 1.05));
          setPageBox({ w, h: Math.max(h, 200) });
        } else {
          const w = Math.min(availW, 720);
          const h = Math.round(w / Math.min(ratio, 0.95));
          setPageBox({ w, h: Math.max(h, 320) });
        }
        return;
      }

      if (isPdf) {
        const ratio =
          natural && natural.w > 0 && natural.h > 0
            ? natural.w / natural.h
            : orientation === "landscape"
              ? 297 / 210
              : 210 / 297;
        if (orientation === "landscape") {
          const w = Math.min(availW, 960);
          const h = Math.round(w / Math.max(ratio, 1.05));
          setPageBox({ w, h: Math.max(h, 280) });
        } else {
          const w = Math.min(availW, 720);
          const h = Math.round(w / Math.min(ratio, 0.95));
          setPageBox({ w, h: Math.max(h, 400) });
        }
      }
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [isPdf, isImage, orientation, natural]);

  // Détecte automatiquement le format du PDF (1re page)
  useEffect(() => {
    if (!isPdf || !src) return;
    let cancelled = false;
    async function detectPdfOrientation() {
      try {
        const { PDFDocument } = await import("pdf-lib");
        const res = await fetch(src, { credentials: "include" });
        if (!res.ok) return;
        const bytes = await res.arrayBuffer();
        if (cancelled) return;
        const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
        const page = pdf.getPages()[0];
        if (!page) return;
        const { width, height } = page.getSize();
        if (cancelled) return;
        setNatural({ w: width, h: height });
        setOrientation(width >= height ? "landscape" : "portrait");
      } catch {
        // garde le défaut portrait
      }
    }
    void detectPdfOrientation();
    return () => {
      cancelled = true;
    };
  }, [isPdf, src]);

  return (
    <div className="mt-5 rounded-lg border border-[var(--border)] bg-[var(--c-stone-100)] p-3 sm:p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-slate-500">
          Affichage adapté automatiquement ·{" "}
          <span className="font-medium text-slate-700">
            {orientation === "portrait" ? "Portrait" : "Paysage"}
          </span>
        </p>
        <div className="flex gap-1 rounded-lg border border-slate-200 bg-white p-0.5">
          <button
            type="button"
            onClick={() => setOrientation("portrait")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              orientation === "portrait"
                ? "bg-[var(--c-blue-700)] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Portrait
          </button>
          <button
            type="button"
            onClick={() => setOrientation("landscape")}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              orientation === "landscape"
                ? "bg-[var(--c-blue-700)] text-white"
                : "text-slate-600 hover:bg-slate-50"
            }`}
          >
            Paysage
          </button>
        </div>
      </div>

      <div className="max-h-[80vh] overflow-auto">
        <div
          className="mx-auto flex justify-center"
          style={{
            maxWidth: orientation === "landscape" ? "960px" : "720px",
          }}
        >
          <div
            ref={pageRef}
            className="relative bg-white shadow-md"
            style={
              pageBox
                ? {
                    width: pageBox.w,
                    height: pageBox.h,
                    minHeight: pageBox.h,
                  }
                : {
                    width: "100%",
                    minHeight: orientation === "landscape" ? 420 : 560,
                  }
            }
          >
            {isImage && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt={detail.fichierNom}
                className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                onLoad={(e) => {
                  const img = e.currentTarget;
                  const w = img.naturalWidth || img.width;
                  const h = img.naturalHeight || img.height;
                  if (w > 0 && h > 0) {
                    setNatural({ w, h });
                    setOrientation(w >= h ? "landscape" : "portrait");
                  }
                }}
              />
            )}
            {isPdf && pageBox && (
              <PdfPageViewer
                url={src}
                width={pageBox.w}
                height={pageBox.h}
                onPageSize={(size) => {
                  setNatural((prev) => {
                    if (
                      prev &&
                      Math.abs(prev.w - size.w) < 0.5 &&
                      Math.abs(prev.h - size.h) < 0.5
                    ) {
                      return prev;
                    }
                    return size;
                  });
                  setOrientation(size.w >= size.h ? "landscape" : "portrait");
                }}
              />
            )}
            {isPdf && !pageBox && (
              <div className="flex h-full items-center justify-center text-sm text-slate-500">
                Chargement de l&apos;aperçu…
              </div>
            )}
            {!isImage && !isPdf && (
              <div className="flex h-full flex-col items-center justify-center p-8 text-center">
                <FileText className="h-8 w-8 text-slate-400" />
                <p className="mt-2 font-medium">{detail.fichierNom}</p>
                <p className="mt-1 text-sm text-slate-500">
                  Utilisez « PDF certifié + audit » pour télécharger le document
                  final.
                </p>
              </div>
            )}

            {detail.annotations.map((a) => (
              <div
                key={a.id}
                className="pointer-events-none absolute z-[2] flex items-center justify-center bg-transparent"
                style={{
                  left: `${a.posX * 100}%`,
                  top: `${a.posY * 100}%`,
                  width: `${a.largeur * 100}%`,
                  height: `${a.hauteur * 100}%`,
                }}
              >
                {isVisualValeur(a.valeur) ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={a.valeur!}
                    alt={a.type}
                    className="h-full w-full bg-transparent object-contain"
                  />
                ) : (
                  <span className="px-1 text-sm font-semibold text-slate-900 [text-shadow:0_0_3px_#fff,0_0_6px_#fff]">
                    {a.valeur}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[11px] text-slate-500">
        Le format s&apos;adapte au document (portrait / paysage). Les
        signatures restent alignées sur la page.
      </p>
    </div>
  );
}

export function SignatureDocumentClient({
  detail,
  savedSignature,
}: {
  detail: EnvelopeDetail;
  savedSignature: string | null;
}) {
  const router = useRouter();
  const { user } = usePermissions();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signOpen, setSignOpen] = useState(false);
  const [motif, setMotif] = useState("");

  const meCanSign = detail.destinataires.some((d) => d.canSignNow);
  const signedHref = `${detail.downloadHref}?signed=1`;
  const shareHref = `/signatures/nouveau?from=${encodeURIComponent(detail.id)}`;

  function goShareForSignatures() {
    stashShareSource({
      id: detail.id,
      titre: detail.titre,
      fichierNom: detail.fichierNom,
      fichierMime: detail.fichierMime,
      downloadHref: detail.downloadHref,
    });
    router.push(shareHref);
  }

  async function handleSignApply(image: string) {
    setError(null);
    setLoading(true);
    try {
      const stamp = await composeSignatureReturnStamp({
        signatureImage: image,
        label: user?.nom?.trim() || "Signataire",
        variant: "signature",
      });
      const r = await signEnvelopeDocument(detail.id, stamp);
      if (!r.ok) {
        throw new Error(r.error);
      }
      setSuccess(
        "Signature enregistrée. Le document passe au prochain signataire (ou revient à l'initiateur)."
      );
      router.refresh();
    } finally {
      setLoading(false);
    }
  }

  async function handleRefuse() {
    setError(null);
    setLoading(true);
    const r = await refuseEnvelopeDocument(detail.id, motif);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSuccess("Document refusé.");
    router.refresh();
  }

  async function handleCancel() {
    setError(null);
    setLoading(true);
    const r = await cancelEnvelope(detail.id);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/signatures");
    router.refresh();
  }

  async function handleDelete() {
    if (
      !window.confirm(
        `Mettre « ${detail.titre} » à la corbeille ?\nRécupérable pendant 30 jours.`
      )
    ) {
      return;
    }
    setError(null);
    setLoading(true);
    const r = await deleteEnvelope(detail.id);
    setLoading(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.push("/signatures");
    router.refresh();
  }

  return (
    <div>
      <PageHeader
        title={detail.titre}
        description={detail.objet ?? "Parcours de signature électronique"}
      >
        <Link href="/signatures">
          <Button variant="secondary">Retour</Button>
        </Link>
      </PageHeader>

      {error && <Alert type="error">{error}</Alert>}
      {success && (
        <div className="mb-4">
          <Alert type="success">{success}</Alert>
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            detail.statut === "COMPLETE"
              ? "bg-[var(--c-sage-100)] text-[var(--c-sage-700)]"
              : detail.statut === "EN_COURS"
                ? "bg-[var(--c-amber-100)] text-[var(--c-amber-700)]"
                : "bg-slate-100 text-slate-600"
          }`}
        >
          {detail.statutLabel}
        </span>
        {detail.ordreObligatoire && (
          <span className="text-xs text-slate-500">
            Signature dans l&apos;ordre obligatoire
          </span>
        )}
        {loading && (
          <span className="text-xs text-slate-500">Enregistrement…</span>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Card className="p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-lg bg-[var(--c-blue-50)]">
                <FileText className="h-5 w-5 text-[var(--c-blue-700)]" />
              </div>
              <div>
                <p className="font-medium">{detail.fichierNom}</p>
                <p className="text-sm text-slate-500">
                  Émis par {detail.createurNom}
                  {detail.envoyeAt &&
                    ` · ${new Date(detail.envoyeAt).toLocaleString("fr-FR")}`}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={signedHref} target="_blank" rel="noreferrer">
                <Button variant="secondary" className="gap-1.5">
                  <Download className="h-4 w-4" />
                  {detail.statut === "COMPLETE"
                    ? "PDF certifié + audit"
                    : "Ouvrir le document signé"}
                </Button>
              </a>
            </div>
          </div>

          {detail.statut === "COMPLETE" && (
            <div className="mt-4">
              <Alert type="info">
                Document certifié par MEGA Signature : contenu figé (non
                modifiable), avec une page de rapport d&apos;audit en dernière
                page du PDF — sans mot de passe à saisir.
              </Alert>
            </div>
          )}

          <SignedDocumentPreview detail={detail} />

          {detail.message && (
            <div className="mt-5 rounded-lg bg-[var(--c-stone-50)] p-4 text-sm text-slate-700">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Message
              </p>
              <p className="mt-1 whitespace-pre-wrap">{detail.message}</p>
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Button className="gap-1.5" onClick={goShareForSignatures}>
              <Share2 className="h-4 w-4" />
              Demander des signatures électroniques
            </Button>
            <Link href="/signatures/nouveau">
              <Button variant="secondary">Nouveau document à partager</Button>
            </Link>
          </div>

          {meCanSign && (
            <div className="mt-6 flex flex-wrap gap-3">
              <Button onClick={() => setSignOpen(true)}>
                Signer ce document
              </Button>
              <div className="flex flex-1 flex-wrap items-end gap-2">
                <Input
                  label="Motif de refus (optionnel)"
                  value={motif}
                  onChange={(e) => setMotif(e.target.value)}
                  className="min-w-[200px] flex-1"
                />
                <Button variant="danger" onClick={handleRefuse}>
                  Refuser
                </Button>
              </div>
            </div>
          )}

          {detail.canCancel && (
            <div className="mt-4">
              <Button variant="secondary" onClick={handleCancel}>
                Annuler le parcours
              </Button>
            </div>
          )}

          {detail.canDelete && (
            <div className="mt-4">
              <Button
                variant="danger"
                disabled={loading}
                onClick={handleDelete}
              >
                Supprimer le document
              </Button>
            </div>
          )}
        </Card>

        <Card className="h-fit p-5">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Destinataires
          </p>
          <ol className="mt-3 space-y-3">
            {detail.destinataires.map((d) => (
              <li
                key={d.id}
                className={`rounded-lg border px-3 py-2.5 text-sm ${
                  d.isMe
                    ? "border-[var(--c-blue-300)] bg-[var(--c-blue-50)]"
                    : "border-[var(--border)]"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {d.ordre}. {d.nom}
                    </p>
                    <p className="text-xs text-slate-500">{d.email}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {d.roleLabel}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs font-medium text-slate-600">
                    {d.statutLabel}
                  </span>
                </div>
                {d.signeAt && (
                  <p className="mt-1 text-[11px] text-slate-400">
                    {new Date(d.signeAt).toLocaleString("fr-FR")}
                  </p>
                )}
              </li>
            ))}
          </ol>

          {detail.annotations.length > 0 && (
            <div className="mt-5 border-t border-[var(--border)] pt-4">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Annotations ({detail.annotations.length})
              </p>
              <ul className="mt-2 space-y-2">
                {detail.annotations.map((a) => (
                  <li
                    key={a.id}
                    className="rounded-md border border-[var(--border)] bg-white px-2 py-1.5 text-xs"
                  >
                    <span className="font-medium">{a.type}</span>
                    {isVisualValeur(a.valeur) ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={a.valeur!}
                        alt=""
                        className="mt-1 max-h-10 bg-transparent"
                      />
                    ) : a.valeur ? (
                      <span className="ml-1 text-slate-600">{a.valeur}</span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      <SignatureCaptureModal
        open={signOpen}
        onClose={() => setSignOpen(false)}
        onApply={handleSignApply}
        defaultName={user?.nom ?? ""}
        title="Signature électronique"
        savedSignature={savedSignature}
        allowSave
      />
    </div>
  );
}
