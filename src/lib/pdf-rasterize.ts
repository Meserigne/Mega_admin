import path from "path";
import { pathToFileURL } from "url";
import { createCanvas } from "@napi-rs/canvas";
import { PDFDocument } from "pdf-lib";

type CanvasAndContext = {
  canvas: ReturnType<typeof createCanvas>;
  context: ReturnType<ReturnType<typeof createCanvas>["getContext"]>;
};

function resolvePdfWorkerSrc(): string {
  // Worker déjà présent dans /public (utilisé aussi côté navigateur)
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

  const canvasFactory = {
    create(width: number, height: number): CanvasAndContext {
      const canvas = createCanvas(
        Math.max(1, Math.floor(width)),
        Math.max(1, Math.floor(height))
      );
      const context = canvas.getContext("2d");
      return { canvas, context };
    },
    reset(canvasAndContext: CanvasAndContext, width: number, height: number) {
      canvasAndContext.canvas.width = Math.max(1, Math.floor(width));
      canvasAndContext.canvas.height = Math.max(1, Math.floor(height));
    },
    destroy(canvasAndContext: CanvasAndContext) {
      canvasAndContext.canvas.width = 0;
      canvasAndContext.canvas.height = 0;
    },
  };

  const loadingTask = pdfjs.getDocument({
    data: pdfBytes.slice(0),
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
    // @ts-expect-error node canvas factory
    canvasFactory,
  });

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
      // @ts-expect-error Node canvas context
      canvasContext: ctx,
      viewport,
      // @ts-expect-error Node canvas
      canvas,
    }).promise;

    const png = canvas.toBuffer("image/png");
    const embedded = await out.embedPng(png);
    const pdfPage = out.addPage([embedded.width / scale, embedded.height / scale]);
    pdfPage.drawImage(embedded, {
      x: 0,
      y: 0,
      width: pdfPage.getWidth(),
      height: pdfPage.getHeight(),
    });
  }

  try {
    await doc.destroy();
  } catch {
    /* ignore */
  }

  return out.save({ useObjectStreams: false });
}
