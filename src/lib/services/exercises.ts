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
import { recomputeVolumes, requireOwnEquipment } from "@/lib/services/equipment";
import { ServiceError } from "@/lib/services/errors";

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
  userId: string,
  name: string,
  muscleGroup: string | null | undefined,
): Promise<{ id: string; muscleGroup: string | null }> {
  const [existing] = await db
    .select({ id: movements.id, muscleGroup: movements.muscleGroup })
    .from(movements)
    .where(and(eq(movements.userId, userId), eq(movements.name, name)))
    .limit(1);

  if (!existing) {
    const id = newId();
    await db
      .insert(movements)
      .values({ id, userId, name, muscleGroup: muscleGroup ?? null });
    return { id, muscleGroup: muscleGroup ?? null };
  }

  if (muscleGroup !== undefined && muscleGroup !== existing.muscleGroup) {
    await setMovementMuscleGroup(existing.id, muscleGroup);
    return { id: existing.id, muscleGroup };
  }
  return existing;
}

/** Die Muskelgruppe gehört der Bewegung; die Varianten tragen eine Kopie. */
async function setMovementMuscleGroup(
  movementId: string,
  muscleGroup: string | null,
): Promise<void> {
  await db.update(movements).set({ muscleGroup }).where(eq(movements.id, movementId));
  await db.update(exercises).set({ muscleGroup }).where(eq(exercises.movementId, movementId));
}

/** Bewegungen ohne ein einziges Gerät haben keinen Zweck mehr. */
async function deleteEmptyMovements(userId: string): Promise<void> {
  await db
    .delete(movements)
    .where(
      and(
        eq(movements.userId, userId),
        notExists(
          db
            .select({ id: exercises.id })
            .from(exercises)
            .where(eq(exercises.movementId, movements.id)),
        ),
      ),
    );
}

export async function createExercise(
  user: User,
  input: ExerciseInput,
): Promise<string> {
  const id = newId();
  if (input.equipmentId) await requireOwnEquipment(user.id, input.equipmentId);
  const movement = await resolveMovement(
    user.id,
    input.movementName?.trim() || input.name,
    // Leer heißt beim Anlegen "keine Angabe", nicht "löschen".
    input.muscleGroup ?? undefined,
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
      trackingMode: input.trackingMode,
      weightStepKg: input.weightStepKg,
    });
  } catch (error) {
    await deleteEmptyMovements(user.id);
    if (isDuplicateName(error)) {
      throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
  }
  return id;
}

export async function updateExercise(
  user: User,
  exerciseId: string,
  input: ExerciseInput,
): Promise<void> {
  const [current] = await db
    .select({ movementId: exercises.movementId, equipmentId: exercises.equipmentId })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)))
    .limit(1);
  if (!current) throw new ServiceError("Diese Übung gibt es nicht.");
  if (input.equipmentId) await requireOwnEquipment(user.id, input.equipmentId);

  // Beim Bearbeiten steht die Muskelgruppe im Formular – auch ein leeres Feld
  // ist dann eine Angabe.
  const movement = await resolveMovement(
    user.id,
    input.movementName?.trim() || input.name,
    input.muscleGroup ?? null,
  );

  try {
    await db
      .update(exercises)
      .set({
        name: input.name,
        movementId: movement.id,
        muscleGroup: movement.muscleGroup,
        ...(input.equipmentId !== undefined ? { equipmentId: input.equipmentId } : {}),
        machineSetup: input.machineSetup ?? null,
        trackingMode: input.trackingMode,
        weightStepKg: input.weightStepKg,
      })
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));
  } catch (error) {
    await deleteEmptyMovements(user.id);
    if (isDuplicateName(error)) {
      throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
  }

  // Wer eine Übung einer anderen Bewegung zuordnet, lässt die alte leer zurück.
  if (current.movementId !== movement.id) await deleteEmptyMovements(user.id);
  // Anderes Gerät heißt andere Übersetzung: das bewegte Gewicht neu rechnen.
  if (input.equipmentId !== undefined && input.equipmentId !== current.equipmentId) {
    await recomputeVolumes(user.id, { exerciseIds: [exerciseId] });
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
  await deleteEmptyMovements(user.id);
  return { archivedInstead: false };
}
