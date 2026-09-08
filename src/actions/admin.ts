"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { requireAdmin } from "@/lib/auth";
import {
  addUserToGroup,
  getAdminGroup,
  isAdmin,
  removeUserFromGroup,
} from "@/lib/groups";
import { sendVerificationLink } from "@/lib/verification";

/** Rückmeldungen der Admin-Aktionen, als Banner über der Nutzerliste. */
export type AdminStatus =
  | "admin-granted"
  | "admin-revoked"
  | "verified"
  | "mail-sent"
  | "mail-failed"
  | "locked"
  | "unlocked"
  | "deleted";

function done(status: AdminStatus): never {
  revalidatePath("/admin/users");
  redirect(`/admin/users?status=${status}`);
}

async function loadTarget(userId: string) {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  const target = rows[0];
  if (!target) throw new Error("Dieses Konto gibt es nicht mehr.");
  return target;
}

/**
 * Gemeinsame Schutzregeln für alle eingreifenden Aktionen.
 *
 * Die Oberfläche blendet unerlaubte Schaltflächen zwar aus, aber das ist nur
 * Kosmetik – geprüft wird hier, wo es zählt.
 */
async function guard(
  targetId: string,
  options: { blockSelf?: boolean; blockAdminTarget?: boolean } = {},
) {
  const actor = await requireAdmin();

  if (options.blockSelf && targetId === actor.id) {
    throw new Error(
      "Diese Aktion kannst du nicht auf dein eigenes Konto anwenden.",
    );
  }
  if (options.blockAdminTarget && (await isAdmin(targetId))) {
    throw new Error(
      "Das Konto ist Administrator. Nimm ihm erst die Adminrechte.",
    );
  }

  return actor;
}

/**
 * Adminrechte vergeben oder entziehen.
 *
 * Man kann sich die Rechte nicht selbst entziehen. Das ist zugleich die
 * Garantie, dass immer mindestens ein Administrator übrig bleibt: wer diese
 * Aktion ausführt, ist selbst einer und bleibt es.
 */
export async function setAdminAction(
  userId: string,
  makeAdmin: boolean,
): Promise<void> {
  await guard(userId, { blockSelf: !makeAdmin });
  await loadTarget(userId);

  const group = await getAdminGroup();
  if (!group) throw new Error("Die Administratoren-Gruppe fehlt.");

  if (makeAdmin) {
    await addUserToGroup(group.id, userId);
    done("admin-granted");
  }

  await removeUserFromGroup(group.id, userId);
  done("admin-revoked");
}

/** Setzt die E-Mail-Bestätigung von Hand – der Notausgang, wenn keine Mail ankommt. */
export async function verifyUserEmailAction(userId: string): Promise<void> {
  await guard(userId);
  const target = await loadTarget(userId);
  if (target.emailVerifiedAt !== null) done("verified");

  await db
    .update(users)
    .set({ emailVerifiedAt: Math.floor(Date.now() / 1000) })
    .where(eq(users.id, userId));

  done("verified");
}

export async function resendVerificationForUserAction(
  userId: string,
): Promise<void> {
  await guard(userId);
  const target = await loadTarget(userId);
  if (target.emailVerifiedAt !== null) done("verified");

  const sent = await sendVerificationLink(target.id, target.email, target.name);
  done(sent ? "mail-sent" : "mail-failed");
}

/**
 * Sperrt ein Konto oder hebt die Sperre auf. Die Trainingsdaten bleiben
 * unangetastet – das ist der Unterschied zum Löschen.
 */
export async function setUserDisabledAction(
  userId: string,
  disabled: boolean,
): Promise<void> {
  await guard(userId, { blockSelf: true, blockAdminTarget: disabled });
  await loadTarget(userId);

  await db
    .update(users)
    .set({ disabledAt: disabled ? Math.floor(Date.now() / 1000) : null })
    .where(eq(users.id, userId));

  if (disabled) {
    // Die Sperre greift zwar schon über getCurrentUser, aber die Sitzungen
    // gleich zu entfernen macht sie auch in der Datenbank sichtbar.
    await db.delete(sessions).where(eq(sessions.userId, userId));
  }

  done(disabled ? "locked" : "unlocked");
}

/**
 * Löscht ein Konto samt aller Trainingsdaten. Die Fremdschlüssel räumen
 * Pläne, Übungen, Trainings und Sätze per Kaskade mit ab.
 */
export async function deleteUserAction(userId: string): Promise<void> {
  await guard(userId, { blockSelf: true, blockAdminTarget: true });
  await loadTarget(userId);

  await db.delete(users).where(eq(users.id, userId));

  done("deleted");
}
