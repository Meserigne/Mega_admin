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
    include: {
      envelope: {
        include: {
          champs: { orderBy: { createdAt: "asc" } },
          destinataires: true,
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
        if (flattened) {
          return new NextResponse(Buffer.from(flattened.bytes), {
            headers: {
              "Content-Type": "application/pdf",
              "Content-Length": String(flattened.bytes.byteLength),
              "Content-Disposition": `inline; filename="${encodeURIComponent(flattened.fileName)}"`,
              "Cache-Control": "private, no-store",
            },
          });
        }
      } catch (e) {
        console.error("public signed pdf error:", e);
      }
    }

    if (
      (!envelope.fichierContenu || envelope.fichierContenu.length === 0) &&
      isDbArchivePath(envelope.fichierChemin)
    ) {
      return NextResponse.json(
        { error: "Fichier absent du stockage." },
        { status: 404 }
      );
    }

    const body = await readArchiveBytes(
      envelope.fichierChemin,
      envelope.fichierContenu
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
