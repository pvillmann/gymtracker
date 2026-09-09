import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { exercises, workoutSets, type TrackingMode, type User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";

export type ExerciseInput = {
  name: string;
  muscleGroup?: string | null;
  machineSetup?: string | null;
  trackingMode: TrackingMode;
  weightStepKg: number;
};

/** SQLite meldet den Verstoß gegen den (user, name)-Index als UNIQUE-Fehler. */
function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

export async function createExercise(
  user: User,
  input: ExerciseInput,
): Promise<string> {
  const id = newId();
  try {
    await db.insert(exercises).values({
      id,
      userId: user.id,
      name: input.name,
      muscleGroup: input.muscleGroup ?? null,
      machineSetup: input.machineSetup ?? null,
      trackingMode: input.trackingMode,
      weightStepKg: input.weightStepKg,
    });
  } catch (error) {
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
  try {
    await db
      .update(exercises)
      .set({
        name: input.name,
        muscleGroup: input.muscleGroup ?? null,
        machineSetup: input.machineSetup ?? null,
        trackingMode: input.trackingMode,
        weightStepKg: input.weightStepKg,
      })
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));
  } catch (error) {
    if (isDuplicateName(error)) {
      throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
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
