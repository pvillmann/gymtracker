"use server";

import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { exercises, workoutSets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { DEFAULT_EXERCISES } from "@/lib/constants";
import { optionalText, text } from "@/lib/formdata";
import { newId } from "@/lib/ids";
import { fail, type FormState } from "@/lib/result";

const exerciseInput = z.object({
  name: z.string().trim().min(1, "Die Übung braucht einen Namen.").max(80),
  muscleGroup: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  machineSetup: z
    .string()
    .trim()
    .max(500)
    .optional()
    .transform((v) => (v ? v : null)),
  trackingMode: z.enum(["weight_reps", "bodyweight_reps", "time"]),
  weightStepKg: z.coerce
    .number()
    .positive("Die Gewichtsstufe muss größer als 0 sein.")
    .max(50),
});

function readExerciseForm(formData: FormData) {
  return exerciseInput.safeParse({
    name: text(formData, "name"),
    muscleGroup: optionalText(formData, "muscleGroup"),
    machineSetup: optionalText(formData, "machineSetup"),
    trackingMode: text(formData, "trackingMode", "weight_reps"),
    weightStepKg: text(formData, "weightStepKg", "2.5"),
  });
}

/** SQLite meldet den Verstoß gegen den (user, name)-Index als UNIQUE-Fehler. */
function isDuplicateName(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes("UNIQUE constraint failed")
  );
}

export async function createExerciseAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readExerciseForm(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  try {
    await db.insert(exercises).values({
      id: newId(),
      userId: user.id,
      ...parsed.data,
    });
  } catch (error) {
    if (isDuplicateName(error)) {
      return fail("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
  }

  revalidatePath("/exercises");
  redirect("/exercises");
}

export async function updateExerciseAction(
  exerciseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readExerciseForm(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  try {
    await db
      .update(exercises)
      .set(parsed.data)
      .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));
  } catch (error) {
    if (isDuplicateName(error)) {
      return fail("Eine Übung mit diesem Namen gibt es schon.");
    }
    throw error;
  }

  revalidatePath("/exercises");
  revalidatePath(`/exercises/${exerciseId}`);
  return { ok: true };
}

export async function setExerciseArchivedAction(
  exerciseId: string,
  archived: boolean,
): Promise<void> {
  const user = await requireUser();

  await db
    .update(exercises)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));

  revalidatePath("/exercises");
  revalidatePath(`/exercises/${exerciseId}`);
}

/**
 * Löscht nur, solange keine Sätze protokolliert sind – sonst würde die Historie
 * mitgelöscht. Übungen mit Historie werden stattdessen archiviert.
 */
export async function deleteExerciseAction(exerciseId: string): Promise<void> {
  const user = await requireUser();

  const [logged] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(eq(workoutSets.exerciseId, exerciseId));

  if ((logged?.count ?? 0) > 0) {
    await setExerciseArchivedAction(exerciseId, true);
    return;
  }

  await db
    .delete(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)));

  revalidatePath("/exercises");
  redirect("/exercises");
}

export async function seedDefaultExercisesAction(): Promise<void> {
  const user = await requireUser();

  await db
    .insert(exercises)
    .values(
      DEFAULT_EXERCISES.map((exercise) => ({
        id: newId(),
        userId: user.id,
        name: exercise.name,
        muscleGroup: exercise.muscleGroup,
        trackingMode: exercise.trackingMode ?? ("weight_reps" as const),
        weightStepKg: exercise.weightStepKg ?? 2.5,
      })),
    )
    // Wer die Standardübungen schon hat, soll keinen Fehler sehen.
    .onConflictDoNothing();

  revalidatePath("/exercises");
}
