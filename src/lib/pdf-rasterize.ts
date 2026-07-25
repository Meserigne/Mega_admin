import path from "path";
import { pathToFileURL } from "url";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

function resolvePdfWorkerSrc(): string {
  const workerPath = path.join(
    process.cwd(),
    "public",
    "pdf.worker.min.mjs"
  );
  return pathToFileURL(workerPath).href;
}

/**
 * Transforme chaque page en image PNG puis reconstruit un PDF.
 * Résultat : ouverture libre, sans mot de passe, contenu non éditable (pixels).
 */
export async function rasterizePdfToImages(
  pdfBytes: Uint8Array,
  options?: { scale?: number }
): Promise<Uint8Array> {
  const scale = options?.scale ?? 2;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  pdfjs.GlobalWorkerOptions.workerSrc = resolvePdfWorkerSrc();

  // Factory typée en any : les types pdf.js attendent un SvgCanvas navigateur
  const canvasFactory = {
    create(width: number, height: number) {
      const canvas = createCanvas(
        Math.max(1, Math.floor(width)),
        Math.max(1, Math.floor(height))
      );
      return {
        canvas,
        context: canvas.getContext("2d"),
      };
    },
    reset(
      canvasAndContext: { canvas: { width: number; height: number } },
      width: number,
      height: number
    ) {
      canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
      canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
    },
    destroy(canvasAndContext: { canvas: { width: number; height: number } }) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    },
  };

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(0),
    useSystemFonts: true,
    disableFontFace: true,
    canvasFactory,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  const doc = await loadingTask.promise;
  const out = await PDFDocument.create();
  out.setProducer("MEGA Signature");
  out.setCreator("MEGA Signature");

  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(
      Math.max(1, Math.floor(viewport.width)),
      Math.max(1, Math.floor(viewport.height))
    );
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    await page.render({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvasContext: ctx as any,
      viewport,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      canvas: canvas as any,
    }).promise;

    const png = canvas.toBuffer("image/png");
    const embedded = await out.embedPng(png);
    const pdfPage = out.addPage([
      embedded.width / scale,
      embedded.height / scale,
    ]);
    pdfPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
    });
  }

  return out.save({ useObjectStreams: false });
}
