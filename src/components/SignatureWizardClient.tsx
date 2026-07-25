"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { createAndSendEnvelope, getEnvelopeShareSource } from "@/app/actions/signature-docs";
import { usePermissions } from "@/components/PermissionsProvider";
import { PdfPageViewer } from "@/components/PdfPageViewer";
import { Alert, Button, Input, Select } from "@/components/ui";
import {
  DEST_COLORS,
  FIELD_PALETTE,
  type ChampType,
} from "@/lib/signature-docs";
import {
  filterRememberedContacts,
  rememberContacts,
  type RememberedContact,
} from "@/lib/signature-email-memory";
import {
  clearShareSource,
  readShareSource,
} from "@/lib/signature-share-handoff";

type Dest = { id: string; email: string; nom: string };
type Step = "ajouter" | "preparer" | "envoyer" | "envoye";

type PlacedField = {
  id: string;
  type: ChampType;
  label: string;
  destinataireId: string;
  posX: number;
  posY: number;
  largeur: number;
  hauteur: number;
};

function isSignatureChamp(type: ChampType) {
  return type === "SIGNATURE" || type === "BLOC_SIGNATURE";
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Lecture fichier impossible"));
    reader.readAsDataURL(file);
  });
}

function Stepper({ step }: { step: Step }) {
  const items: { id: Step; label: string }[] = [
    { id: "ajouter", label: "Ajouter" },
    { id: "preparer", label: "Préparer" },
    { id: "envoyer", label: "Envoyer" },
  ];
  const order = ["ajouter", "preparer", "envoyer", "envoye"] as const;
  const currentIdx =
    step === "envoye" ? 2 : order.indexOf(step as "ajouter" | "preparer" | "envoyer");

  return (
    <div className="flex items-center justify-center gap-0">
      {items.map((item, i) => {
        const done = i < currentIdx || step === "envoye";
        const active = i === currentIdx && step !== "envoye";
        return (
          <div key={item.id} className="flex items-center">
            {i > 0 && (
              <div
                className={`mx-1 h-0.5 w-10 sm:w-16 ${
                  done || active ? "bg-[var(--c-blue-600)]" : "bg-slate-200"
                }`}
              />
            )}
            <div className="flex flex-col items-center gap-1">
              <div
                className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold ${
                  done
                    ? "bg-[var(--c-blue-600)] text-white"
                    : active
                      ? "bg-[var(--c-blue-600)] text-white ring-4 ring-[var(--c-blue-100)]"
                      : "bg-slate-200 text-slate-500"
                }`}
              >
                {done ? <Check className="h-4 w-4" /> : i + 1}
              </div>
              <span
                className={`text-xs ${
                  active || done
                    ? "font-semibold text-[var(--c-blue-900)]"
                    : "text-slate-400"
                }`}
              >
                {item.label}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function SignatureWizardClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromId = searchParams.get("from");
  const { user } = usePermissions();
  const [step, setStep] = useState<Step>("ajouter");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [preloadLoading, setPreloadLoading] = useState(false);
  const [preloadProgress, setPreloadProgress] = useState(0);
  const [preloadLabel, setPreloadLabel] = useState("Document prêt");
  const [sentId, setSentId] = useState<string | null>(null);
  const [inviteLinks, setInviteLinks] = useState<
    { email: string; nom: string; url: string }[]
  >([]);
  const [mailConfigured, setMailConfigured] = useState(true);
  const [mailDelivered, setMailDelivered] = useState(false);
  const [mailError, setMailError] = useState<string | null>(null);

  const [ordreObligatoire, setOrdreObligatoire] = useState(true);
  const [dests, setDests] = useState<Dest[]>([
    { id: crypto.randomUUID(), email: "", nom: "" },
  ]);
  const [file, setFile] = useState<File | null>(null);
  /** Document déjà en base : pas de re-téléchargement client */
  const [sourceEnvelopeId, setSourceEnvelopeId] = useState<string | null>(
    fromId
  );
  const [sourceFileName, setSourceFileName] = useState<string | null>(null);
  const [sourceMime, setSourceMime] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewIsBlob, setPreviewIsBlob] = useState(false);
  const [titre, setTitre] = useState("");
  const [objet, setObjet] = useState("");
  const [message, setMessage] = useState(
    "Veuillez vérifier et signer l'accord."
  );
  const [rappel, setRappel] = useState("AUCUN");
  const [activeDestId, setActiveDestId] = useState<string>("");
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    signature: true,
  });
  const [fields, setFields] = useState<PlacedField[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [pendingType, setPendingType] = useState<{
    type: ChampType;
    label: string;
    w: number;
    h: number;
  } | null>(null);
  const dragRef = useRef<{
    id: string;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const resizeRef = useRef<{
    id: string;
    corner: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
    startX: number;
    startY: number;
    orig: PlacedField;
  } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const preloadedFrom = useRef<string | null>(null);
  const MIN_W = 0.06;
  const MIN_H = 0.035;
  const [docNatural, setDocNatural] = useState<{ w: number; h: number } | null>(
    null
  );
  const [docBox, setDocBox] = useState({ w: 720, h: 1018 });
  /** 100 % = document ajusté à la largeur utile (pas le zoom navigateur PDF). */
  const [zoomPct, setZoomPct] = useState(100);
  const [emailSuggestions, setEmailSuggestions] = useState<
    RememberedContact[]
  >([]);
  const [emailFocusId, setEmailFocusId] = useState<string | null>(null);

  const validDests = useMemo(
    () => dests.filter((d) => d.email.trim()),
    [dests]
  );

  const missingSignatureDests = useMemo(
    () =>
      validDests.filter(
        (d) =>
          !fields.some(
            (f) => f.destinataireId === d.id && isSignatureChamp(f.type)
          )
      ),
    [validDests, fields]
  );

  useEffect(() => {
    function measure() {
      const stage = canvasRef.current?.parentElement;
      if (!stage) return;
      const availW = Math.max(stage.clientWidth - 48, 280);
      const ratio =
        docNatural && docNatural.w > 0
          ? docNatural.w / docNatural.h
          : 210 / 297;
      const fitW = Math.min(availW, 860);
      const w = Math.round(fitW * (zoomPct / 100));
      const h = Math.round(w / ratio);
      setDocBox((prev) =>
        Math.abs(prev.w - w) < 3 && Math.abs(prev.h - h) < 3
          ? prev
          : { w, h }
      );
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [docNatural, step, zoomPct]);

  useEffect(() => {
    if (!activeDestId && dests[0]) setActiveDestId(dests[0].id);
  }, [dests, activeDestId]);

  useEffect(() => {
    return () => {
      if (previewIsBlob && previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl, previewIsBlob]);

  // Instantané si on vient de la page document (sessionStorage), sinon fallback API
  useEffect(() => {
    if (!fromId || preloadedFrom.current === fromId) return;
    preloadedFrom.current = fromId;
    let cancelled = false;

    function applyMeta(meta: {
      id: string;
      titre: string;
      fichierNom: string;
      fichierMime: string | null;
      downloadHref: string;
    }) {
      setSourceEnvelopeId(meta.id);
      setSourceFileName(meta.fichierNom);
      setSourceMime(meta.fichierMime);
      setTitre((t) => t || meta.titre || meta.fichierNom.replace(/\.[^.]+$/, ""));
      setObjet(
        (o) =>
          o ||
          `Demande de signature · ${meta.titre || meta.fichierNom.replace(/\.[^.]+$/, "")}`
      );
      if (previewIsBlob && previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewIsBlob(false);
      setPreviewUrl(meta.downloadHref);
      setFile(null);
      setPreloadProgress(100);
      setPreloadLabel("Document prêt");
      setPreloadLoading(false);
      setStep("ajouter");
      clearShareSource();
    }

    const cached = readShareSource(fromId);
    if (cached) {
      applyMeta(cached);
      return;
    }

    async function loadMeta() {
      setPreloadLoading(true);
      setPreloadProgress(30);
      setPreloadLabel("Récupération des infos document…");
      setError(null);
      try {
        const meta = await getEnvelopeShareSource(fromId!);
        if (cancelled) return;
        if (!meta.ok) throw new Error(meta.error);
        setPreloadProgress(90);
        applyMeta(meta);
      } catch (e) {
        if (!cancelled) {
          setSourceEnvelopeId(null);
          setPreloadLoading(false);
          setError(
            e instanceof Error
              ? e.message
              : "Chargement du document impossible."
          );
        }
      }
    }

    void loadMeta();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromId]);

  function destColor(destId: string) {
    const idx = dests.findIndex((d) => d.id === destId);
    return DEST_COLORS[Math.max(0, idx) % DEST_COLORS.length];
  }

  function updateDest(id: string, patch: Partial<Dest>) {
    setDests((rows) => rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function addDest() {
    const id = crypto.randomUUID();
    setDests((rows) => [...rows, { id, email: "", nom: "" }]);
    setActiveDestId(id);
  }

  function removeDest(id: string) {
    setDests((rows) => {
      if (rows.length <= 1) return rows;
      const next = rows.filter((r) => r.id !== id);
      if (activeDestId === id) setActiveDestId(next[0]?.id ?? "");
      return next;
    });
    setFields((fs) => fs.filter((f) => f.destinataireId !== id));
  }

  function moveDest(id: string, direction: -1 | 1) {
    setDests((rows) => {
      const idx = rows.findIndex((r) => r.id === id);
      if (idx < 0) return rows;
      const target = idx + direction;
      if (target < 0 || target >= rows.length) return rows;
      const next = [...rows];
      const tmp = next[idx];
      next[idx] = next[target];
      next[target] = tmp;
      return next;
    });
  }

  function onFieldPointerDown(
    e: React.PointerEvent,
    field: PlacedField
  ) {
    e.stopPropagation();
    e.preventDefault();
    if (resizeRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = {
      id: field.id,
      offsetX: (e.clientX - rect.left) / rect.width - field.posX,
      offsetY: (e.clientY - rect.top) / rect.height - field.posY,
    };
    setSelectedFieldId(field.id);
    setPendingType(null);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onFieldResizePointerDown(
    e: React.PointerEvent,
    field: PlacedField,
    corner: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w"
  ) {
    e.stopPropagation();
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    dragRef.current = null;
    resizeRef.current = {
      id: field.id,
      corner,
      startX: (e.clientX - rect.left) / rect.width,
      startY: (e.clientY - rect.top) / rect.height,
      orig: { ...field },
    };
    setSelectedFieldId(field.id);
    setPendingType(null);
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
  }

  function onCanvasPointerMove(e: React.PointerEvent) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) / rect.width;
    const my = (e.clientY - rect.top) / rect.height;

    const resize = resizeRef.current;
    if (resize) {
      const { orig, corner, startX, startY } = resize;
      const dx = mx - startX;
      const dy = my - startY;
      let posX = orig.posX;
      let posY = orig.posY;
      let largeur = orig.largeur;
      let hauteur = orig.hauteur;

      if (corner.includes("e")) largeur = Math.max(MIN_W, orig.largeur + dx);
      if (corner.includes("s")) hauteur = Math.max(MIN_H, orig.hauteur + dy);
      if (corner.includes("w")) {
        largeur = Math.max(MIN_W, orig.largeur - dx);
        posX = orig.posX + (orig.largeur - largeur);
      }
      if (corner.includes("n")) {
        hauteur = Math.max(MIN_H, orig.hauteur - dy);
        posY = orig.posY + (orig.hauteur - hauteur);
      }
      if (posX < 0) {
        largeur += posX;
        posX = 0;
      }
      if (posY < 0) {
        hauteur += posY;
        posY = 0;
      }
      if (posX + largeur > 1) largeur = 1 - posX;
      if (posY + hauteur > 1) hauteur = 1 - posY;

      setFields((rows) =>
        rows.map((r) =>
          r.id === resize.id
            ? {
                ...r,
                posX,
                posY,
                largeur: Math.max(MIN_W, largeur),
                hauteur: Math.max(MIN_H, hauteur),
              }
            : r
        )
      );
      return;
    }

    const drag = dragRef.current;
    if (!drag) return;
    const field = fields.find((f) => f.id === drag.id);
    if (!field) return;
    const x = mx - drag.offsetX;
    const y = my - drag.offsetY;
    setFields((rows) =>
      rows.map((r) =>
        r.id === drag.id
          ? {
              ...r,
              posX: Math.min(Math.max(x, 0), 1 - r.largeur),
              posY: Math.min(Math.max(y, 0), 1 - r.hauteur),
            }
          : r
      )
    );
  }

  function onCanvasPointerUp() {
    dragRef.current = null;
    resizeRef.current = null;
  }

  function onPickFile(f: File | null) {
    if (previewIsBlob && previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(f);
    setSourceEnvelopeId(null);
    setSourceFileName(null);
    setSourceMime(null);
    if (f) {
      setTitre((t) => t || f.name.replace(/\.[^.]+$/, ""));
      if (f.type.startsWith("image/") || f.type === "application/pdf") {
        setPreviewIsBlob(true);
        setPreviewUrl(URL.createObjectURL(f));
      } else {
        setPreviewIsBlob(false);
        setPreviewUrl(null);
      }
    } else {
      setPreviewIsBlob(false);
      setPreviewUrl(null);
    }
  }

  function goPreparer() {
    setError(null);
    if (validDests.length === 0) {
      setError("Ajoutez au moins un destinataire avec une adresse e-mail.");
      return;
    }
    for (const d of validDests) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) {
        setError(`E-mail invalide : ${d.email}`);
        return;
      }
    }
    if (!file && !sourceEnvelopeId) {
      setError("Ajoutez le document à faire signer (PDF, Word ou image).");
      return;
    }
    const docLabel =
      titre.trim() ||
      file?.name.replace(/\.[^.]+$/, "") ||
      sourceFileName?.replace(/\.[^.]+$/, "") ||
      "Document";
    if (!titre.trim()) setTitre(docLabel);
    setObjet((o) =>
      o.trim() ? o : `Signature demandée sur « ${docLabel} »`
    );
    if (!activeDestId) setActiveDestId(validDests[0].id);
    setStep("preparer");
  }

  function goEnvoyer() {
    setError(null);
    if (fields.length === 0) {
      setError(
        "Placez au moins un champ (ex. Signature) sur le document avant d'envoyer."
      );
      return;
    }
    if (missingSignatureDests.length > 0) {
      const names = missingSignatureDests
        .map((d) => d.nom || d.email)
        .join(", ");
      setError(
        `Chaque destinataire doit avoir un champ Signature ou Bloc de signature. Manque : ${names}. Sélectionnez le destinataire à gauche, puis placez « Signature ».`
      );
      setActiveDestId(missingSignatureDests[0].id);
      setPendingType({
        type: "SIGNATURE",
        label: "Signature",
        w: 0.28,
        h: 0.08,
      });
      return;
    }
    setStep("envoyer");
  }

  function placeMissingSignatures() {
    setError(null);
    if (missingSignatureDests.length === 0) return;
    setFields((rows) => {
      const next = [...rows];
      missingSignatureDests.forEach((d, i) => {
        next.push({
          id: crypto.randomUUID(),
          type: "SIGNATURE",
          label: "Signature",
          destinataireId: d.id,
          posX: 0.1 + (i % 2) * 0.35,
          posY: Math.max(0.55, 0.78 - Math.floor(i / 2) * 0.12),
          largeur: 0.28,
          hauteur: 0.08,
        });
      });
      return next;
    });
  }

  function placeField(x: number, y: number) {
    if (!pendingType || !activeDestId) return;
    const id = crypto.randomUUID();
    setFields((rows) => [
      ...rows,
      {
        id,
        type: pendingType.type,
        label: pendingType.label,
        destinataireId: activeDestId,
        posX: Math.min(Math.max(x - pendingType.w / 2, 0), 1 - pendingType.w),
        posY: Math.min(Math.max(y - pendingType.h / 2, 0), 1 - pendingType.h),
        largeur: pendingType.w,
        hauteur: pendingType.h,
      },
    ]);
    setSelectedFieldId(id);
    setPendingType(null);
  }

  async function handleSend() {
    setError(null);
    if (!file && !sourceEnvelopeId) {
      setError("Document manquant.");
      return;
    }
    const name =
      titre.trim() ||
      file?.name.replace(/\.[^.]+$/, "") ||
      sourceFileName?.replace(/\.[^.]+$/, "") ||
      "Document";
    setLoading(true);
    try {
      const destIndexById = new Map(
        validDests.map((d, i) => [d.id, i] as const)
      );
      const champs = fields.map((f) => ({
        type: f.type,
        destinataireIndex: destIndexById.get(f.destinataireId) ?? 0,
        posX: f.posX,
        posY: f.posY,
        largeur: f.largeur,
        hauteur: f.hauteur,
      }));

      const result = sourceEnvelopeId
        ? await createAndSendEnvelope({
            titre: name,
            objet: objet.trim() || `Signature demandée sur « ${name} »`,
            message: message.trim(),
            ordreObligatoire,
            rappelFrequence: rappel,
            destinataires: validDests.map((d) => ({
              email: d.email.trim(),
              nom: d.nom.trim(),
            })),
            sourceEnvelopeId,
            champs,
          })
        : await createAndSendEnvelope({
            titre: name,
            objet: objet.trim() || `Signature demandée sur « ${name} »`,
            message: message.trim(),
            ordreObligatoire,
            rappelFrequence: rappel,
            destinataires: validDests.map((d) => ({
              email: d.email.trim(),
              nom: d.nom.trim(),
            })),
            fileBase64: await fileToBase64(file!),
            fileName: file!.name,
            fileMime: file!.type || "application/octet-stream",
            champs,
          });
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setSentId(result.id);
      setInviteLinks(result.inviteLinks ?? []);
      setMailConfigured(result.mailConfigured !== false);
      setMailDelivered(Boolean(result.mailDelivered));
      setMailError(result.mailError ?? null);
      rememberContacts(
        validDests.map((d) => ({
          email: d.email.trim(),
          nom: d.nom.trim(),
        }))
      );
      setStep("envoye");
    } catch (e) {
      setLoading(false);
      setError(e instanceof Error ? e.message : "Envoi impossible.");
    }
  }

  const effectiveMime = file?.type || sourceMime || "";
  const effectiveName = file?.name || sourceFileName || "";
  const isImage = Boolean(effectiveMime.startsWith("image/"));
  const isPdf = Boolean(
    effectiveMime.includes("pdf") || effectiveName.toLowerCase().endsWith(".pdf")
  );
  const hasDocument = Boolean(file || sourceEnvelopeId);

  return (
    <div className="-mx-4 -mt-2 min-h-[70vh] sm:-mx-6 lg:-mx-10">
      <header className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
        <h1 className="text-sm font-semibold text-slate-800 sm:text-base">
          Demander des signatures électroniques
        </h1>
        <Stepper step={step} />
        <Button
          variant="secondary"
          className="rounded-full px-4 py-1.5 text-xs"
          onClick={() => router.push("/signatures")}
        >
          Fermer
        </Button>
      </header>

      {error && (
        <div className="mx-4 mt-4 sm:mx-6">
          <Alert type="error">{error}</Alert>
        </div>
      )}

      {preloadLoading && (
        <div className="mx-4 mt-4 rounded-xl border border-[var(--c-blue-200)] bg-[var(--c-blue-50)] px-4 py-4 sm:mx-6">
          <div className="flex items-center justify-between gap-3 text-sm text-[var(--c-blue-900)]">
            <p className="font-medium">{preloadLabel}</p>
            <span className="tabular-nums font-semibold">
              {Math.round(preloadProgress)}%
            </span>
          </div>
          <div
            className="mt-3 h-2.5 overflow-hidden rounded-full bg-white/80 ring-1 ring-[var(--c-blue-200)]"
            role="progressbar"
            aria-valuenow={Math.round(preloadProgress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Progression du chargement"
          >
            <div
              className="h-full rounded-full bg-[var(--c-blue-600)] transition-[width] duration-150 ease-out"
              style={{ width: `${Math.max(2, preloadProgress)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-[var(--c-blue-800)]/80">
            Patientez pendant le transfert du fichier vers la demande de
            signatures.
          </p>
        </div>
      )}

      {fromId && hasDocument && !preloadLoading && (
        <div className="mx-4 mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 sm:mx-6">
          Document prêt (sans re-téléchargement). Ajoutez les destinataires,
          puis continuez vers Préparer / Envoyer.
        </div>
      )}

      {/* ÉTAPE AJOUTER */}
      {step === "ajouter" && (
        <div className="mx-auto grid max-w-6xl gap-6 px-4 py-8 lg:grid-cols-[260px_1fr] sm:px-6">
          <aside className="h-fit rounded-xl bg-slate-50 p-5">
            <h2 className="text-base font-semibold text-[var(--c-blue-950)]">
              Recueillez des signatures plus rapidement
            </h2>
            <ul className="mt-4 space-y-3 text-sm text-slate-600">
              <li>Ajoutez les destinataires qui doivent signer.</li>
              <li>Joignez le document (PDF, Word, image).</li>
              <li>Placez ensuite les champs sur le document.</li>
            </ul>
          </aside>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-xl font-semibold">Ajouter des destinataires</h2>
              <p className="text-sm text-slate-500">
                {validDests.length} destinataire
                {validDests.length > 1 ? "s" : ""}
              </p>
            </div>

            <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={ordreObligatoire}
                onChange={(e) => setOrdreObligatoire(e.target.checked)}
                className="rounded"
              />
              Les destinataires doivent signer dans l&apos;ordre (recommandé)
            </label>

            <div className="mb-5 rounded-lg border border-[var(--c-blue-100)] bg-[var(--c-blue-50)] px-3 py-2.5 text-xs text-[var(--c-blue-800)]">
              <p className="font-medium">Parcours du document</p>
              <p className="mt-1">
                {validDests.length === 0
                  ? "Ajoutez des signataires…"
                  : [
                      ...validDests.map(
                        (d, i) => `${i + 1}. ${d.nom || d.email || "…"}`
                      ),
                      `${validDests.length + 1}. Vous (initiateur · retour final)`,
                    ].join(" → ")}
              </p>
            </div>

            <div className="space-y-3">
              {dests.map((d, index) => (
                <div
                  key={d.id}
                  className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-3 sm:flex-row sm:items-center"
                >
                  <div className="flex items-center gap-1 text-slate-400">
                    <span
                      className="h-3 w-3 rounded-sm"
                      style={{ background: DEST_COLORS[index % DEST_COLORS.length] }}
                    />
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => moveDest(d.id, -1)}
                      aria-label="Monter"
                      title="Monter dans le parcours"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className="rounded p-1 hover:bg-slate-100 disabled:opacity-30"
                      disabled={index === dests.length - 1}
                      onClick={() => moveDest(d.id, 1)}
                      aria-label="Descendre"
                      title="Descendre dans le parcours"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </button>
                    <span className="text-xs font-medium">{index + 1}</span>
                  </div>
                  <div className="grid flex-1 gap-2 sm:grid-cols-2">
                    <div className="relative">
                      <Input
                        placeholder="Adresse e-mail *"
                        type="email"
                        autoComplete="off"
                        value={d.email}
                        onFocus={() => {
                          setEmailFocusId(d.id);
                          setEmailSuggestions(
                            filterRememberedContacts(d.email)
                          );
                        }}
                        onBlur={() => {
                          // délai pour permettre le clic sur suggestion
                          window.setTimeout(() => {
                            setEmailFocusId((cur) =>
                              cur === d.id ? null : cur
                            );
                          }, 150);
                        }}
                        onChange={(e) => {
                          const value = e.target.value;
                          updateDest(d.id, { email: value });
                          setEmailFocusId(d.id);
                          setEmailSuggestions(filterRememberedContacts(value));
                        }}
                      />
                      {emailFocusId === d.id && emailSuggestions.length > 0 && (
                        <ul className="absolute z-30 mt-1 max-h-40 w-full overflow-auto rounded-md border border-slate-200 bg-white py-1 text-sm shadow-lg">
                          {emailSuggestions.map((c) => (
                            <li key={c.email}>
                              <button
                                type="button"
                                className="flex w-full flex-col px-3 py-2 text-left hover:bg-slate-50"
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => {
                                  updateDest(d.id, {
                                    email: c.email,
                                    nom: d.nom.trim() || c.nom || "",
                                  });
                                  setEmailFocusId(null);
                                }}
                              >
                                <span className="font-medium text-slate-800">
                                  {c.email}
                                </span>
                                {c.nom ? (
                                  <span className="text-xs text-slate-500">
                                    {c.nom}
                                  </span>
                                ) : null}
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    <Input
                      placeholder="Nom"
                      value={d.nom}
                      onChange={(e) => updateDest(d.id, { nom: e.target.value })}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => removeDest(d.id)}
                    className="rounded-md p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              onClick={addDest}
              className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-slate-300 py-3 text-sm text-slate-600 hover:border-[var(--c-blue-400)]"
            >
              <Plus className="h-4 w-4" />
              Ajouter un destinataire
            </button>

            <div className="mt-6">
              <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                Document
              </p>
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-8 transition hover:border-[var(--c-blue-400)]">
                <Upload className="h-7 w-7 text-[var(--c-blue-700)]" />
                <span className="mt-2 text-sm font-medium">
                  {hasDocument
                    ? effectiveName || "Document sélectionné"
                    : "Choisir un fichier PDF, Word ou image"}
                </span>
                <input
                  type="file"
                  className="hidden"
                  accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.webp,application/pdf,image/*,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                />
              </label>
              <div className="mt-3 max-w-md">
                <Input
                  label="Nom de l'accord"
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  placeholder="Ex. Contrat fournisseur"
                />
              </div>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Étape 1/3
              </p>
              <div className="flex gap-3">
                <Button
                  variant="secondary"
                  onClick={() => router.push("/signatures")}
                >
                  Annuler
                </Button>
                <Button onClick={goPreparer}>Préparer</Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ÉTAPE PRÉPARER */}
      {step === "preparer" && (
        <div className="flex min-h-[calc(100vh-8rem)] flex-col lg:flex-row">
          <aside className="w-full shrink-0 border-b border-slate-200 bg-white lg:w-[280px] lg:border-b-0 lg:border-r">
            <div className="border-b border-slate-100 px-4 py-3">
              <p className="text-sm font-semibold text-slate-800">
                Demander des signatures électroniques
              </p>
              <label className="mt-2 flex items-center gap-2 text-xs text-[var(--c-blue-700)]">
                <input type="checkbox" defaultChecked className="rounded" />
                Mode avancé
              </label>
            </div>

            <div className="px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Parcours
              </p>
              <ol className="mt-2 space-y-1 text-xs text-slate-600">
                {validDests.map((d, i) => (
                  <li key={d.id} className="flex items-center gap-2">
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-sm"
                      style={{ background: destColor(d.id) }}
                    />
                    {i + 1}. {d.nom || d.email}
                  </li>
                ))}
                <li className="flex items-center gap-2 font-medium text-[var(--c-blue-800)]">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm bg-[var(--c-gold-500)]" />
                  {validDests.length + 1}. Vous (initiateur)
                </li>
              </ol>
            </div>

            <div className="px-4 py-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                Destinataires (placer les champs)
              </p>
              <ul className="mt-2 space-y-1">
                {validDests.map((d) => {
                  const sigCount = fields.filter(
                    (f) =>
                      f.destinataireId === d.id && isSignatureChamp(f.type)
                  ).length;
                  return (
                  <li key={d.id}>
                    <button
                      type="button"
                      onClick={() => setActiveDestId(d.id)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-sm ${
                        activeDestId === d.id
                          ? "bg-slate-100 font-medium"
                          : "hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className="h-3 w-3 shrink-0 rounded-sm"
                        style={{ background: destColor(d.id) }}
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {d.nom || d.email}{" "}
                        <span className="text-xs text-slate-400">
                          (signataire)
                        </span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold ${
                          sigCount > 0
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-red-100 text-red-700"
                        }`}
                        title="Champs Signature / Bloc"
                      >
                        {sigCount > 0 ? `${sigCount} sig.` : "0 sig."}
                      </span>
                    </button>
                  </li>
                  );
                })}
              </ul>
              {missingSignatureDests.length > 0 && (
                <button
                  type="button"
                  onClick={placeMissingSignatures}
                  className="mt-2 w-full rounded-md border border-[var(--c-blue-300)] bg-[var(--c-blue-50)] px-2 py-2 text-xs font-medium text-[var(--c-blue-800)] hover:bg-[var(--c-blue-100)]"
                >
                  Placer les signatures manquantes
                </button>
              )}
            </div>

            <div className="border-t border-slate-100 px-2 py-2">
              {FIELD_PALETTE.map((group) => {
                const open = openGroups[group.id] ?? false;
                return (
                  <div key={group.id} className="mb-1">
                    <button
                      type="button"
                      onClick={() =>
                        setOpenGroups((g) => ({
                          ...g,
                          [group.id]: !open,
                        }))
                      }
                      className="flex w-full items-center justify-between rounded-md px-2 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      {group.title}
                      {open ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </button>
                    {open && (
                      <ul className="mb-2 space-y-0.5 rounded-md bg-slate-50 p-1.5">
                        {group.fields.map((f) => (
                          <li key={f.type}>
                            <button
                              type="button"
                              onClick={() =>
                                setPendingType({
                                  type: f.type,
                                  label: f.label,
                                  w: f.w,
                                  h: f.h,
                                })
                              }
                              className={`flex w-full items-center gap-2 rounded px-2 py-2 text-left text-sm ${
                                pendingType?.type === f.type
                                  ? "bg-white ring-1 ring-slate-300"
                                  : "hover:bg-white"
                              }`}
                            >
                              <GripVertical className="h-3.5 w-3.5 text-slate-400" />
                              {f.label}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                );
              })}
            </div>

            <div className="border-t border-slate-100 px-4 py-4">
              <button
                type="button"
                className="text-xs text-slate-500 underline"
                onClick={() => setFields([])}
              >
                Réinitialiser les champs
              </button>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => setStep("ajouter")}
                >
                  Retour
                </Button>
                <Button className="flex-1" onClick={goEnvoyer}>
                  Envoyer
                </Button>
              </div>
              <p className="mt-2 text-center text-[10px] uppercase tracking-wide text-slate-400">
                Étape 2/3
              </p>
            </div>
          </aside>

          <main className="flex flex-1 flex-col bg-slate-200/70">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-white px-4 py-2 text-xs text-slate-500">
              <span>
                {pendingType
                  ? `Cliquez sur le document pour placer « ${pendingType.label} » pour ${
                      validDests.find((d) => d.id === activeDestId)?.nom ||
                      validDests.find((d) => d.id === activeDestId)?.email ||
                      "le destinataire sélectionné"
                    }`
                  : selectedFieldId
                    ? "Glissez le champ pour le repositionner"
                    : "Sélectionnez un destinataire, puis un champ Signature"}
              </span>
              <span className="flex items-center gap-3 font-medium text-slate-600">
                <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-1.5 py-0.5">
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-40"
                    disabled={zoomPct <= 50}
                    onClick={() => setZoomPct((z) => Math.max(50, z - 10))}
                    aria-label="Zoom arrière"
                  >
                    −
                  </button>
                  <button
                    type="button"
                    className="min-w-[4.5rem] rounded px-1 py-0.5 tabular-nums hover:bg-white"
                    onClick={() => setZoomPct(100)}
                    title="Réinitialiser : largeur utile = 100 %"
                  >
                    {zoomPct} %
                  </button>
                  <button
                    type="button"
                    className="rounded px-1.5 py-0.5 hover:bg-white disabled:opacity-40"
                    disabled={zoomPct >= 200}
                    onClick={() => setZoomPct((z) => Math.min(200, z + 10))}
                    aria-label="Zoom avant"
                  >
                    +
                  </button>
                </span>
                <span>{fields.length} champ(s)</span>
              </span>
            </div>

            <div className="flex flex-1 items-start justify-center overflow-auto p-6">
              <div
                ref={canvasRef}
                className={`relative touch-none bg-white shadow-lg ${
                  pendingType ? "cursor-crosshair" : "cursor-default"
                }`}
                style={{
                  width: docBox.w,
                  height: docBox.h,
                  maxWidth: "100%",
                }}
                onClick={(e) => {
                  if (!pendingType || dragRef.current) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  placeField(
                    (e.clientX - rect.left) / rect.width,
                    (e.clientY - rect.top) / rect.height
                  );
                }}
                onPointerMove={onCanvasPointerMove}
                onPointerUp={onCanvasPointerUp}
                onPointerLeave={onCanvasPointerUp}
              >
                {isImage && previewUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={previewUrl}
                    alt="Document"
                    className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    draggable={false}
                    onLoad={(e) => {
                      const img = e.currentTarget;
                      const w = img.naturalWidth || img.width;
                      const h = img.naturalHeight || img.height;
                      if (w > 0 && h > 0) setDocNatural({ w, h });
                    }}
                  />
                )}
                {isPdf && previewUrl && (
                  <PdfPageViewer
                    url={previewUrl}
                    width={docBox.w}
                    height={docBox.h}
                    onPageSize={(size) => {
                      setDocNatural((prev) => {
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
                )}
                {!isImage && !isPdf && (
                  <div className="flex h-full flex-col items-center justify-center p-8 text-center text-slate-500">
                    <p className="font-medium text-slate-700">{file?.name}</p>
                    <p className="mt-2 text-sm">
                      Aperçu limité — placez et déplacez les champs ici.
                    </p>
                  </div>
                )}

                {fields.map((f) => {
                  const selected = selectedFieldId === f.id;
                  const dest = dests.find((d) => d.id === f.destinataireId);
                  const handles: {
                    id: "nw" | "ne" | "sw" | "se" | "n" | "s" | "e" | "w";
                    className: string;
                    cursor: string;
                  }[] = [
                    { id: "nw", className: "-left-1 -top-1", cursor: "nwse-resize" },
                    { id: "ne", className: "-right-1 -top-1", cursor: "nesw-resize" },
                    { id: "sw", className: "-left-1 -bottom-1", cursor: "nesw-resize" },
                    { id: "se", className: "-right-1 -bottom-1", cursor: "nwse-resize" },
                    {
                      id: "n",
                      className: "left-1/2 -top-1 -translate-x-1/2",
                      cursor: "ns-resize",
                    },
                    {
                      id: "s",
                      className: "left-1/2 -bottom-1 -translate-x-1/2",
                      cursor: "ns-resize",
                    },
                    {
                      id: "e",
                      className: "-right-1 top-1/2 -translate-y-1/2",
                      cursor: "ew-resize",
                    },
                    {
                      id: "w",
                      className: "-left-1 top-1/2 -translate-y-1/2",
                      cursor: "ew-resize",
                    },
                  ];
                  return (
                    <div
                      key={f.id}
                      className={`group absolute flex cursor-grab items-center justify-between gap-1 overflow-visible rounded border-2 px-2 text-xs font-medium shadow-sm active:cursor-grabbing ${
                        selected ? "z-10 ring-2 ring-offset-1" : "z-[1]"
                      }`}
                      style={{
                        left: `${f.posX * 100}%`,
                        top: `${f.posY * 100}%`,
                        width: `${f.largeur * 100}%`,
                        height: `${f.hauteur * 100}%`,
                        borderColor: destColor(f.destinataireId),
                        backgroundColor: `${destColor(f.destinataireId)}22`,
                        color: destColor(f.destinataireId),
                      }}
                      onPointerDown={(e) => onFieldPointerDown(e, f)}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedFieldId(f.id);
                      }}
                    >
                      <span className="flex min-w-0 items-center gap-1 truncate">
                        <GripVertical className="h-3 w-3 shrink-0 opacity-60" />
                        <span className="truncate">
                          {f.label}
                          {dest ? ` · ${dest.nom || dest.email}` : ""}
                          {isSignatureChamp(f.type) && (
                            <span className="text-red-500"> *</span>
                          )}
                        </span>
                      </span>
                      <button
                        type="button"
                        className="relative z-20 shrink-0 rounded p-0.5 hover:bg-white/80"
                        onPointerDown={(e) => e.stopPropagation()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFields((rows) => rows.filter((r) => r.id !== f.id));
                        }}
                        aria-label="Supprimer le champ"
                      >
                        <X className="h-3 w-3" />
                      </button>
                      {handles.map((h) => (
                        <span
                          key={h.id}
                          role="presentation"
                          title="Étirer"
                          className={`absolute z-20 h-2.5 w-2.5 rounded-sm border-2 bg-white shadow ${h.className} ${
                            selected
                              ? "opacity-100"
                              : "opacity-0 group-hover:opacity-100"
                          }`}
                          style={{
                            cursor: h.cursor,
                            borderColor: destColor(f.destinataireId),
                          }}
                          onPointerDown={(e) =>
                            onFieldResizePointerDown(e, f, h.id)
                          }
                        />
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </main>
        </div>
      )}

      {/* ÉTAPE ENVOYER */}
      {step === "envoyer" && (
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-8 lg:grid-cols-[240px_1fr] sm:px-6">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {isImage && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="w-full" />
            ) : (
              <div className="flex h-64 items-center justify-center bg-slate-50 p-4 text-center text-xs text-slate-500">
                {file?.name}
              </div>
            )}
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-semibold">Vérifier et envoyer</h2>
            <div className="mt-6 space-y-4">
              <Input label="De" value={user?.nom ?? ""} disabled />
              <div>
                <p className="mb-1.5 text-xs font-medium uppercase tracking-wide text-slate-500">
                  À
                </p>
                <div className="rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-sm">
                  {validDests.map((d) => d.nom || d.email).join(", ")}
                </div>
              </div>
              <Input
                label="Nom de l'accord"
                value={titre}
                onChange={(e) => setTitre(e.target.value)}
              />
              <Input
                label="Objet"
                value={objet}
                onChange={(e) => setObjet(e.target.value)}
              />
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-slate-500">
                  Message
                </span>
                <textarea
                  className="min-h-[100px] w-full rounded-md border border-slate-300 bg-white px-3.5 py-2.5 text-sm focus:border-[var(--c-blue-400)] focus:outline-none focus:ring-4 focus:ring-[var(--c-blue-400)]/15"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                />
              </label>
              <Select
                label="Rappels"
                value={rappel}
                onChange={(e) => setRappel(e.target.value)}
              >
                <option value="AUCUN">Aucun rappel</option>
                <option value="QUOTIDIEN">Tous les jours</option>
                <option value="HEBDO">Toutes les semaines</option>
              </Select>
              <p className="text-xs text-slate-500">
                {fields.length} champ(s) placé(s) · Les accords incomplets
                expirent après 365 jours.
              </p>
            </div>

            <div className="mt-8 flex items-center justify-between border-t border-slate-100 pt-5">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Étape 3/3
              </p>
              <div className="flex gap-3">
                <Button variant="secondary" onClick={() => setStep("preparer")}>
                  Fermer
                </Button>
                <Button disabled={loading} onClick={handleSend}>
                  {loading ? "Envoi…" : "Envoyer"}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* CONFIRMATION ENVOYÉ */}
      {step === "envoye" && (
        <div className="mx-auto grid max-w-5xl gap-8 px-4 py-10 lg:grid-cols-[220px_1fr] sm:px-6">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
            {isImage && previewUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={previewUrl} alt="" className="w-full" />
            ) : (
              <div className="flex h-72 items-center justify-center bg-slate-50 p-4 text-center text-xs text-slate-500">
                {file?.name}
              </div>
            )}
          </div>
          <div>
            <h2 className="text-2xl font-semibold text-slate-900">
              « {titre || file?.name} » a bien été envoyé pour signature
            </h2>
            <p className="mt-4 text-sm leading-relaxed text-slate-600">
              Un e-mail « Review and sign » (logo MEGA) a été préparé pour chaque
              destinataire actif. Après signature et Submit, toutes les parties
              recevront le PDF final en pièce jointe.
            </p>

            {!mailDelivered && (
              <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-950">
                <p className="font-semibold">E-mail non livré dans la boîte du destinataire</p>
                <p className="mt-1">
                  {mailError ||
                    (!mailConfigured
                      ? "SMTP / Resend non configuré."
                      : "L’envoi SMTP a échoué.")}
                </p>
                <p className="mt-2 text-amber-900/90">
                  Google Workspace refuse le mot de passe du compte pour SMTP.
                  Créez un{" "}
                  <a
                    className="underline"
                    href="https://myaccount.google.com/apppasswords"
                    target="_blank"
                    rel="noreferrer"
                  >
                    mot de passe d’application
                  </a>
                  , mettez-le dans <code className="text-xs">SMTP_PASS</code>{" "}
                  (.env.local), puis redémarrez le serveur.
                </p>
                <p className="mt-2 text-xs text-amber-800">
                  En attendant, l’e-mail est sauvé dans{" "}
                  <code>.data/mail-outbox/</code> et le lien ci-dessous fonctionne.
                </p>
              </div>
            )}

            {mailDelivered && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
                E-mail « Review and sign » envoyé au destinataire.
              </div>
            )}

            {inviteLinks.length > 0 && (
              <div className="mt-6">
                <h3 className="font-semibold text-slate-800">
                  Liens Review and sign
                </h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {inviteLinks.map((l) => (
                    <li
                      key={l.email}
                      className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"
                    >
                      <p className="font-medium text-slate-800">
                        {l.nom} · {l.email}
                      </p>
                      <a
                        href={l.url}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-blue-600 underline"
                      >
                        {l.url}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="mt-8">
              <h3 className="font-semibold text-slate-800">Rappels</h3>
              <p className="mt-1 text-sm text-slate-600">
                {rappel === "AUCUN"
                  ? "Aucun rappel n'est défini pour ce document."
                  : rappel === "QUOTIDIEN"
                    ? "Rappels quotidiens jusqu'à complétion."
                    : "Rappels hebdomadaires jusqu'à complétion."}
              </p>
            </div>

            <div className="mt-6">
              <h3 className="font-semibold text-slate-800">Vous serez alerté</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li>si le document n&apos;a pas été consulté</li>
                <li>si le document n&apos;a pas été signé</li>
              </ul>
            </div>

            <p className="mt-8 text-xs text-slate-400">
              Les accords incomplets sont considérés comme expirés après 365
              jours.
            </p>

            <div className="mt-8 flex flex-wrap gap-3">
              {sentId && (
                <Button onClick={() => router.push(`/signatures/${sentId}`)}>
                  Voir le parcours
                </Button>
              )}
              <Button
                variant="secondary"
                onClick={() => router.push("/signatures")}
              >
                Retour à Signature
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
