import "server-only";

import { and, eq, notExists, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  exercises,
  movements,
  workoutSets,
  type TrackingMode,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { requireEquipment } from "@/lib/services/equipment";
import { nameKey } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/services/errors";
import { linkMovementEquipment } from "@/lib/services/machines";
import { getWgerExercise } from "@/lib/wger";

export type ExerciseInput = {
  name: string;
  /**
   * Name der Bewegung, deren Variante die Übung ist. Gibt es sie noch nicht,
   * wird sie angelegt. Fehlt er, ist die Übung ihre eigene Bewegung.
   */
  movementName?: string | null;
  /** Gilt für die ganze Bewegung, also für alle ihre Geräte. */
  muscleGroup?: string | null;
  /** Gerätetyp; undefined lässt ihn beim Bearbeiten unverändert. */
  equipmentId?: string | null;
  /**
   * wger-Eintrag, aus dem eine neu angelegte Bewegung stammt. Lizenz und
   * Urheber holt der Server selbst bei wger – nie aus dem Formular.
   */
  wgerId?: number | null;
  machineSetup?: string | null;
  trackingMode: TrackingMode;
  weightStepKg: number;
};

/** SQLite meldet den Verstoß gegen den (user, name)-Index als UNIQUE-Fehler. */
function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/**
 * Findet die Bewegung per Name oder legt sie an. `muscleGroup` undefined
 * lässt die Muskelgruppe einer bestehenden Bewegung stehen – beim Anlegen
 * einer weiteren Variante soll ein leeres Feld sie nicht löschen.
 */
async function resolveMovement(
  user: User,
  name: string,
  muscleGroup: string | null | undefined,
  trackingMode: TrackingMode,
  wgerId?: number | null,
): Promise<{ id: string; muscleGroup: string | null; trackingMode: TrackingMode; created: boolean }> {
  const userId = user.id;
  // Ohne Rücksicht auf Groß-/Kleinschreibung: „rudern schmal“ meint die
  // vorhandene Übung, statt eine Dublette anzulegen.
  const existing = (
    await db
      .select({
        id: movements.id,
        name: movements.name,
        muscleGroup: movements.muscleGroup,
        trackingMode: movements.trackingMode,
        ownerId: movements.userId,
      })
      .from(movements)
  ).find((m) => nameKey(m.name) === nameKey(name));

  if (!existing) {
    const id = newId();
    // Aus wger übernommen: Quelle und Lizenz gehören zur Bewegung. Der
    // gewählte Name darf abweichen – dann zeigt die App "bearbeitet".
    const source = wgerId ? await getWgerExercise(wgerId) : null;
    const group = muscleGroup ?? source?.muscleGroup ?? null;
    await db.insert(movements).values({
      id,
      userId,
      name,
      muscleGroup: group,
      trackingMode,
      ...(source
        ? {
            sourceName: source.name,
            sourceUrl: source.sourceUrl,
            licenseName: source.licenseName,
            licenseUrl: source.licenseUrl,
            licenseAuthor: source.licenseAuthor,
          }
        : {}),
    });
    return { id, muscleGroup: group, trackingMode, created: true };
  }

  if (muscleGroup !== undefined && muscleGroup !== existing.muscleGroup) {
    // Die Übung gehört allen; die Muskelgruppe ändert sich bei allen mit.
    await setMovementMuscleGroup(existing.id, muscleGroup);
    return { id: existing.id, muscleGroup, trackingMode: existing.trackingMode, created: false };
  }
  return {
    id: existing.id,
    muscleGroup: existing.muscleGroup,
    trackingMode: existing.trackingMode,
    created: false,
  };
}

/** Die Muskelgruppe gehört der Bewegung; die Varianten tragen eine Kopie. */
async function setMovementMuscleGroup(
  movementId: string,
  muscleGroup: string | null,
): Promise<void> {
  await db.update(movements).set({ muscleGroup }).where(eq(movements.id, movementId));
  await db.update(exercises).set({ muscleGroup }).where(eq(exercises.movementId, movementId));
}

/**
 * Räumt eine Übung weg, die gerade eben für einen gescheiterten Versuch
 * angelegt wurde. Sonst verschwinden Übungen nie von selbst: sie sind
 * gemeinsamer Katalog und können ohne Variante, aber mit Maschinen oder
 * in Plänen stehen.
 */
async function deleteJustCreatedMovement(movementId: string): Promise<void> {
  await db
    .delete(movements)
    .where(
      and(
        eq(movements.id, movementId),
        notExists(
          db.select({ id: exercises.id }).from(exercises).where(eq(exercises.movementId, movementId)),
        ),
      ),
    );
}

export async function createExercise(
  user: User,
  input: ExerciseInput,
): Promise<string> {
  const id = newId();
  if (input.equipmentId) await requireEquipment(input.equipmentId);
  const movement = await resolveMovement(
    user,
    input.movementName?.trim() || input.name,
    // Leer heißt beim Anlegen "keine Angabe", nicht "löschen".
    input.muscleGroup ?? undefined,
    input.trackingMode,
    input.wgerId,
  );
  try {
    await db.insert(exercises).values({
      id,
      userId: user.id,
      name: input.name,
      movementId: movement.id,
      muscleGroup: movement.muscleGroup,
      equipmentId: input.equipmentId ?? null,
      machineSetup: input.machineSetup ?? null,
      // Die Messart gehört der Übung.
      trackingMode: movement.trackingMode,
      weightStepKg: input.weightStepKg,
    });
  } catch (error) {
    if (movement.created) await deleteJustCreatedMovement(movement.id);
    if (isDuplicateName(error)) {
      throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
  }
  if (input.equipmentId) await linkMovementEquipment(user, movement.id, input.equipmentId);
  return id;
}

/** Name und eigene Einstellung einer Variante – nur die eigene. */
export async function updateVariant(
  user: User,
  exerciseId: string,
  input: { name: string; machineSetup: string | null },
): Promise<void> {
  try {
    const updated = await db
      .update(exercises)
      .set(input)
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)))
      .returning({ id: exercises.id });
    if (updated.length === 0) throw new ServiceError("Diese Übung gibt es nicht.");
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Eine Variante mit diesem Namen hast du schon.");
    throw error;
  }
}

/** Legt die Standardübungen an; vorhandene Namen werden übersprungen. */
export async function seedDefaultExercises(
  user: User,
  defaults: ReadonlyArray<ExerciseInput>,
): Promise<void> {
  const existing = new Set(
    (
      await db
        .select({ name: exercises.name })
        .from(exercises)
        .where(eq(exercises.userId, user.id))
    ).map((row) => row.name),
  );

  for (const exercise of defaults) {
    if (existing.has(exercise.name)) continue;
    await createExercise(user, exercise);
  }
}

export async function setExerciseArchived(
  user: User,
  exerciseId: string,
  archived: boolean,
): Promise<void> {
  await db
    .update(exercises)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));
}

/**
 * Löscht nur, solange keine Sätze protokolliert sind – sonst würde die
 * Historie mitgelöscht. Übungen mit Historie werden stattdessen archiviert.
 */
export async function deleteExercise(
  user: User,
  exerciseId: string,
): Promise<{ archivedInstead: boolean }> {
  const [logged] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(eq(workoutSets.exerciseId, exerciseId));

  if ((logged?.count ?? 0) > 0) {
    await setExerciseArchived(user, exerciseId, true);
    return { archivedInstead: true };
  }

  await db
    .delete(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));
  return { archivedInstead: false };
}
