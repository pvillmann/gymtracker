"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  consumeEmailVerificationToken,
  consumePasswordResetToken,
  createEmailVerificationToken,
  createPasswordResetToken,
  createSession,
  destroySession,
  hasRecentEmailVerificationToken,
  hasRecentPasswordResetToken,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { newId } from "@/lib/ids";
import { optionalText, text } from "@/lib/formdata";
import { appUrl, sendPasswordResetEmail, sendVerificationEmail } from "@/lib/mail";
import { fail, type FormState } from "@/lib/result";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben."),
  password: z.string().min(8, "Das Passwort braucht mindestens 8 Zeichen."),
});

const registration = credentials.extend({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(60),
  code: z.string().optional(),
});

const emailOnly = z.object({
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben."),
});

/**
 * Erzeugt einen Verifizierungs-Token und verschickt die Mail. Wirft nicht bei
 * SMTP-Fehlern weiter – das Konto existiert so oder so schon, ein
 * Mailausfall soll die Registrierung nicht als Ganzes scheitern lassen.
 */
async function sendVerificationLink(
  userId: string,
  email: string,
  name: string,
): Promise<boolean> {
  const token = await createEmailVerificationToken(userId);
  try {
    await sendVerificationEmail(email, name, appUrl(`/verify-email?token=${token}`));
    return true;
  } catch (error) {
    console.error("Verifizierungsmail konnte nicht verschickt werden:", error);
    return false;
  }
}

export async function registerAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = registration.safeParse({
    name: text(formData, "name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
    code: optionalText(formData, "code"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  // Optionaler Riegel für selbst gehostete Instanzen: ist REGISTRATION_CODE
  // gesetzt, kann sich nur registrieren, wer ihn kennt.
  const required = process.env.REGISTRATION_CODE;
  if (required && parsed.data.code !== required) {
    return fail("Registrierungscode stimmt nicht.");
  }

  const { name, email, password } = parsed.data;

  const existing = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);
  if (existing.length > 0) {
    return fail("Für diese E-Mail gibt es schon ein Konto.");
  }

  const id = newId();
  await db.insert(users).values({
    id,
    email,
    name,
    passwordHash: await hashPassword(password),
  });

  const sent = await sendVerificationLink(id, email, name);
  const query = new URLSearchParams({ email });
  if (!sent) query.set("mailFailed", "1");
  redirect(`/verify-email/pending?${query}`);
}

export async function loginAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = credentials.safeParse({
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  // Bei falschen Eingaben bewusst dieselbe Meldung wie bei falschem Passwort,
  // damit man nicht durchprobieren kann, welche E-Mails registriert sind.
  if (!parsed.success) return fail("E-Mail oder Passwort ist falsch.");

  const found = await db
    .select()
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);

  const user = found[0];
  if (!user || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
    return fail("E-Mail oder Passwort ist falsch.");
  }

  if (!user.emailVerifiedAt) {
    redirect(`/verify-email/pending?${new URLSearchParams({ email: user.email })}`);
  }

  await createSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}

/** Löst den Bestätigungslink ein – aufgerufen aus einem expliziten Klick auf
 * der /verify-email-Seite, nicht direkt beim GET (E-Mail-Clients/Scanner
 * rufen Links aus Mails teils automatisch vorab auf und würden den
 * Einmal-Token sonst verbrennen, bevor der Nutzer selbst klickt). */
export async function confirmEmailAction(token: string): Promise<void> {
  const userId = await consumeEmailVerificationToken(token);
  if (!userId) {
    redirect("/verify-email?error=invalid");
  }

  await db
    .update(users)
    .set({ emailVerifiedAt: Math.floor(Date.now() / 1000) })
    .where(eq(users.id, userId));

  await createSession(userId);
  redirect("/");
}

/**
 * Immer dieselbe Antwort, unabhängig davon ob die Adresse existiert, schon
 * verifiziert ist oder der Versand gerade gedrosselt wird – sonst ließe sich
 * über die Reaktion erraten, welche E-Mails registriert sind.
 */
export async function resendVerificationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailOnly.safeParse({ email: text(formData, "email") });

  if (parsed.success) {
    const found = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    const user = found[0];

    if (user && !user.emailVerifiedAt && !(await hasRecentEmailVerificationToken(user.id))) {
      await sendVerificationLink(user.id, user.email, user.name);
    }
  }

  return { ok: true };
}

export async function requestPasswordResetAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = emailOnly.safeParse({ email: text(formData, "email") });

  if (parsed.success) {
    const found = await db
      .select()
      .from(users)
      .where(eq(users.email, parsed.data.email))
      .limit(1);
    const user = found[0];

    if (user && !(await hasRecentPasswordResetToken(user.id))) {
      const token = await createPasswordResetToken(user.id);
      try {
        await sendPasswordResetEmail(
          user.email,
          user.name,
          appUrl(`/reset-password?token=${token}`),
        );
      } catch (error) {
        console.error("Passwort-Reset-Mail konnte nicht verschickt werden:", error);
      }
    }
  }

  // Gleiche Antwort, ob die Adresse existiert oder nicht.
  return { ok: true };
}

const newPassword = z.object({
  password: z.string().min(8, "Das Passwort braucht mindestens 8 Zeichen."),
});

export async function resetPasswordAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const parsed = newPassword.safeParse({ password: text(formData, "password") });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Ungültiges Passwort.");
  }

  const userId = await consumePasswordResetToken(token);
  if (!userId) {
    return fail("Der Link ist ungültig oder abgelaufen. Fordere einen neuen an.");
  }

  const found = await db
    .select({ emailVerifiedAt: users.emailVerifiedAt })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  await db
    .update(users)
    .set({
      passwordHash: await hashPassword(parsed.data.password),
      // Ein eingelöster Reset-Link beweist Zugriff auf die Adresse – falls
      // das Konto noch unbestätigt war, ist das gleich mit erledigt.
      emailVerifiedAt: found[0]?.emailVerifiedAt ?? Math.floor(Date.now() / 1000),
    })
    .where(eq(users.id, userId));

  // Alle bestehenden Sessions killen (falls das Passwort geleakt war, könnte
  // sonst eine gestohlene Session weiterlaufen), danach frisch einloggen.
  await db.delete(sessions).where(eq(sessions.userId, userId));
  await createSession(userId);
  redirect("/");
}
