import { del, get, put } from "@vercel/blob";
import { mkdir, unlink, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { randomUUID } from "crypto";

export const MAX_ARCHIVE_BYTES = 15 * 1024 * 1024;

const ALLOWED_EXT = new Set([
  ".pdf",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
  ".xlsx",
  ".xls",
  ".doc",
  ".docx",
]);

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".xlsx":
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".xls": "application/vnd.ms-excel",
  ".doc": "application/msword",
  ".docx":
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export function hasBlobStorage(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}

/**
 * Sur Vercel sans Blob : BYTEA en base.
 * En local : disque data/archives.
 * (Blob est géré à part dans saveArchiveFile.)
 */
export function usesDatabaseArchiveStorage(): boolean {
  const forced = process.env.ARCHIVES_STORAGE?.trim().toLowerCase();
  if (forced === "db") return true;
  if (forced === "fs") return false;
  return Boolean(
    process.env.VERCEL ||
      process.env.AWS_LAMBDA_FUNCTION_NAME ||
      process.env.NETLIFY
  );
}

function getArchivesRoot(): string {
  const fromEnv = process.env.ARCHIVES_DIR?.trim();
  if (fromEnv) return path.resolve(fromEnv);
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), "mega-archives");
  }
  return path.join(process.cwd(), "data", "archives");
}

export function isBlobArchivePath(cheminStockage: string): boolean {
  return (
    cheminStockage.startsWith("https://") ||
    cheminStockage.startsWith("blob:")
  );
}

export function isDbArchivePath(cheminStockage: string): boolean {
  return cheminStockage.startsWith("db/");
}

export function blobUrlFromPath(cheminStockage: string): string {
  return cheminStockage.startsWith("blob:")
    ? cheminStockage.slice("blob:".length)
    : cheminStockage;
}

export function resolveArchivePath(cheminStockage: string): string {
  if (isDbArchivePath(cheminStockage) || isBlobArchivePath(cheminStockage)) {
    throw new Error("Ce fichier n'est pas stocké sur disque local.");
  }
  const root = getArchivesRoot();
  const resolved = path.resolve(root, cheminStockage);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Chemin de fichier invalide.");
  }
  return resolved;
}

export type StoredArchive = {
  cheminStockage: string;
  mimeType: string;
  tailleOctets: number;
  contenu?: Uint8Array;
};

export function validateArchiveFileMeta(file: {
  name: string;
  size: number;
}): { ext: string; mimeType: string } {
  if (file.size <= 0) throw new Error("Fichier vide.");
  if (file.size > MAX_ARCHIVE_BYTES) {
    throw new Error("Fichier trop volumineux (maximum 15 Mo).");
  }
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_EXT.has(ext)) {
    throw new Error(
      "Format non autorisé. Formats acceptés : PDF, images, Word, Excel."
    );
  }
  return {
    ext,
    mimeType: MIME_BY_EXT[ext] || "application/octet-stream",
  };
}

/** Chemin Blob recommandé (client upload). */
export function buildBlobPathname(subdir: string, originalName: string): string {
  const ext = path.extname(originalName).toLowerCase() || ".bin";
  const relativeDir = subdir.replace(/\\/g, "/").replace(/^\/+/, "");
  return `archives/${relativeDir}/${randomUUID()}${ext}`.replace(/\/+/g, "/");
}

export const ALLOWED_ARCHIVE_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/octet-stream",
];

export async function saveArchiveBytes(
  buffer: Uint8Array,
  opts: {
    subdir: string;
    fileName: string;
    mimeType?: string;
  }
): Promise<StoredArchive> {
  const { ext, mimeType } = validateArchiveFileMeta({
    name: opts.fileName,
    size: buffer.byteLength,
  });
  const safeName = `${randomUUID()}${ext}`;
  const relativeDir = opts.subdir.replace(/\\/g, "/").replace(/^\/+/, "");
  const contentType = opts.mimeType || mimeType;

  if (hasBlobStorage()) {
    const pathname = buildBlobPathname(opts.subdir, opts.fileName);
    const blob = await put(pathname, Buffer.from(buffer), {
      access: "private",
      contentType,
      addRandomSuffix: false,
    });
    return {
      cheminStockage: blob.url,
      mimeType: contentType,
      tailleOctets: buffer.byteLength,
    };
  }

  if (usesDatabaseArchiveStorage()) {
    return {
      cheminStockage: `db/${relativeDir}/${safeName}`.replace(/\/+/g, "/"),
      mimeType: contentType,
      tailleOctets: buffer.byteLength,
      contenu: buffer,
    };
  }

  const dir = path.join(getArchivesRoot(), relativeDir);
  try {
    await mkdir(dir, { recursive: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (
      msg.includes("ENOENT") ||
      msg.includes("EROFS") ||
      msg.includes("EACCES")
    ) {
      throw new Error(
        "Stockage fichiers indisponible. Configurez Vercel Blob (BLOB_READ_WRITE_TOKEN) ou ARCHIVES_DIR."
      );
    }
    throw e;
  }

  const fullPath = path.join(dir, safeName);
  await writeFile(fullPath, buffer);

  return {
    cheminStockage: path.join(relativeDir, safeName).replace(/\\/g, "/"),
    mimeType: contentType,
    tailleOctets: buffer.byteLength,
  };
}

export async function saveArchiveFile(
  file: File,
  subdir: string
): Promise<StoredArchive> {
  const buffer = new Uint8Array(await file.arrayBuffer());
  return saveArchiveBytes(buffer, {
    subdir,
    fileName: file.name,
    mimeType: file.type || undefined,
  });
}

export async function readArchiveBytes(
  cheminStockage: string,
  contenu: Uint8Array | null | undefined
): Promise<Uint8Array> {
  if (contenu && contenu.length > 0) {
    return contenu;
  }
  if (isBlobArchivePath(cheminStockage)) {
    const url = blobUrlFromPath(cheminStockage);
    const result = await get(url, { access: "private" });
    if (!result || result.statusCode !== 200 || !result.stream) {
      throw new Error("Fichier Blob introuvable.");
    }
    const reader = result.stream.getReader();
    const chunks: Uint8Array[] = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.length;
    }
    return out;
  }
  if (isDbArchivePath(cheminStockage)) {
    throw new Error("Fichier absent du stockage.");
  }
  // Ancien chemin disque (souvent perdu sur Vercel)
  try {
    const { readFile } = await import("fs/promises");
    return new Uint8Array(await readFile(resolveArchivePath(cheminStockage)));
  } catch {
    throw new Error(
      "Fichier introuvable (stockage temporaire expiré). Renvoyez le document pour signature."
    );
  }
}

export async function deleteArchiveFile(cheminStockage: string): Promise<void> {
  if (isDbArchivePath(cheminStockage)) return;
  if (isBlobArchivePath(cheminStockage)) {
    try {
      await del(blobUrlFromPath(cheminStockage));
    } catch {
      // déjà absent
    }
    return;
  }
  try {
    await unlink(resolveArchivePath(cheminStockage));
  } catch {
    // Fichier déjà absent sur disque
  }
}
