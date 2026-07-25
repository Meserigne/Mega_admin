import { randomBytes } from "crypto";
import { PDFDocument, rgb, StandardFonts } from "pdf-lib";
import {
  appendFinalAuditReportPage,
  type SignatureAuditReport,
} from "@/lib/signature-audit-pdf";

export type StampAnnotation = {
  type: string;
  valeur: string | null;
  posX: number;
  posY: number;
  largeur: number;
  hauteur: number;
  page?: number;
};

export type { SignatureAuditReport };

function dataUrlToBytes(dataUrl: string): { bytes: Uint8Array; mime: string } | null {
  const m = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
  if (!m) return null;
  const mime = m[1].toLowerCase();
  const bin = Buffer.from(m[2], "base64");
  return { bytes: new Uint8Array(bin), mime };
}

/**
 * Produit un PDF avec les annotations (signatures, texte…) incrustées.
 * Fonctionne pour un PDF source ou une image (PNG/JPEG/WebP→PNG via bytes).
 */
async function lockPdfAgainstModification(
  bytes: Uint8Array
): Promise<Uint8Array> {
  try {
    const { encryptPDF } = await import("@pdfsmaller/pdf-encrypt");
    const ownerPassword = randomBytes(24).toString("base64url");
    // Mot de passe utilisateur vide = ouverture libre, modifications bloquées
    const locked = await encryptPDF(bytes, "", {
      ownerPassword,
      allowPrinting: true,
      allowHighQualityPrint: true,
      allowCopying: true,
      allowModifying: false,
      allowAnnotating: false,
      allowFillingForms: false,
      allowAssembly: false,
      allowExtraction: true,
    });
    return locked instanceof Uint8Array ? locked : new Uint8Array(locked);
  } catch (e) {
    console.error("[signature-flatten] lock PDF failed", e);
    return bytes;
  }
}

export async function buildSignedPdf(input: {
  fileBytes: Uint8Array;
  fileMime: string;
  fileName: string;
  annotations: StampAnnotation[];
  /** Page d'audit + verrouillage (document complet). */
  audit?: SignatureAuditReport | null;
  lock?: boolean;
}): Promise<{ bytes: Uint8Array; fileName: string }> {
  const mime = (input.fileMime || "").toLowerCase();
  const isPdf =
    mime.includes("pdf") || input.fileName.toLowerCase().endsWith(".pdf");
  const isImage = mime.startsWith("image/");

  let pdf: PDFDocument;

  if (isPdf) {
    pdf = await PDFDocument.load(input.fileBytes, {
      ignoreEncryption: true,
    });
  } else if (isImage) {
    pdf = await PDFDocument.create();
    let embedded;
    if (mime.includes("png")) {
      embedded = await pdf.embedPng(input.fileBytes);
    } else if (mime.includes("jpeg") || mime.includes("jpg")) {
      embedded = await pdf.embedJpg(input.fileBytes);
    } else {
      // webp / autres : encapsuler en page A4 avec note — tenter PNG
      try {
        embedded = await pdf.embedPng(input.fileBytes);
      } catch {
        const page = pdf.addPage([595, 842]);
        const font = await pdf.embedFont(StandardFonts.Helvetica);
        page.drawText("Aperçu image non convertible — ouvrez le fichier original.", {
          x: 40,
          y: 800,
          size: 11,
          font,
          color: rgb(0.2, 0.2, 0.2),
        });
        const out = await pdf.save();
        return {
          bytes: out,
          fileName: signedFileName(input.fileName),
        };
      }
    }
    const page = pdf.addPage([embedded.width, embedded.height]);
    page.drawImage(embedded, {
      x: 0,
      y: 0,
      width: embedded.width,
      height: embedded.height,
    });
  } else {
    pdf = await PDFDocument.create();
    const page = pdf.addPage([595, 842]);
    const font = await pdf.embedFont(StandardFonts.Helvetica);
    page.drawText(`Document : ${input.fileName}`, {
      x: 40,
      y: 800,
      size: 12,
      font,
    });
    page.drawText(
      "Format non prévisualisable en PDF signé. Les annotations sont listées dans Mega Signature.",
      { x: 40, y: 780, size: 10, font, color: rgb(0.3, 0.3, 0.3) }
    );
  }

  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();

  for (const a of input.annotations) {
    const pageIndex = Math.max(0, Math.min((a.page ?? 1) - 1, pages.length - 1));
    const page = pages[pageIndex];
    const { width, height } = page.getSize();
    const w = Math.max(a.largeur, 0.02) * width;
    const h = Math.max(a.hauteur, 0.02) * height;
    const x = a.posX * width;
    // PDF origin = bottom-left ; UI origin = top-left
    const y = height - a.posY * height - h;

    const valeur = a.valeur?.trim() ?? "";
    if (valeur.startsWith("data:image/")) {
      const parsed = dataUrlToBytes(valeur);
      if (!parsed) continue;
      // Tampon un peu plus lisible que la petite zone UI
      const drawW = Math.max(w, width * 0.18);
      const drawH = Math.max(h, height * 0.09);
      const drawX = Math.min(x, width - drawW);
      const drawY = Math.max(0, Math.min(y, height - drawH));
      try {
        let img;
        if (parsed.mime.includes("png") || parsed.mime.includes("webp")) {
          try {
            img = await pdf.embedPng(parsed.bytes);
          } catch {
            img = await pdf.embedJpg(parsed.bytes);
          }
        } else {
          try {
            img = await pdf.embedJpg(parsed.bytes);
          } catch {
            img = await pdf.embedPng(parsed.bytes);
          }
        }
        page.drawImage(img, {
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
        });
      } catch (e) {
        console.error("[buildSignedPdf] stamp image", a.type, e);
        page.drawRectangle({
          x: drawX,
          y: drawY,
          width: drawW,
          height: drawH,
          borderColor: rgb(0.15, 0.35, 0.7),
          borderWidth: 1,
        });
        page.drawText("Signature", {
          x: drawX + 4,
          y: drawY + drawH / 2 - 4,
          size: 9,
          font,
          color: rgb(0.15, 0.35, 0.7),
        });
      }
      continue;
    }

    if (valeur) {
      const size = Math.min(14, Math.max(8, h * 0.45));
      page.drawText(valeur.slice(0, 80), {
        x: x + 2,
        y: y + h / 2 - size / 3,
        size,
        font,
        color: rgb(0.05, 0.05, 0.1),
        maxWidth: w - 4,
      });
    }
  }

  if (input.audit) {
    await appendFinalAuditReportPage(pdf, input.audit);
  }

  let bytes = await pdf.save({ useObjectStreams: false });
  if (input.lock || input.audit) {
    bytes = await lockPdfAgainstModification(bytes);
  }
  return { bytes, fileName: signedFileName(input.fileName) };
}

function signedFileName(name: string) {
  const base = name.replace(/\.[^.]+$/, "") || "document";
  return `${base}-signe.pdf`;
}
