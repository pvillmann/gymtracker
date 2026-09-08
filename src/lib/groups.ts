import "server-only";

import { and, eq } from "drizzle-orm";
import { cache } from "react";

import { db } from "@/db";
import { groupMembers, groups } from "@/db/schema";

/** Slug der Systemgruppe, an der die Administratorrechte hängen. */
export const ADMIN_GROUP_SLUG = "administrators";

/**
 * Die IDs aller Administratoren. Pro Request nur eine Abfrage – die
 * Benutzerverwaltung braucht die Menge für jede Zeile ihrer Liste.
 */
export const getAdminUserIds = cache(async (): Promise<Set<string>> => {
  const rows = await db
    .select({ userId: groupMembers.userId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(eq(groups.slug, ADMIN_GROUP_SLUG));

  return new Set(rows.map((row) => row.userId));
});

export async function isAdmin(userId: string): Promise<boolean> {
  return (await getAdminUserIds()).has(userId);
}

/** Die Gruppe selbst – das Bootstrapping legt sie beim Start an. */
export async function getAdminGroup() {
  const rows = await db
    .select()
    .from(groups)
    .where(eq(groups.slug, ADMIN_GROUP_SLUG))
    .limit(1);
  return rows[0] ?? null;
}

export async function addUserToGroup(groupId: string, userId: string): Promise<void> {
  await db.insert(groupMembers).values({ groupId, userId }).onConflictDoNothing();
}

export async function removeUserFromGroup(
  groupId: string,
  userId: string,
): Promise<void> {
  await db
    .delete(groupMembers)
    .where(
      and(eq(groupMembers.groupId, groupId), eq(groupMembers.userId, userId)),
    );
}
