import { NextRequest, NextResponse } from "next/server";
import {
  isBlobArchivePath,
  isDbArchivePath,
  readArchiveBytes,
} from "@/lib/archive-storage";
import { buildSignedPdfForEnvelope } from "@/lib/signature-pdf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const t = token?.trim();
  if (!t || t.length < 16) {
    return NextResponse.json({ error: "Lien invalide." }, { status: 404 });
  }

  const signed =
    request.nextUrl.searchParams.get("signed") === "1" ||
    request.nextUrl.searchParams.get("signed") === "true";

  const dest = await prisma.signatureDestinataire.findUnique({
    where: { accessToken: t },
    select: {
      envelope: {
        select: {
          id: true,
          deletedAt: true,
          fichierNom: true,
          fichierMime: true,
          fichierChemin: true,
        },
      },
    },
  });
  if (!dest) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  const envelope = dest.envelope;
  if (envelope.deletedAt) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  try {
    if (signed) {
      try {
        const flattened = await buildSignedPdfForEnvelope(envelope.id);
        if (!flattened) {
          return NextResponse.json(
            { error: "Impossible de générer le PDF signé." },
            { status: 500 }
          );
        }
        return new NextResponse(Buffer.from(flattened.bytes), {
          headers: {
            "Content-Type": "application/pdf",
            "Content-Length": String(flattened.bytes.byteLength),
            "Content-Disposition": `inline; filename="${encodeURIComponent(flattened.fileName)}"`,
            "Cache-Control": "private, max-age=300",
          },
        });
      } catch (e) {
        console.error("public signed pdf error:", e);
        return NextResponse.json(
          {
            error:
              e instanceof Error
                ? `Génération PDF signé échouée : ${e.message}`
                : "Génération PDF signé échouée.",
          },
          { status: 500 }
        );
      }
    }

    const fileRow = await prisma.signatureEnvelope.findUnique({
      where: { id: envelope.id },
      select: { fichierChemin: true, fichierContenu: true },
    });
    if (!fileRow) {
      return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
    }

    if (
      (!fileRow.fichierContenu || fileRow.fichierContenu.length === 0) &&
      isDbArchivePath(fileRow.fichierChemin)
    ) {
      return NextResponse.json(
        { error: "Fichier absent du stockage." },
        { status: 404 }
      );
    }

    const body = await readArchiveBytes(
      fileRow.fichierChemin,
      fileRow.fichierContenu
    );
    const mime = envelope.fichierMime ?? "application/octet-stream";

    return new NextResponse(Buffer.from(body), {
      headers: {
        "Content-Type": mime,
        "Content-Length": String(body.length),
        "Content-Disposition": `inline; filename="${encodeURIComponent(envelope.fichierNom)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    console.error("public signature document error:", e);
    return NextResponse.json(
      {
        error: isBlobArchivePath(envelope.fichierChemin)
          ? "Fichier Blob inaccessible."
          : "Fichier absent du stockage.",
      },
      { status: 404 }
    );
  }
}
