import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { gymExercises, gyms, plans, type User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { assertCanDeleteCatalog, assertNameFree, nameKey } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/services/errors";
import { requireOwnExercise } from "@/lib/services/workouts";

function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/** Studios gehören der ganzen Instanz – jeder darf jedes benutzen. */
export async function requireGym(gymId: string) {
  const [gym] = await db.select().from(gyms).where(eq(gyms.id, gymId)).limit(1);
  if (!gym) throw new ServiceError("Dieses Studio gibt es nicht.");
  return gym;
}

/**
 * Findet ein Studio per Name oder legt es an. Beim Trainingsstart soll ein
 * versehentlich doppelt eingetippter Name nicht an einer Fehlermeldung
 * scheitern, sondern einfach das vorhandene Studio nehmen.
 */
export async function findOrCreateGym(user: User, rawName: string): Promise<string> {
  const name = rawName.trim();
  if (!name) throw new ServiceError("Das Studio braucht einen Namen.");
  if (name.length > 60) throw new ServiceError("Der Name ist zu lang.");

  // „fitx innenstadt“ meint das vorhandene „FitX Innenstadt“.
  const existing = (await db.select({ id: gyms.id, name: gyms.name }).from(gyms)).find(
    (g) => nameKey(g.name) === nameKey(name),
  );
  if (existing) return existing.id;

  const id = newId();
  await db.insert(gyms).values({ id, userId: user.id, name });
  return id;
}

export async function renameGym(user: User, gymId: string, rawName: string): Promise<void> {
  const name = rawName.trim();
  if (!name) throw new ServiceError("Das Studio braucht einen Namen.");
  const gym = await requireGym(gymId);
  if (nameKey(name) !== nameKey(gym.name)) {
    assertNameFree(await db.select({ id: gyms.id, name: gyms.name }).from(gyms), name, "Ein Studio", gymId);
  }
  try {
    await db.update(gyms).set({ name }).where(eq(gyms.id, gymId));
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new ServiceError("Ein Studio mit diesem Namen gibt es schon.");
    }
    throw error;
  }
}

/**
 * Trainings und Pläne behalten ihre Daten, verlieren nur den Bezug zum
 * Studio; die Einstellungen der Geräte dort verschwinden mit – bei allen
 * Nutzern. Umbenennen darf jeder, löschen nur, wer es angelegt hat, oder
 * ein Admin.
 */
export async function deleteGym(user: User, gymId: string): Promise<void> {
  const gym = await requireGym(gymId);
  await assertCanDeleteCatalog(user, gym.userId, `Das Studio „${gym.name}“`);
  await db.delete(gyms).where(eq(gyms.id, gymId));
}

/**
 * "Nicht erneut fragen" am Plan. Ohne Merken wird beim nächsten Start wieder
 * gefragt; mit Merken gilt gymId – auch null, dann ohne Studio.
 */
export async function setPlanGym(
  user: User,
  planId: string,
  remember: boolean,
  gymId: string | null,
): Promise<void> {
  if (gymId) await requireGym(gymId);
  await db
    .update(plans)
    .set({ rememberGym: remember, defaultGymId: remember ? gymId : null })
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));
}

/** Das Gerät steht in diesem Studio – entsteht mit dem ersten Satz dort. */
export async function markExerciseInGym(gymId: string, exerciseId: string): Promise<void> {
  await db.insert(gymExercises).values({ gymId, exerciseId }).onConflictDoNothing();
}

/** Einstellungen eines Geräts in einem Studio. Leer = Wert der Übung. */
export async function setGymExerciseSettings(
  user: User,
  gymId: string,
  exerciseId: string,
  values: { machineSetup: string | null; weightStepKg: number | null },
): Promise<void> {
  await requireGym(gymId);
  // Die Übung (und damit ihre Einstellungen im Studio) bleibt privat.
  await requireOwnExercise(user.id, exerciseId);
  await db
    .insert(gymExercises)
    .values({ gymId, exerciseId, ...values })
    .onConflictDoUpdate({
      target: [gymExercises.gymId, gymExercises.exerciseId],
      set: values,
    });
}
