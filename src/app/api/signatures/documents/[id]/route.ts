import { NextRequest, NextResponse } from "next/server";
import {
  isBlobArchivePath,
  isDbArchivePath,
  readArchiveBytes,
} from "@/lib/archive-storage";
import { requireApiAuth, unauthorizedResponse } from "@/lib/api-auth";
import { buildSignedPdfForEnvelope } from "@/lib/signature-pdf";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await requireApiAuth();
  if (!session) return unauthorizedResponse();

  const { id } = await params;
  const signed =
    request.nextUrl.searchParams.get("signed") === "1" ||
    request.nextUrl.searchParams.get("signed") === "true";

  const envelope = await prisma.signatureEnvelope.findUnique({
    where: { id },
    select: {
      id: true,
      deletedAt: true,
      createurId: true,
      fichierNom: true,
      fichierMime: true,
      fichierChemin: true,
      destinataires: {
        select: { userId: true, email: true },
      },
    },
  });
  if (!envelope || envelope.deletedAt) {
    return NextResponse.json({ error: "Document introuvable." }, { status: 404 });
  }

  const email = session.email?.toLowerCase() ?? "";
  const canSee =
    envelope.createurId === session.id ||
    envelope.destinataires.some(
      (d) =>
        d.userId === session.id ||
        (email && d.email.toLowerCase() === email)
    );
  if (!canSee) {
    return NextResponse.json({ error: "Accès refusé." }, { status: 403 });
  }

  try {
    if (signed) {
      try {
        const flattened = await buildSignedPdfForEnvelope(envelope.id);
        if (!flattened) {
          return NextResponse.json(
            { error: "Impossible de générer le PDF signé (fichier source manquant)." },
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
        console.error("signed pdf flatten error:", e);
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
      where: { id },
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
    console.error("signature document download error:", e);
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
