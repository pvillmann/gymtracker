import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { equipment, gyms, movements, users, type User } from "@/db/schema";
import { getAdminUserIds, isAdmin } from "@/lib/groups";
import { ServiceError } from "@/lib/services/errors";

/**
 * Übungen, Maschinen und Studios gehören der ganzen Instanz: jeder darf sie
 * benutzen, anlegen, bearbeiten und zuordnen – wer einen Fehler sieht,
 * korrigiert ihn. Nur löschen darf, wer den Eintrag angelegt hat, oder ein
 * Administrator: Ein Löschen nimmt allen Fotos, Zuordnungen und
 * Einstellungen weg und lässt sich nicht mehr korrigieren.
 */
export async function canDeleteCatalog(user: User, ownerId: string): Promise<boolean> {
  return ownerId === user.id || (await isAdmin(user.id));
}

export async function assertCanDeleteCatalog(
  user: User,
  ownerId: string,
  what: string,
): Promise<void> {
  if (!(await canDeleteCatalog(user, ownerId))) {
    throw new ServiceError(
      `${what} gehört zum gemeinsamen Katalog. Löschen kann es nur, wer es angelegt hat, oder ein Administrator.`,
    );
  }
}

/**
 * Vor dem Löschen eines Kontos: seine Katalogeinträge an jemand anderen
 * übergeben – bevorzugt einen Administrator. Sonst nähme die Kaskade am
 * Fremdschlüssel allen anderen Nutzern die Bewegungen, Geräte und Studios
 * weg. Gibt es niemanden sonst, benutzt sie auch keiner mehr.
 */
export async function handOverCatalog(userId: string): Promise<void> {
  const admins = [...(await getAdminUserIds())].filter((id) => id !== userId);
  let successor = admins[0];
  if (!successor) {
    const [other] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(ne(users.id, userId), eq(users.isSetupAccount, false)))
      .orderBy(asc(users.createdAt))
      .limit(1);
    successor = other?.id;
  }
  if (!successor) return;

  for (const table of [movements, equipment, gyms]) {
    await db.update(table).set({ userId: successor }).where(eq(table.userId, userId));
  }
}

