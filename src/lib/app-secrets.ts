import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { appSecrets } from "@/db/schema";

/**
 * Liest einen von der Instanz erzeugten Schlüssel – oder legt ihn beim
 * ersten Bedarf an. Gleichzeitige Erstanlage ist unkritisch: der zweite
 * Insert scheitert still, gelesen wird danach der gespeicherte Wert.
 */
export async function getOrCreateSecret(key: string, create: () => string): Promise<string> {
  const [found] = await db.select().from(appSecrets).where(eq(appSecrets.key, key)).limit(1);
  if (found) return found.value;
  await db.insert(appSecrets).values({ key, value: create() }).onConflictDoNothing();
  const [stored] = await db.select().from(appSecrets).where(eq(appSecrets.key, key)).limit(1);
  return stored.value;
}
