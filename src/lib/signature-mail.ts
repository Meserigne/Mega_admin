import {
  sendMail,
  isMailConfigured,
  signatureContactEmail,
  type SendMailResult,
} from "@/lib/mail";

const BRAND = "#1e3a5f";
const ACCENT = "#2563eb";

function appBaseUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL?.trim() ||
    process.env.APP_URL?.trim() ||
    "http://localhost:3000";
  return raw.replace(/\/$/, "");
}

function logoUrl(): string {
  return `${appBaseUrl()}/mega-logo.png`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapCard(inner: string): string {
  return `<!DOCTYPE html>
<html lang="fr">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width" /></head>
<body style="margin:0;padding:24px;background:#eef1f5;font-family:Segoe UI,Helvetica,Arial,sans-serif;color:#1f2937;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
    <tr><td align="center">
      <table role="presentation" width="560" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);">
        <tr>
          <td style="padding:20px 28px;border-bottom:1px solid #e5e7eb;">
            <img src="${logoUrl()}" alt="MEGA" height="36" style="height:36px;width:auto;display:block;" />
          </td>
        </tr>
        <tr><td style="padding:28px;">${inner}</td></tr>
        <tr>
          <td style="padding:16px 28px 24px;border-top:1px solid #e5e7eb;font-size:11px;color:#9ca3af;text-align:center;">
            Propulsé par <strong style="color:${BRAND};">MEGA Signature</strong>
          </td>
        </tr>
      </table>
      <p style="margin:16px 0 0;font-size:11px;color:#9ca3af;max-width:560px;">
        En poursuivant, vous acceptez que cet accord puisse être signé au moyen de signatures électroniques ou manuscrites.
      </p>
    </td></tr>
  </table>
</body>
</html>`;
}

export function signUrlForToken(accessToken: string): string {
  return `${appBaseUrl()}/sign/${accessToken}`;
}

export async function sendSignatureInviteEmail(input: {
  to: string;
  destinataireNom: string;
  createurNom: string;
  /** Ignoré : on affiche toujours l’adresse générique Signature. */
  createurEmail?: string | null;
  documentTitle: string;
  message?: string | null;
  accessToken: string;
}): Promise<SendMailResult> {
  const link = signUrlForToken(input.accessToken);
  const doc = escapeHtml(input.documentTitle);
  const requester = escapeHtml(input.createurNom);
  const contactEmail = escapeHtml(signatureContactEmail());
  const msg = escapeHtml(
    input.message?.trim() || "Veuillez vérifier et signer ce document."
  );

  const html = wrapCard(`
    <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">
      <strong>${requester}</strong> demande votre signature sur
      <a href="${link}" style="color:${ACCENT};font-weight:600;text-decoration:none;">${doc}</a>
    </p>
    <p style="margin:24px 0;text-align:center;">
      <a href="${link}" style="display:inline-block;background:${ACCENT};color:#fff;text-decoration:none;font-weight:600;padding:12px 28px;border-radius:6px;font-size:15px;">
        Review and sign
      </a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">${msg}</p>
    <p style="margin:0;font-size:13px;color:#6b7280;">
      <strong style="color:#111827;text-transform:uppercase;letter-spacing:.02em;">${requester}</strong><br/>
      MEGA Signature · <a href="mailto:${contactEmail}" style="color:${ACCENT};text-decoration:none;">${contactEmail}</a>
    </p>
    <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;" />
    <p style="margin:0;font-size:13px;color:#6b7280;">
      Après votre signature de <strong>${doc}</strong>, toutes les parties recevront une copie PDF finale.
    </p>
    <p style="margin:12px 0 0;font-size:12px;color:#9ca3af;">
      Ne transférez pas cet e-mail : si vous ne souhaitez pas signer, utilisez l’option déléguer depuis le lien.
    </p>
  `);

  return sendMail({
    to: input.to,
    subject: `${input.createurNom} requests your signature on ${input.documentTitle}`,
    html,
    text: `${input.createurNom} demande votre signature sur « ${input.documentTitle} ».\n\nOuvrir : ${link}`,
  });
}

export async function sendSignatureCompletedEmail(input: {
  to: string | string[];
  documentTitle: string;
  parties: string[];
  pdfBytes: Uint8Array;
  pdfFileName: string;
  viewUrl?: string;
}): Promise<SendMailResult> {
  const doc = escapeHtml(input.documentTitle);
  const parties = input.parties.map(escapeHtml).join(", ");
  const view = input.viewUrl || appBaseUrl();

  const html = wrapCard(`
    <p style="margin:0 0 8px;text-align:center;">
      <img src="${logoUrl()}" alt="MEGA" height="40" style="height:40px;width:auto;" />
    </p>
    <h1 style="margin:12px 0 16px;font-size:18px;line-height:1.4;color:#111827;font-weight:600;">
      Le document ${doc} entre ${parties} est signé et classé.
    </h1>
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">À : ${parties}</p>
    <p style="margin:0 0 8px;font-size:14px;color:#4b5563;">
      Vous trouverez en pièce jointe une copie finale de <strong>${doc}</strong>.
    </p>
    <p style="margin:0 0 16px;font-size:14px;color:#4b5563;">
      Des exemplaires ont été automatiquement envoyés à toutes les parties de l’accord.
    </p>
    <p style="margin:0;font-size:14px;">
      <a href="${view}" style="color:${ACCENT};">Ouvrir le document</a>
    </p>
  `);

  return sendMail({
    to: input.to,
    subject: `Le document ${input.documentTitle} est signé et classé.`,
    html,
    text: `Le document « ${input.documentTitle} » est signé et classé. Copie PDF en pièce jointe.`,
    attachments: [
      {
        filename: input.pdfFileName,
        content: input.pdfBytes,
        contentType: "application/pdf",
      },
    ],
  });
}

export { isMailConfigured, appBaseUrl };
