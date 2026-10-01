import "server-only";

import { and, asc, eq, ne } from "drizzle-orm";

import { db } from "@/db";
import { equipment, gyms, movements, users, type User } from "@/db/schema";
import { getAdminUserIds, isAdmin } from "@/lib/groups";
import { ServiceError } from "@/lib/services/errors";

/**
 * Bewegungen, Geräte und Studios gehören der ganzen Instanz: jeder darf sie
 * benutzen und neue anlegen. Ändern oder löschen darf sie nur, wer sie
 * angelegt hat, oder ein Administrator – sonst könnte jeder anderen die
 * Muskelgruppe oder die Übersetzung unter den Füßen wegändern.
 */
export async function canEditCatalog(user: User, ownerId: string): Promise<boolean> {
  return ownerId === user.id || (await isAdmin(user.id));
}

export async function assertCanEditCatalog(
  user: User,
  ownerId: string,
  what: string,
): Promise<void> {
  if (!(await canEditCatalog(user, ownerId))) {
    throw new ServiceError(
      `${what} gehört zum gemeinsamen Katalog. Ändern kann es nur, wer es angelegt hat, oder ein Administrator.`,
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

