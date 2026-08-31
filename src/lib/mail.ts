import "server-only";

import { createTransport, type Transporter } from "nodemailer";

const ACCENT = "#c8f14e";
const INK = "#0a0c0f";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `${name} ist nicht gesetzt – ohne SMTP-Konfiguration kann GymTracker keine Mails verschicken.`,
    );
  }
  return value;
}

let cachedTransport: Transporter | null = null;

/**
 * Baut den SMTP-Transport lazy und einmalig auf. secure (TLS) wird aus dem
 * Port abgeleitet (465 = implizites TLS, sonst STARTTLS), analog zum
 * COOKIE_SECURE-Muster in lib/auth.ts – die meisten Provider brauchen keine
 * explizite Angabe.
 */
function getTransport(): Transporter {
  if (cachedTransport) return cachedTransport;

  const port = Number(process.env.SMTP_PORT ?? 587);
  cachedTransport = createTransport({
    host: requireEnv("SMTP_HOST"),
    port,
    secure: process.env.SMTP_SECURE === "true" || port === 465,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
      : undefined,
  });
  return cachedTransport;
}

/** Absolute URL für Mail-Links – relative Links ergeben in einer Mail keinen Sinn. */
export function appUrl(path: string): string {
  const base = requireEnv("APP_URL").replace(/\/$/, "");
  return `${base}${path}`;
}

function layout(bodyHtml: string, buttonLabel: string, buttonUrl: string): string {
  return `<!doctype html>
<html>
  <body style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr>
        <td style="padding:32px 32px 24px;">
          <div style="display:inline-flex;align-items:center;gap:8px;font-weight:700;font-size:18px;color:${INK};margin-bottom:24px;">
            🏋️ GymTracker
          </div>
          <div style="font-size:15px;line-height:1.6;color:#27272a;">
            ${bodyHtml}
          </div>
          <table role="presentation" style="margin-top:28px;">
            <tr>
              <td style="border-radius:10px;background:${ACCENT};">
                <a href="${buttonUrl}" style="display:inline-block;padding:12px 24px;font-weight:700;font-size:15px;color:${INK};text-decoration:none;">
                  ${buttonLabel}
                </a>
              </td>
            </tr>
          </table>
          <p style="margin-top:24px;font-size:12px;color:#a1a1aa;word-break:break-all;">
            Falls der Button nicht funktioniert, öffne diesen Link:<br />
            <a href="${buttonUrl}" style="color:#71717a;">${buttonUrl}</a>
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

async function sendMail(options: { to: string; subject: string; html: string; text: string }) {
  const from = requireEnv("SMTP_FROM");
  await getTransport().sendMail({ from, ...options });
}

/**
 * Kombinierte Willkommens- und Bestätigungsmail. Bewusst eine einzige Mail
 * statt zwei separaten – für eine App im Freundeskreis wäre eine reine
 * Verifizierungsmail gefolgt von einer separaten Willkommensmail unnötig
 * doppelt.
 */
export async function sendVerificationEmail(
  to: string,
  name: string,
  url: string,
): Promise<void> {
  await sendMail({
    to,
    subject: "Willkommen bei GymTracker – bitte E-Mail bestätigen",
    html: layout(
      `<p>Hi ${name},</p>
       <p>schön, dass du dabei bist! Bestätige kurz deine E-Mail-Adresse,
       dann kann's losgehen.</p>
       <p>Der Link ist 24 Stunden gültig.</p>`,
      "E-Mail bestätigen",
      url,
    ),
    text: `Hi ${name},\n\nschön, dass du dabei bist! Bestätige deine E-Mail-Adresse über diesen Link (24 Stunden gültig):\n${url}\n`,
  });
}

export async function sendPasswordResetEmail(
  to: string,
  name: string,
  url: string,
): Promise<void> {
  await sendMail({
    to,
    subject: "GymTracker – Passwort zurücksetzen",
    html: layout(
      `<p>Hi ${name},</p>
       <p>du hast ein neues Passwort für dein GymTracker-Konto angefordert.
       Falls du das nicht warst, kannst du diese Mail ignorieren – es
       ändert sich nichts an deinem Konto.</p>
       <p>Der Link ist 1 Stunde gültig.</p>`,
      "Neues Passwort vergeben",
      url,
    ),
    text: `Hi ${name},\n\ndu hast ein neues Passwort angefordert. Falls du das nicht warst, ignoriere diese Mail einfach.\n\nLink (1 Stunde gültig):\n${url}\n`,
  });
}
