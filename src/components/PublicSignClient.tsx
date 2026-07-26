"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Ban,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  Flag,
  History,
  MoreHorizontal,
  Search,
  Trash2,
  UserPlus,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  refusePublicSignature,
  submitPublicSignature,
  type PublicSignSession,
} from "@/app/actions/signature-public";
import { SignatureCaptureModal } from "@/components/SignatureCaptureModal";
import { MegaLogo } from "@/components/MegaLogo";
import { PdfPageViewer } from "@/components/PdfPageViewer";
import {
  composeSignatureReturnStamp,
  initialsFromName,
} from "@/lib/signature-image";

const ACCENT = "#2563eb";

function fieldLabel(type: string) {
  const t = type.toUpperCase();
  if (t === "SIGNATURE" || t === "BLOC_SIGNATURE") return "Click to Sign";
  if (t === "PARAPHE" || t === "INITIALES") return "Initials";
  if (t === "DATE") return "Date";
  if (t === "TEXTE") return "Text";
  return type;
}

export function PublicSignClient({ session }: { session: PublicSignSession }) {
  const router = useRouter();
  const stageRef = useRef<HTMLDivElement>(null);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const c of session.champs) {
      if (c.mine && c.valeur) init[c.id] = c.valeur;
    }
    return init;
  });
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [activeFieldId, setActiveFieldId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [refuseOpen, setRefuseOpen] = useState(false);
  const [refuseMotif, setRefuseMotif] = useState("");
  const [pageBox, setPageBox] = useState<{ w: number; h: number }>({
    w: 720,
    h: 1018,
  });
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const isImage = Boolean(session.fichierMime?.startsWith("image/"));
  const isPdf =
    Boolean(session.fichierMime?.includes("pdf")) ||
    session.fichierNom.toLowerCase().endsWith(".pdf");

  // Détecte le format réel du PDF / image via PdfPageViewer.onPageSize

  // Dimensionne la page pour remplir la zone visible
  useEffect(() => {
    function measure() {
      const stage = stageRef.current;
      if (!stage) return;
      const availW = Math.max(stage.clientWidth - 48, 280);
      const availH = Math.max(stage.clientHeight - 48, 320);
      const ratio =
        natural && natural.w > 0 && natural.h > 0
          ? natural.w / natural.h
          : isImage
            ? 210 / 297
            : 210 / 297;

      let w = availW;
      let h = w / ratio;
      if (h > availH) {
        h = availH;
        w = h * ratio;
      }
      const finalW = Math.round(Math.min(w, 960));
      const finalH = Math.round(finalW / ratio);
      setPageBox((prev) => {
        if (Math.abs(prev.w - finalW) < 3 && Math.abs(prev.h - finalH) < 3) {
          return prev;
        }
        return { w: finalW, h: finalH };
      });
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [natural, isImage]);

  const myRequired = useMemo(
    () =>
      session.champs.filter((c) => {
        if (!c.mine) return false;
        const t = c.type.toUpperCase();
        return (
          t === "SIGNATURE" ||
          t === "BLOC_SIGNATURE" ||
          t === "PARAPHE" ||
          t === "INITIALES" ||
          t === "TEXTE" ||
          t === "DATE"
        );
      }),
    [session.champs]
  );

  const remaining = myRequired.filter(
    (c) => !(values[c.id] || c.valeur)?.trim()
  ).length;
  const readyToSubmit = session.canSign && remaining === 0;

  const activeField = session.champs.find((c) => c.id === activeFieldId);
  const captureVariant =
    activeField?.type.toUpperCase() === "INITIALES" ||
    activeField?.type.toUpperCase() === "PARAPHE"
      ? "initiales"
      : "signature";

  async function handleSubmit() {
    setError(null);
    setSubmitting(true);
    try {
      const primary =
        Object.values(values).find((v) => v.startsWith("data:image/")) || null;
      const result = await submitPublicSignature(
        session.token,
        values,
        primary
      );
      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push(`/sign/${session.token}/merci`);
    } catch (e) {
      // Ne pas masquer une vraie erreur : vérifier si la signature est déjà enregistrée
      console.error("[PublicSignClient] submit", e);
      setError(
        "La signature a peut‑être été enregistrée, mais la confirmation a échoué. Rechargez la page ou contactez l’émetteur."
      );
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRefuse() {
    setError(null);
    setSubmitting(true);
    const result = await refusePublicSignature(session.token, refuseMotif);
    setSubmitting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setRefuseOpen(false);
    router.refresh();
  }

  if (session.refused) {
    return (
      <Shell titre={session.titre}>
        <Centered>
          <X className="mx-auto h-14 w-14 text-red-500" />
          <h1 className="mt-4 text-2xl font-semibold">Signature refusée</h1>
          <p className="mt-2 text-slate-600">
            Ce document a été refusé et n&apos;est plus disponible pour
            signature.
          </p>
        </Centered>
      </Shell>
    );
  }

  if (session.alreadySigned || session.completed) {
    return (
      <Shell titre={session.titre}>
        <Centered>
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-600">
            <Check className="h-9 w-9 text-white" strokeWidth={3} />
          </div>
          <h1 className="mt-6 text-3xl font-semibold text-slate-900">
            You&apos;re all set!
          </h1>
          <p className="mt-3 text-slate-600">
            You finished signing &apos;{session.titre}&apos;.
          </p>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            We will send the final agreement to all parties. You can also{" "}
            <a
              href={session.signedPdfUrl}
              className="font-medium text-blue-600 underline"
              target="_blank"
              rel="noreferrer"
            >
              download a copy
            </a>{" "}
            of what you just signed.
          </p>
        </Centered>
      </Shell>
    );
  }

  const fields = session.champs.filter(
    (c) => c.mine || c.valeur || values[c.id]
  );

  return (
    <div className="flex h-dvh w-full min-w-0 flex-col bg-[#e8eaed] text-slate-900">
      <header className="relative z-40 flex h-14 w-full shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 sm:px-4">
        <MegaLogo width={108} />
        <div className="mx-auto flex min-w-0 flex-1 items-center justify-center gap-2 px-2 text-sm font-medium text-slate-700">
          <span className="truncate">
            {session.titre || session.fichierNom}
          </span>
        </div>
        <div className="relative flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={() => setOptionsOpen((o) => !o)}
            className="inline-flex items-center gap-1 rounded-md px-2.5 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Options
            <ChevronDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Recherche"
          >
            <Search className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
            aria-label="Plus"
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>

          {optionsOpen && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-40 cursor-default"
                aria-label="Fermer"
                onClick={() => setOptionsOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-72 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl">
                <div className="border-b border-slate-100 px-4 py-3">
                  <p className="truncate text-sm font-semibold">
                    {session.fichierNom}
                  </p>
                  <p className="mt-0.5 text-xs uppercase tracking-wide text-slate-500">
                    From {session.createurNom}
                  </p>
                  {session.message && (
                    <p className="mt-2 text-xs text-slate-600">
                      {session.message}
                    </p>
                  )}
                </div>
                <ul className="py-1 text-sm">
                  <OptItem
                    icon={<Ban className="h-4 w-4" />}
                    label="Decline to sign"
                    onClick={() => {
                      setOptionsOpen(false);
                      setRefuseOpen(true);
                    }}
                  />
                  <OptItem
                    icon={<UserPlus className="h-4 w-4" />}
                    label="Delegate signing to another"
                    disabled
                  />
                  <OptItem
                    icon={<Trash2 className="h-4 w-4" />}
                    label="Clear document data"
                    onClick={() => {
                      setValues({});
                      setOptionsOpen(false);
                    }}
                  />
                  <OptItem
                    icon={<Download className="h-4 w-4" />}
                    label="Download PDF"
                    onClick={() => {
                      window.open(session.documentUrl, "_blank");
                      setOptionsOpen(false);
                    }}
                  />
                  <OptItem
                    icon={<History className="h-4 w-4" />}
                    label="View document history"
                    disabled
                  />
                  <OptItem
                    icon={<Flag className="h-4 w-4" />}
                    label="Report abuse"
                    disabled
                  />
                </ul>
              </div>
            </>
          )}
        </div>
      </header>

      <div className="relative flex min-h-0 w-full flex-1">
        <div
          ref={stageRef}
          className="flex min-w-0 flex-1 items-start justify-center overflow-auto bg-[#525659] px-4 py-6"
        >
          <div
            className="relative shrink-0 origin-top bg-white shadow-2xl"
            style={{
              width: pageBox.w * zoom,
              height: pageBox.h * zoom,
            }}
          >
            <div
              className="absolute left-0 top-0 overflow-hidden bg-white"
              style={{
                width: pageBox.w,
                height: pageBox.h,
                transform: `scale(${zoom})`,
                transformOrigin: "top left",
              }}
            >
              {isImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.documentUrl}
                  alt={session.fichierNom}
                  className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                  onLoad={(e) => {
                    const img = e.currentTarget;
                    const w = img.naturalWidth || img.width;
                    const h = img.naturalHeight || img.height;
                    if (w > 0 && h > 0) setNatural({ w, h });
                  }}
                />
              ) : isPdf ? (
                <PdfPageViewer
                  url={session.documentUrl}
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
                  }}
                />
              ) : (
                <div className="flex h-full items-center justify-center p-6 text-center text-sm text-slate-500">
                  <a
                    className="text-blue-600 underline"
                    href={session.documentUrl}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Télécharger le document
                  </a>
                </div>
              )}

              {fields.map((c) => {
                const filled = values[c.id] || c.valeur;
                const interactive = session.canSign && c.mine && !filled;
                const t = c.type.toUpperCase();
                const isStamp =
                  t === "SIGNATURE" ||
                  t === "BLOC_SIGNATURE" ||
                  t === "PARAPHE" ||
                  t === "INITIALES";
                // Agrandit un peu les petites zones pour le tampon Adobe
                const displayH =
                  filled && isStamp
                    ? Math.max(c.hauteur, 0.11)
                    : Math.max(c.hauteur, interactive && isStamp ? 0.07 : c.hauteur);
                return (
                  <button
                    key={c.id}
                    type="button"
                    disabled={!c.mine || (!interactive && !filled)}
                    onClick={() => {
                      if (!session.canSign || !c.mine) return;
                      if (filled) {
                        setActiveFieldId(c.id);
                        return;
                      }
                      if (t === "DATE") {
                        setValues((v) => ({
                          ...v,
                          [c.id]: new Date().toLocaleDateString("fr-FR"),
                        }));
                        return;
                      }
                      if (t === "TEXTE") {
                        const text = window.prompt("Texte à saisir") || "";
                        if (text.trim()) {
                          setValues((v) => ({ ...v, [c.id]: text.trim() }));
                        }
                        return;
                      }
                      setActiveFieldId(c.id);
                    }}
                    className={`absolute z-[2] rounded-sm border-2 text-left transition ${
                      filled && isStamp ? "overflow-visible" : "overflow-hidden"
                    } ${
                      filled
                        ? "border-blue-300/70 bg-white/80"
                        : interactive
                          ? "cursor-pointer border-blue-500 bg-blue-500/25 shadow-[0_0_0_1px_rgba(37,99,235,.45)]"
                          : "border-transparent"
                    }`}
                    style={{
                      left: `${c.posX * 100}%`,
                      top: `${c.posY * 100}%`,
                      width: `${Math.max(c.largeur, isStamp ? 0.14 : 0.08) * 100}%`,
                      height: `${displayH * 100}%`,
                    }}
                  >
                    {filled?.startsWith("data:image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={filled}
                        alt=""
                        className="h-full w-full object-contain"
                      />
                    ) : filled ? (
                      <span className="flex h-full items-center px-1 text-xs font-medium text-slate-800">
                        {filled}
                      </span>
                    ) : interactive ? (
                      <span className="flex h-full items-center justify-center gap-1 px-1 text-[11px] font-semibold text-blue-800">
                        <span className="text-amber-500">★</span>
                        {fieldLabel(c.type)}
                      </span>
                    ) : null}
                    {filled && session.canSign && c.mine && (
                      <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => {
                          e.stopPropagation();
                          setValues((v) => {
                            const next = { ...v };
                            delete next[c.id];
                            return next;
                          });
                        }}
                        className="absolute right-0.5 top-0.5 rounded bg-white/90 p-0.5 text-slate-500 shadow hover:text-red-600"
                      >
                        <X className="h-3 w-3" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <aside className="hidden w-12 shrink-0 flex-col items-center gap-2 border-l border-slate-200 bg-white py-3 sm:flex">
          <RailBtn
            icon={<ZoomIn className="h-4 w-4" />}
            onClick={() => setZoom((z) => Math.min(1.5, +(z + 0.1).toFixed(2)))}
          />
          <RailBtn
            icon={<ZoomOut className="h-4 w-4" />}
            onClick={() => setZoom((z) => Math.max(0.6, +(z - 0.1).toFixed(2)))}
          />
          <p className="mt-auto px-1 text-center text-[10px] text-slate-400">
            Page
            <br />
            1 / 1
          </p>
        </aside>
      </div>

      <footer
        className="relative z-30 flex w-full shrink-0 items-center justify-between gap-3 px-4 py-3 text-white"
        style={{ background: ACCENT }}
      >
        <div className="flex items-center gap-2">
          <ChevronLeft className="h-5 w-5 opacity-70" />
          <ChevronRight className="h-5 w-5 opacity-70" />
        </div>

        {!readyToSubmit ? (
          <p className="flex-1 text-center text-sm font-medium">
            {remaining} required field{remaining > 1 ? "s" : ""} remaining
          </p>
        ) : (
          <p className="flex-1 text-center text-sm">
            Click submit to sign. By submitting, I agree to the{" "}
            <span className="underline">Consumer Disclosure</span> and to use
            e-signatures.
          </p>
        )}

        {readyToSubmit ? (
          <button
            type="button"
            disabled={submitting}
            onClick={handleSubmit}
            className="rounded-md bg-white px-5 py-2 text-sm font-semibold text-blue-700 shadow hover:bg-blue-50 disabled:opacity-60"
          >
            {submitting ? "…" : "Submit"}
          </button>
        ) : (
          <span className="w-20" />
        )}
      </footer>

      {error && (
        <div className="absolute bottom-20 left-1/2 z-50 max-w-md -translate-x-1/2 rounded-lg bg-red-600 px-4 py-2 text-sm text-white shadow-lg">
          {error}
        </div>
      )}

      <SignatureCaptureModal
        open={Boolean(activeFieldId)}
        onClose={() => setActiveFieldId(null)}
        defaultName={session.destinataire.nom}
        variant={captureVariant}
        allowSave={false}
        title={
          captureVariant === "initiales"
            ? "Créer vos initiales"
            : "Créer une signature"
        }
        onApply={async (image) => {
          if (!activeFieldId) return;
          const field = session.champs.find((c) => c.id === activeFieldId);
          const isInitials =
            captureVariant === "initiales" ||
            field?.type.toUpperCase() === "INITIALES" ||
            field?.type.toUpperCase() === "PARAPHE";
          const stamp = await composeSignatureReturnStamp({
            signatureImage: image,
            label: isInitials
              ? initialsFromName(session.destinataire.nom)
              : session.destinataire.nom,
            variant: isInitials ? "initiales" : "signature",
          });
          setValues((v) => ({ ...v, [activeFieldId]: stamp }));
          setActiveFieldId(null);
        }}
      />

      {refuseOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-semibold">Decline to sign</h2>
            <p className="mt-1 text-sm text-slate-600">
              Indiquez un motif (obligatoire).
            </p>
            <textarea
              className="mt-3 w-full rounded-md border border-slate-300 p-2 text-sm"
              rows={3}
              value={refuseMotif}
              onChange={(e) => setRefuseMotif(e.target.value)}
            />
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setRefuseOpen(false)}
              >
                Annuler
              </button>
              <button
                type="button"
                disabled={submitting}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
                onClick={handleRefuse}
              >
                Refuser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Shell({
  titre,
  children,
}: {
  titre: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-dvh w-full flex-col bg-[#f3f4f6]">
      <header className="flex h-14 w-full items-center gap-3 border-b border-slate-200 bg-white px-4">
        <MegaLogo width={108} />
        <span className="mx-auto truncate text-sm font-medium text-slate-700">
          {titre}
        </span>
      </header>
      {children}
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-4 py-16 text-center">
      {children}
    </div>
  );
}

function OptItem({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className="flex w-full items-center gap-3 px-4 py-2.5 text-left text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <span className="text-slate-500">{icon}</span>
        {label}
      </button>
    </li>
  );
}

function RailBtn({
  icon,
  onClick,
}: {
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-md p-2 text-slate-500 hover:bg-slate-100"
    >
      {icon}
    </button>
  );
}
