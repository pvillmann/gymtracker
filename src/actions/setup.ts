"use server";

import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { users } from "@/db/schema";
import { createSession, destroySession, hashPassword, requireUser } from "@/lib/auth";
import { text } from "@/lib/formdata";
import { addUserToGroup, getAdminGroup, isSetupPending } from "@/lib/groups";
import { newId } from "@/lib/ids";
import { fail, type FormState } from "@/lib/result";

const newAdmin = z.object({
  name: z.string().trim().min(1, "Bitte einen Namen angeben.").max(60),
  email: z.string().trim().toLowerCase().email("Bitte eine gültige E-Mail angeben."),
  password: z.string().min(8, "Das Passwort braucht mindestens 8 Zeichen."),
});

/**
 * Beide Setup-Aktionen dürfen nur laufen, solange die Instanz nicht
 * eingerichtet ist und der Aufrufer das Übergangskonto ist. Die zweite
 * Prüfung fängt auch den Fall ab, dass zwischenzeitlich jemand anderes die
 * Einrichtung abgeschlossen hat.
 */
async function requireSetupSession() {
  const user = await requireUser();
  if (!user.isSetupAccount) redirect("/");
  if (!(await isSetupPending())) redirect("/");
  return user;
}

/** Entfernt das Übergangskonto – seine Sitzungen fallen per Kaskade mit weg. */
async function retireSetupAccount(): Promise<void> {
  await db.delete(users).where(eq(users.isSetupAccount, true));
}

async function makeAdmin(userId: string): Promise<void> {
  const group = await getAdminGroup();
  if (!group) throw new Error("Die Administratoren-Gruppe fehlt.");
  await addUserToGroup(group.id, userId);
}

/** Weg 1: frische Installation – Konto anlegen und zum Administrator machen. */
export async function createAdminAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSetupSession();

  const parsed = newAdmin.safeParse({
    name: text(formData, "name"),
    email: text(formData, "email"),
    password: text(formData, "password"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  const taken = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, parsed.data.email))
    .limit(1);
  if (taken.length > 0) {
    return fail("Für diese E-Mail gibt es schon ein Konto – nimm den Weg darüber.");
  }

  const id = newId();
  await db.insert(users).values({
    id,
    email: parsed.data.email,
    name: parsed.data.name,
    passwordHash: await hashPassword(parsed.data.password),
    // Wer die Einrichtung durchführt, hat Zugriff auf die Instanz selbst; eine
    // Bestätigungsmail würde hier nur ein Henne-Ei-Problem schaffen.
    emailVerifiedAt: Math.floor(Date.now() / 1000),
  });

  await makeAdmin(id);
  await retireSetupAccount();
  await createSession(id);

  redirect("/");
}

/** Weg 2: bestehende Instanz – ein vorhandenes Konto wird Administrator. */
export async function promoteExistingAccountAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireSetupSession();

  const userId = text(formData, "userId");
  if (!userId) return fail("Bitte ein Konto auswählen.");

  const found = await db
    .select({ id: users.id, isSetupAccount: users.isSetupAccount })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const target = found[0];
  if (!target || target.isSetupAccount) return fail("Dieses Konto gibt es nicht.");

  await makeAdmin(target.id);
  await retireSetupAccount();
  await destroySession();

  redirect("/login?eingerichtet=1");
}
