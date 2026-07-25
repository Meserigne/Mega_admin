import { randomBytes } from "crypto";
import { createRequire } from "module";
import { join } from "path";

type QpdfModule = {
  FS: {
    writeFile: (path: string, data: Uint8Array) => void;
    readFile: (path: string) => Uint8Array;
    unlink: (path: string) => void;
  };
  callMain: (args: string[]) => void;
};

let qpdfPromise: Promise<QpdfModule> | null = null;

function resolveWasmPath(): string {
  const require = createRequire(join(process.cwd(), "package.json"));
  return require.resolve("@neslinesli93/qpdf-wasm/dist/qpdf.wasm");
}

async function getQpdf(): Promise<QpdfModule> {
  if (!qpdfPromise) {
    qpdfPromise = (async () => {
      const createModule = (await import("@neslinesli93/qpdf-wasm")).default;
      const mod = await createModule({
        locateFile: () => resolveWasmPath(),
        noInitialRun: true,
      });
      return mod as unknown as QpdfModule;
    })();
  }
  return qpdfPromise;
}

/**
 * Verrouille le PDF : ouverture libre (mot de passe utilisateur vide),
 * modification / annotations / formulaires interdits (mot de passe owner aléatoire).
 * Utilise qpdf (AES-256) — PDF valide Acrobat / Aperçu.
 */
export async function lockPdfAgainstModification(
  bytes: Uint8Array
): Promise<Uint8Array> {
  try {
    const qpdf = await getQpdf();
    const inPath = `/mega-in-${randomBytes(8).toString("hex")}.pdf`;
    const outPath = `/mega-out-${randomBytes(8).toString("hex")}.pdf`;
    const ownerPassword = randomBytes(24).toString("base64url");

    qpdf.FS.writeFile(inPath, bytes);
    try {
      qpdf.callMain([
        "--encrypt",
        "",
        ownerPassword,
        "256",
        "--modify=none",
        "--annotate=n",
        "--form=n",
        "--assemble=n",
        "--extract=y",
        "--print=full",
        "--",
        inPath,
        outPath,
      ]);
      const out = qpdf.FS.readFile(outPath);
      return out instanceof Uint8Array ? out : new Uint8Array(out);
    } finally {
      try {
        qpdf.FS.unlink(inPath);
      } catch {
        /* ignore */
      }
      try {
        qpdf.FS.unlink(outPath);
      } catch {
        /* ignore */
      }
    }
  } catch (e) {
    console.error("[pdf-lock] qpdf encrypt failed", e);
    return bytes;
  }
}
