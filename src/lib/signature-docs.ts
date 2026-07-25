/** Durée de rétention en corbeille (jours). */
export const SIGNATURE_TRASH_DAYS = 30;

export const ENVELOPE_STATUTS = [
  "BROUILLON",
  "EN_COURS",
  "COMPLETE",
  "ANNULE",
  "REFUSE",
] as const;

export type EnvelopeStatut = (typeof ENVELOPE_STATUTS)[number];

export const ENVELOPE_STATUT_LABELS: Record<EnvelopeStatut, string> = {
  BROUILLON: "Brouillon",
  EN_COURS: "En cours de signature",
  COMPLETE: "Certifié · Complet",
  ANNULE: "Annulé",
  REFUSE: "Refusé",
};

export const DEST_STATUTS = [
  "EN_ATTENTE",
  "A_SIGNER",
  "SIGNE",
  "REFUSE",
] as const;

export type DestStatut = (typeof DEST_STATUTS)[number];

export const DEST_STATUT_LABELS: Record<DestStatut, string> = {
  EN_ATTENTE: "En attente (ordre)",
  A_SIGNER: "À signer",
  SIGNE: "Signé",
  REFUSE: "Refusé",
};

/** Couleurs destinataires (comme DocuSign) */
export const DEST_COLORS = [
  "#7c3aed",
  "#2563eb",
  "#059669",
  "#d97706",
  "#db2777",
  "#0891b2",
];

export type ChampType =
  | "SIGNATURE"
  | "PARAPHE"
  | "BLOC_SIGNATURE"
  | "TAMPON"
  | "FONCTION"
  | "SOCIETE"
  | "NOM"
  | "EMAIL"
  | "DATE"
  | "TEXTE"
  | "LISTE"
  | "COCHE"
  | "RADIO"
  | "IMAGE"
  | "PIECE_JOINTE"
  | "LIEN"
  | "TAMPON_PARTICIPATION"
  | "NUMERO_TRANSACTION";

export const FIELD_PALETTE: {
  id: string;
  title: string;
  fields: { type: ChampType; label: string; w: number; h: number }[];
}[] = [
  {
    id: "signature",
    title: "Champs de signature",
    fields: [
      { type: "SIGNATURE", label: "Signature", w: 0.28, h: 0.08 },
      { type: "PARAPHE", label: "Paraphe", w: 0.12, h: 0.05 },
      { type: "BLOC_SIGNATURE", label: "Bloc de signature", w: 0.32, h: 0.14 },
      { type: "TAMPON", label: "Tampon", w: 0.14, h: 0.08 },
    ],
  },
  {
    id: "infos",
    title: "Champs d'infos signataire",
    fields: [
      { type: "FONCTION", label: "Fonction", w: 0.22, h: 0.045 },
      { type: "SOCIETE", label: "Société", w: 0.22, h: 0.045 },
      { type: "NOM", label: "Nom", w: 0.22, h: 0.045 },
      { type: "EMAIL", label: "E-mail", w: 0.26, h: 0.045 },
      { type: "DATE", label: "Date", w: 0.16, h: 0.045 },
    ],
  },
  {
    id: "data",
    title: "Champs de données",
    fields: [
      { type: "TEXTE", label: "Saisie de texte", w: 0.26, h: 0.045 },
      { type: "LISTE", label: "Liste déroulante", w: 0.22, h: 0.045 },
      { type: "COCHE", label: "Case à cocher", w: 0.05, h: 0.04 },
      { type: "RADIO", label: "Bouton radio", w: 0.05, h: 0.04 },
      { type: "IMAGE", label: "Image", w: 0.18, h: 0.1 },
    ],
  },
  {
    id: "autres",
    title: "Autres champs",
    fields: [
      { type: "PIECE_JOINTE", label: "Pièce jointe", w: 0.22, h: 0.05 },
      { type: "LIEN", label: "Lien hypertexte", w: 0.24, h: 0.045 },
    ],
  },
  {
    id: "transaction",
    title: "Champs de transaction",
    fields: [
      {
        type: "TAMPON_PARTICIPATION",
        label: "Tampon de participation",
        w: 0.2,
        h: 0.08,
      },
      {
        type: "NUMERO_TRANSACTION",
        label: "Numéro de transaction",
        w: 0.24,
        h: 0.045,
      },
    ],
  },
];

export const CHAMP_TYPE_LABELS: Record<ChampType, string> = Object.fromEntries(
  FIELD_PALETTE.flatMap((g) => g.fields.map((f) => [f.type, f.label]))
) as Record<ChampType, string>;

export const ALLOWED_SIGNATURE_MIME = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "image/png",
  "image/jpeg",
  "image/webp",
]);

export const ALLOWED_SIGNATURE_EXT = new Set([
  ".pdf",
  ".doc",
  ".docx",
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
]);

export function isAllowedSignatureFile(name: string, mime?: string | null) {
  const lower = name.toLowerCase();
  const extOk = [...ALLOWED_SIGNATURE_EXT].some((ext) => lower.endsWith(ext));
  if (!extOk) return false;
  if (!mime) return true;
  return ALLOWED_SIGNATURE_MIME.has(mime) || mime === "application/octet-stream";
}
