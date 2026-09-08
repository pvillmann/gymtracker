import { count, eq } from "drizzle-orm";

import { hashPassword } from "../lib/password";
import { db } from "./connection";
import { groupMembers, groups, users } from "./schema";

const ADMIN_GROUP_SLUG = "administrators";
const ADMIN_GROUP_ID = "grp_administrators";

/** Zugangsdaten des Übergangskontos. Bewusst trivial – es kann nichts außer
 *  die Einrichtung abschließen und verschwindet danach. */
export const SETUP_LOGIN = "admin";
const SETUP_PASSWORD = "admin";
const SETUP_USER_ID = "usr_setup";

function announceSetupMode(): void {
  console.warn(
    [
      "",
      "=".repeat(68),
      "  GymTracker ist noch nicht eingerichtet.",
      "",
      `  Melde dich mit  ${SETUP_LOGIN} / ${SETUP_PASSWORD}  an und lege den ersten`,
      "  Administrator fest. Bis dahin kann das jeder tun, der die Adresse",
      "  kennt – auf einer öffentlich erreichbaren Instanz also bitte sofort.",
      "=".repeat(68),
      "",
    ].join("\n"),
  );
}

/**
 * Bringt die Anwendung beim Start in einen benutzbaren Zustand.
 *
 * Gibt es keinen Administrator, legt sie ein Übergangskonto an, mit dem sich
 * genau eine Sache erledigen lässt: den ersten Administrator festlegen. Sobald
 * es einen gibt, verschwindet das Konto wieder.
 *
 * Läuft bei jedem Start und ist idempotent – das ist zugleich der Notausgang:
 * wer alle Administratoren entfernt, bekommt nach einem Neustart wieder ein
 * Übergangskonto, statt sich dauerhaft ausgesperrt zu haben.
 */
export async function ensureAdminBootstrap(): Promise<void> {
  const existingGroup = await db
    .select({ id: groups.id })
    .from(groups)
    .where(eq(groups.slug, ADMIN_GROUP_SLUG))
    .limit(1);

  const groupId = existingGroup[0]?.id ?? ADMIN_GROUP_ID;
  if (!existingGroup[0]) {
    await db.insert(groups).values({
      id: groupId,
      slug: ADMIN_GROUP_SLUG,
      name: "Administratoren",
      description:
        "Darf die Benutzerverwaltung öffnen und Adminrechte vergeben.",
      isSystem: true,
    });
  }

  const [adminCount] = await db
    .select({ value: count() })
    .from(groupMembers)
    .where(eq(groupMembers.groupId, groupId));

  const existingSetup = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isSetupAccount, true))
    .limit(1);

  if ((adminCount?.value ?? 0) > 0) {
    // Eingerichtet: das Übergangskonto hat seinen Zweck erfüllt.
    if (existingSetup[0]) {
      await db.delete(users).where(eq(users.isSetupAccount, true));
      console.log("[gymtracker] Einrichtung abgeschlossen, Übergangskonto entfernt.");
    }
    return;
  }

  if (!existingSetup[0]) {
    await db.insert(users).values({
      id: SETUP_USER_ID,
      email: SETUP_LOGIN,
      name: "Einrichtung",
      passwordHash: await hashPassword(SETUP_PASSWORD),
      // Ohne dies liefe der Login in die E-Mail-Bestätigung, und "admin" ist
      // keine Adresse, an die sich etwas schicken ließe.
      emailVerifiedAt: Math.floor(Date.now() / 1000),
      isSetupAccount: true,
    });
  }

  announceSetupMode();
}
