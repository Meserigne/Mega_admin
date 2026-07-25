import { mkdir, writeFile } from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";

export type MailAttachment = {
  filename: string;
  content: Buffer | Uint8Array;
  contentType?: string;
};

export type SendMailInput = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  attachments?: MailAttachment[];
};

export type SendMailResult = {
  ok: boolean;
  mode: "resend" | "smtp" | "outbox" | "none";
  error?: string;
  outboxPath?: string;
  messageId?: string;
};

function mailFrom(): string {
  return (
    process.env.MAIL_FROM?.trim() ||
    process.env.SMTP_FROM?.trim() ||
    "MEGA Signature <contact@mega-sn.com>"
  );
}

/** Adresse e-mail publique pour les échanges Signature (jamais le mail perso du créateur). */
export function signatureContactEmail(): string {
  const dedicated = process.env.SIGNATURE_CONTACT_EMAIL?.trim();
  if (dedicated && dedicated.includes("@")) return dedicated.toLowerCase();

  const from = mailFrom();
  const angled = from.match(/<([^>]+)>/);
  const raw = (angled?.[1] || from).trim();
  if (raw.includes("@")) return raw.toLowerCase();
  return "contact@mega-sn.com";
}

export function mailFromDisplay(): string {
  return mailFrom();
}

function recipients(to: string | string[]): string[] {
  return (Array.isArray(to) ? to : [to])
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

function outboxEnabled(): boolean {
  if (process.env.MAIL_DEV_OUTBOX === "false") return false;
  if (process.env.MAIL_DEV_OUTBOX === "true") return true;
  return process.env.NODE_ENV !== "production";
}

async function writeOutbox(input: SendMailInput): Promise<string> {
  const dir = path.join(process.cwd(), ".data", "mail-outbox");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeSubject = input.subject.replace(/[^\w\-]+/g, "_").slice(0, 60);
  const base = `${stamp}_${safeSubject}`;
  const htmlPath = path.join(dir, `${base}.html`);

  const meta = `<!--
to: ${recipients(input.to).join(", ")}
subject: ${input.subject}
from: ${mailFrom()}
attachments: ${(input.attachments ?? []).map((a) => a.filename).join(", ") || "aucune"}
-->
`;
  await writeFile(htmlPath, meta + input.html, "utf8");

  for (const att of input.attachments ?? []) {
    const attPath = path.join(dir, `${base}__${att.filename}`);
    await writeFile(attPath, Buffer.from(att.content));
  }

  return htmlPath;
}

async function sendViaResend(input: SendMailInput): Promise<SendMailResult> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return { ok: false, mode: "none", error: "RESEND_API_KEY manquant" };

  const payload: Record<string, unknown> = {
    from: mailFrom(),
    to: recipients(input.to),
    subject: input.subject,
    html: input.html,
    text: input.text,
  };

  if (input.attachments?.length) {
    payload.attachments = input.attachments.map((a) => ({
      filename: a.filename,
      content: Buffer.from(a.content).toString("base64"),
      content_type: a.contentType,
    }));
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const body = (await res.json().catch(() => ({}))) as {
    id?: string;
    message?: string;
    error?: { message?: string };
  };

  if (!res.ok) {
    return {
      ok: false,
      mode: "resend",
      error:
        body.error?.message ||
        body.message ||
        `Resend HTTP ${res.status}`,
    };
  }

  return { ok: true, mode: "resend", messageId: body.id };
}

async function sendViaSmtp(input: SendMailInput): Promise<SendMailResult> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    return { ok: false, mode: "none", error: "SMTP incomplet" };
  }

  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;

  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });

    const info = await transport.sendMail({
      from: mailFrom(),
      to: recipients(input.to).join(", "),
      subject: input.subject,
      html: input.html,
      text: input.text,
      attachments: (input.attachments ?? []).map((a) => ({
        filename: a.filename,
        content: Buffer.from(a.content),
        contentType: a.contentType,
      })),
    });

    return {
      ok: true,
      mode: "smtp",
      messageId: typeof info.messageId === "string" ? info.messageId : undefined,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur SMTP";
    // Message plus clair pour Google Workspace
    const friendly = /BadCredentials|Username and Password not accepted/i.test(
      message
    )
      ? "Google refuse le mot de passe du compte pour SMTP. Utilisez un mot de passe d’application (myaccount.google.com/apppasswords)."
      : message;
    return { ok: false, mode: "smtp", error: friendly };
  }
}

/** Envoie un e-mail (Resend → SMTP → outbox local). */
export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const to = recipients(input.to);
  if (to.length === 0) {
    return { ok: false, mode: "none", error: "Destinataire manquant" };
  }

  try {
    if (process.env.RESEND_API_KEY?.trim()) {
      const r = await sendViaResend(input);
      if (r.ok) return r;
      console.error("[mail] Resend failed:", r.error);
      if (outboxEnabled()) {
        const outboxPath = await writeOutbox(input);
        return { ok: true, mode: "outbox", outboxPath, error: r.error };
      }
      return r;
    }

    if (process.env.SMTP_HOST?.trim() && process.env.SMTP_USER?.trim()) {
      const r = await sendViaSmtp(input);
      if (r.ok) return r;
      console.error("[mail] SMTP failed:", r.error);
      if (outboxEnabled()) {
        const outboxPath = await writeOutbox(input);
        return { ok: true, mode: "outbox", outboxPath, error: r.error };
      }
      return r;
    }

    if (outboxEnabled()) {
      const outboxPath = await writeOutbox(input);
      console.info("[mail] Outbox →", outboxPath);
      return {
        ok: true,
        mode: "outbox",
        outboxPath,
        error:
          "SMTP/Resend non configuré — e-mail enregistré localement uniquement.",
      };
    }

    return {
      ok: false,
      mode: "none",
      error:
        "Mail non configuré. Ajoutez RESEND_API_KEY ou SMTP_HOST/SMTP_USER/SMTP_PASS dans .env.local",
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erreur d'envoi mail";
    console.error("[mail]", message);
    if (outboxEnabled()) {
      try {
        const outboxPath = await writeOutbox(input);
        return { ok: true, mode: "outbox", outboxPath, error: message };
      } catch {
        /* ignore */
      }
    }
    return { ok: false, mode: "none", error: message };
  }
}

export function isMailConfigured(): boolean {
  return Boolean(
    process.env.RESEND_API_KEY?.trim() ||
      (process.env.SMTP_HOST?.trim() &&
        process.env.SMTP_USER?.trim() &&
        process.env.SMTP_PASS?.trim())
  );
}

/** Vérifie que SMTP accepte vraiment les identifiants. */
export async function verifyMailTransport(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (process.env.RESEND_API_KEY?.trim()) {
    return { ok: true };
  }
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();
  if (!host || !user || !pass) {
    return {
      ok: false,
      error: "SMTP incomplet (HOST / USER / PASS).",
    };
  }
  const port = Number(process.env.SMTP_PORT || 587);
  const secure =
    process.env.SMTP_SECURE === "true" ||
    process.env.SMTP_SECURE === "1" ||
    port === 465;
  try {
    const transport = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
    });
    await transport.verify();
    return { ok: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : "SMTP invalide";
    const friendly = /BadCredentials|Username and Password not accepted/i.test(
      message
    )
      ? "Google refuse le mot de passe du compte. Créez un mot de passe d’application : https://myaccount.google.com/apppasswords"
      : message;
    return { ok: false, error: friendly };
  }
}
