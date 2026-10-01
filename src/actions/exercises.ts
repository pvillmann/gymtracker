"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { DEFAULT_EXERCISES } from "@/lib/constants";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { setGymExerciseSettings } from "@/lib/services/gyms";
import {
  createExercise,
  deleteExercise,
  seedDefaultExercises,
  setExerciseArchived,
  updateExercise,
  type ExerciseInput,
} from "@/lib/services/exercises";

const exerciseInput = z.object({
  name: z.string().trim().min(1, "Die Übung braucht einen Namen.").max(80),
  movementName: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : null)),
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
  // Nicht übermittelt = unverändert lassen; leer gewählt = kein Gerät.
  equipmentId: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === undefined ? undefined : v || null)),
  trackingMode: z.enum(["weight_reps", "bodyweight_reps", "assisted_reps", "time"]),
  weightStepKg: z.coerce
    .number()
    .positive("Die Gewichtsstufe muss größer als 0 sein.")
    .max(50),
});

function readExerciseForm(formData: FormData) {
  return exerciseInput.safeParse({
    name: text(formData, "name"),
    movementName: optionalText(formData, "movementName"),
    equipmentId: optionalText(formData, "equipmentId"),
    muscleGroup: optionalText(formData, "muscleGroup"),
    machineSetup: optionalText(formData, "machineSetup"),
    trackingMode: text(formData, "trackingMode", "weight_reps"),
    weightStepKg: text(formData, "weightStepKg", "2.5"),
  });
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
    await createExercise(user, parsed.data as ExerciseInput);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
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
    await updateExercise(user, exerciseId, parsed.data as ExerciseInput);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }

  revalidatePath("/exercises");
  revalidatePath(`/exercises/${exerciseId}`);
  return { ok: true };
}

/** Einstellungen und Gewichtsstufe eines Geräts in einem Studio. */
export async function setGymExerciseSettingsAction(
  gymId: string,
  exerciseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const setup = optionalText(formData, "machineSetup")?.trim() ?? "";
  const stepRaw = (optionalText(formData, "weightStepKg") ?? "").trim().replace(",", ".");
  const step = stepRaw === "" ? null : Number(stepRaw);
  if (setup.length > 500) return fail("Die Einstellung ist zu lang.");
  if (step !== null && (!Number.isFinite(step) || step <= 0 || step > 50)) {
    return fail("Die Gewichtsstufe muss zwischen 0 und 50 kg liegen.");
  }

  try {
    await setGymExerciseSettings(user, gymId, exerciseId, {
      machineSetup: setup || null,
      weightStepKg: step,
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }

  revalidatePath(`/exercises/${exerciseId}`);
  return { ok: true };
}

export async function setExerciseArchivedAction(
  exerciseId: string,
  archived: boolean,
): Promise<void> {
  const user = await requireUser();
  await setExerciseArchived(user, exerciseId, archived);

  revalidatePath("/exercises");
  revalidatePath(`/exercises/${exerciseId}`);
}

export async function deleteExerciseAction(exerciseId: string): Promise<void> {
  const user = await requireUser();
  const { archivedInstead } = await deleteExercise(user, exerciseId);

  revalidatePath("/exercises");
  if (archivedInstead) {
    revalidatePath(`/exercises/${exerciseId}`);
    return;
  }
  redirect("/exercises");
}

export async function seedDefaultExercisesAction(): Promise<void> {
  const user = await requireUser();

  // Wer die Standardübungen schon hat, soll keinen Fehler sehen.
  await seedDefaultExercises(
    user,
    DEFAULT_EXERCISES.map((exercise) => ({
      name: exercise.name,
      muscleGroup: exercise.muscleGroup,
      trackingMode: exercise.trackingMode ?? "weight_reps",
      weightStepKg: exercise.weightStepKg ?? 2.5,
    })),
  );

  revalidatePath("/exercises");
}
