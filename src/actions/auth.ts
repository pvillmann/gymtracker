"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import {
  createSession,
  destroySession,
  hashPassword,
  verifyPassword,
} from "@/lib/auth";
import { newId } from "@/lib/ids";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";

const credentials = z.object({
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben."),
  password: z.string().min(8, "Das Passwort braucht mindestens 8 Zeichen."),
});

const registration = credentials.extend({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(60),
  code: z.string().optional(),
});

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

  await createSession(id);
  redirect("/");
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

  await createSession(user.id);
  redirect("/");
}

export async function logoutAction(): Promise<void> {
  await destroySession();
  redirect("/login");
}
