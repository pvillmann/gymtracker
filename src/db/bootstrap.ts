import { eq } from "drizzle-orm";

import { db } from "./connection";
import { groupMembers, groups, users } from "./schema";

const ADMIN_GROUP_SLUG = "administrators";

function parseAdminEmails(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,;\s]+/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Stellt beim Serverstart die Administratoren-Gruppe her und trägt die in
 * ADMIN_EMAILS genannten Konten ein.
 *
 * Läuft bei jedem Start und ist idempotent. Das ist Absicht: wer sich die
 * Adminrechte versehentlich selbst entzieht, bekommt sie durch einen Neustart
 * zurück, ohne in der Datenbank herumoperieren zu müssen.
 */
export async function ensureAdminGroup(): Promise<void> {
  const existing = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, ADMIN_GROUP_SLUG))
    .limit(1);

  let groupId = existing[0]?.id;

  if (!groupId) {
    groupId = "grp_administrators";
    await db.insert(groups).values({
      id: groupId,
      slug: ADMIN_GROUP_SLUG,
      name: "Administratoren",
      description:
        "Darf die Benutzerverwaltung öffnen und Adminrechte vergeben.",
      isSystem: true,
    });
  }

  const emails = parseAdminEmails(process.env.ADMIN_EMAILS);
  if (emails.length === 0) return;

  for (const email of emails) {
    const found = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    const user = found[0];
    if (!user) {
      // Kein Abbruch: das Konto kann später noch angelegt werden, der nächste
      // Start trägt es dann nach.
      console.warn(
        `[gymtracker] ADMIN_EMAILS nennt ${email}, dazu gibt es aber noch kein Konto.`,
      );
      continue;
    }

    const result = await db
      .insert(groupMembers)
      .values({ groupId, userId: user.id })
      .onConflictDoNothing();

    if (result.changes > 0) {
      console.log(`[gymtracker] ${email} ist jetzt Administrator.`);
    }
  }
}
