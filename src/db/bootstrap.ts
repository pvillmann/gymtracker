import { count, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { hashPassword } from "../lib/password";
import { db } from "./connection";
import { groupMembers, groups, users } from "./schema";

const ADMIN_GROUP_SLUG = "administrators";
const ADMIN_GROUP_ID = "grp_administrators";

/** Kennung des Übergangskontos. Das Passwort wird erzeugt, nicht geraten. */
export const SETUP_LOGIN = "admin@admin.de";
const SETUP_USER_ID = "usr_setup";

// Ohne 0/O/1/l/I – das Passwort wird aus dem Log abgetippt, oft am Handy.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function generatePassword(): string {
  const chars: string[] = [];
  // Verwerfen statt Modulo-Rest: sonst wären die ersten Zeichen des Alphabets
  // etwas wahrscheinlicher als die letzten.
  const limit = 256 - (256 % ALPHABET.length);
  while (chars.length < 15) {
    for (const byte of randomBytes(32)) {
      if (byte >= limit) continue;
      chars.push(ALPHABET[byte % ALPHABET.length]);
      if (chars.length === 15) break;
    }
  }
  return [chars.slice(0, 5), chars.slice(5, 10), chars.slice(10, 15)]
    .map((group) => group.join(""))
    .join("-");
}

function announceSetupMode(password: string): void {
  console.warn(
    [
      "",
      "=".repeat(68),
      "  GymTracker ist noch nicht eingerichtet.",
      "",
      "  Melde dich an und lege den ersten Administrator fest:",
      "",
      `      E-Mail:   ${SETUP_LOGIN}`,
      `      Passwort: ${password}`,
      "",
      "  Das Passwort wird bei jedem Start neu erzeugt und gilt nur bis zum",
      "  nächsten. Danach steht hier wieder ein frisches.",
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

  // Das Passwort wird bei jedem Start neu vergeben. So steht im Log immer ein
  // gültiges, auch wenn die alte Ausgabe längst weggescrollt ist – und ein
  // Passwort, das jemand mal mitgelesen hat, überlebt keinen Neustart.
  const password = generatePassword();
  const passwordHash = await hashPassword(password);

  if (existingSetup[0]) {
    await db
      .update(users)
      .set({ passwordHash })
      .where(eq(users.id, existingSetup[0].id));
  } else {
    await db.insert(users).values({
      id: SETUP_USER_ID,
      email: SETUP_LOGIN,
      name: "Einrichtung",
      passwordHash,
      // Ohne dies liefe der Login in die E-Mail-Bestätigung – an diese Adresse
      // wird bewusst nie etwas verschickt.
      emailVerifiedAt: Math.floor(Date.now() / 1000),
      isSetupAccount: true,
    });
  }

  announceSetupMode(password);
}
