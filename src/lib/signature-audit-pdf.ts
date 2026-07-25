import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from "pdf-lib";
import { pdfSafeText } from "@/lib/pdf-text";

export type AuditHistoryEvent = {
  at: Date;
  title: string;
  detail?: string;
};

export type SignatureAuditReport = {
  documentTitle: string;
  createdAt: Date;
  createdBy: string;
  status: string;
  transactionId: string;
  events: AuditHistoryEvent[];
};

const BLUE = rgb(0.12, 0.35, 0.62);
const TEXT = rgb(0.12, 0.14, 0.18);
const MUTED = rgb(0.35, 0.4, 0.48);
const BOX_BG = rgb(0.94, 0.95, 0.97);
const BOX_BORDER = rgb(0.75, 0.8, 0.88);

function fmtDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function fmtDateTimeGmt(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  const h = String(d.getUTCHours()).padStart(2, "0");
  const min = String(d.getUTCMinutes()).padStart(2, "0");
  const s = String(d.getUTCSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} - ${h}:${min}:${s} GMT`;
}

function drawWrapped(
  page: PDFPage,
  text: string,
  opts: {
    x: number;
    y: number;
    size: number;
    font: PDFFont;
    color: ReturnType<typeof rgb>;
    maxWidth: number;
    lineHeight?: number;
  }
): number {
  const lineHeight = opts.lineHeight ?? opts.size + 4;
  const words = pdfSafeText(text).split(/\s+/).filter(Boolean);
  let line = "";
  let y = opts.y;
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (opts.font.widthOfTextAtSize(next, opts.size) > opts.maxWidth && line) {
      page.drawText(line, {
        x: opts.x,
        y,
        size: opts.size,
        font: opts.font,
        color: opts.color,
      });
      y -= lineHeight;
      line = word;
    } else {
      line = next;
    }
  }
  if (line) {
    page.drawText(line, {
      x: opts.x,
      y,
      size: opts.size,
      font: opts.font,
      color: opts.color,
    });
    y -= lineHeight;
  }
  return y;
}

/**
 * Ajoute une page « Rapport d'audit final » (style Adobe Sign) en fin de PDF.
 */
export async function appendFinalAuditReportPage(
  pdf: PDFDocument,
  report: SignatureAuditReport
): Promise<void> {
  const page = pdf.addPage([595.28, 841.89]); // A4
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const fontBold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { width, height } = page.getSize();
  const margin = 48;
  const contentW = width - margin * 2;

  // Cadre bleu léger
  page.drawRectangle({
    x: 28,
    y: 28,
    width: width - 56,
    height: height - 56,
    borderColor: BLUE,
    borderWidth: 1.5,
  });

  let y = height - 64;

  const title = pdfSafeText(
    `${report.documentTitle} — Rapport d'audit final`
  );
  page.drawText(title, {
    x: margin,
    y,
    size: 14,
    font: fontBold,
    color: TEXT,
    maxWidth: contentW - 100,
  });
  page.drawText(fmtDate(report.createdAt), {
    x: width - margin - font.widthOfTextAtSize(fmtDate(report.createdAt), 10),
    y,
    size: 10,
    font,
    color: MUTED,
  });

  y -= 28;

  // Encadré résumé
  const boxH = 78;
  page.drawRectangle({
    x: margin,
    y: y - boxH,
    width: contentW,
    height: boxH,
    color: BOX_BG,
    borderColor: BOX_BORDER,
    borderWidth: 1,
  });

  const rows: [string, string][] = [
    ["Créé le", fmtDate(report.createdAt)],
    ["Par", pdfSafeText(report.createdBy)],
    ["Statut", pdfSafeText(report.status)],
    ["ID transaction", pdfSafeText(report.transactionId)],
  ];
  let rowY = y - 16;
  for (const [k, v] of rows) {
    page.drawText(pdfSafeText(`${k} :`), {
      x: margin + 12,
      y: rowY,
      size: 9,
      font: fontBold,
      color: MUTED,
    });
    page.drawText(pdfSafeText(v).slice(0, 72), {
      x: margin + 110,
      y: rowY,
      size: 9,
      font,
      color: TEXT,
      maxWidth: contentW - 130,
    });
    rowY -= 16;
  }

  y -= boxH + 28;

  page.drawText(
    pdfSafeText(`Historique — ${report.documentTitle}`),
    {
    x: margin,
    y,
    size: 12,
    font: fontBold,
    color: BLUE,
  });
  y -= 8;
  page.drawLine({
    start: { x: margin, y },
    end: { x: margin + contentW, y },
    thickness: 1,
    color: BOX_BORDER,
  });
  y -= 20;

  const events = [...report.events].sort(
    (a, b) => a.at.getTime() - b.at.getTime()
  );

  for (const ev of events) {
    if (y < 100) break;

    // Pastille
    page.drawCircle({
      x: margin + 6,
      y: y + 3,
      size: 4,
      color: BLUE,
    });

    page.drawText(pdfSafeText(ev.title), {
      x: margin + 20,
      y,
      size: 10,
      font: fontBold,
      color: TEXT,
      maxWidth: contentW - 24,
    });
    y -= 13;

    if (ev.detail) {
      y = drawWrapped(page, ev.detail, {
        x: margin + 20,
        y,
        size: 8.5,
        font,
        color: MUTED,
        maxWidth: contentW - 24,
      });
    }

    page.drawText(fmtDateTimeGmt(ev.at), {
      x: margin + 20,
      y,
      size: 8,
      font,
      color: MUTED,
    });
    y -= 18;
  }

  // Certification footer
  y = Math.min(y, 120);
  page.drawLine({
    start: { x: margin, y: 88 },
    end: { x: margin + contentW, y: 88 },
    thickness: 0.75,
    color: BOX_BORDER,
  });

  page.drawText(pdfSafeText("Certifié par MEGA Signature"), {
    x: margin,
    y: 70,
    size: 10,
    font: fontBold,
    color: BLUE,
  });
  page.drawText(
    pdfSafeText(
      "Signatures électroniques incrustées — toute altération du contenu invalide ce certificat."
    ),
    {
      x: margin,
      y: 56,
      size: 8,
      font,
      color: MUTED,
      maxWidth: contentW,
    }
  );
  page.drawText(
    pdfSafeText(
      "L'identité des signataires et l'horodatage des événements sont enregistrés par le serveur MEGA."
    ),
    {
      x: margin,
      y: 44,
      size: 8,
      font,
      color: MUTED,
      maxWidth: contentW,
    }
  );
}
