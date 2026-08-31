"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import {
  createSession,
  destroySession,
  hashPassword,
  requireUser,
  verifyPassword,
} from "@/lib/auth";
import { text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";

const profileInput = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(60),
  bodyweightKg: z.preprocess(
    (value) =>
      typeof value === "string" ? Number(value.trim().replace(",", ".")) : value,
    z
      .number()
      .min(20, "Das Körpergewicht wirkt zu niedrig.")
      .max(400, "Das Körpergewicht wirkt zu hoch."),
  ),
});

export async function updateProfileAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = profileInput.safeParse({
    name: text(formData, "name"),
    bodyweightKg: text(formData, "bodyweightKg"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  await db.update(users).set(parsed.data).where(eq(users.id, user.id));

  revalidatePath("/settings");
  revalidatePath("/stats");
  return { ok: true };
}

/**
 * Ändert das Passwort und meldet dabei alle anderen Geräte ab. Für dieses
 * Gerät wird direkt eine frische Session gesetzt, damit man nicht mitten im
 * Training aus der App fliegt.
 */
export async function changePasswordAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const current = text(formData, "currentPassword");
  const next = text(formData, "newPassword");

  if (!(await verifyPassword(current, user.passwordHash))) {
    return fail("Das aktuelle Passwort stimmt nicht.");
  }
  if (next.length < 8) {
    return fail("Das neue Passwort braucht mindestens 8 Zeichen.");
  }
  if (next === current) {
    return fail("Das neue Passwort ist dasselbe wie das alte.");
  }

  await db
    .update(users)
    .set({ passwordHash: await hashPassword(next) })
    .where(eq(users.id, user.id));

  await db.delete(sessions).where(eq(sessions.userId, user.id));
  await createSession(user.id);

  return { ok: true };
}

/**
 * Löscht das Konto restlos. exercises/plans/workouts/sessions/Tokens hängen
 * alle per ON DELETE CASCADE an users.id – ein einziges DELETE reicht, um
 * wirklich alles zu entfernen (Pläne, Übungen, Trainings, Sätze).
 */
export async function deleteAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const password = text(formData, "password");
  if (!(await verifyPassword(password, user.passwordHash))) {
    return fail("Das Passwort stimmt nicht.");
  }

  await db.delete(users).where(eq(users.id, user.id));
  await destroySession();

  redirect("/login?deleted=1");
}
