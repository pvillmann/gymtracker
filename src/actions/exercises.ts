"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { DEFAULT_EXERCISES } from "@/lib/constants";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { setGymExerciseSettings } from "@/lib/services/gyms";
import {
  deleteExercise,
  seedDefaultExercises,
  setExerciseArchived,
  updateVariant,
} from "@/lib/services/exercises";

/**
 * Die eigene Variante (Übung × Maschine): nur Name und die eigene Einstellung
 * an der Maschine. Messart, Muskelgruppe und Gerät gehören zur Übung bzw. zum
 * Katalog und werden dort geändert – sonst wiche die Variante von ihrer Übung ab.
 */
export async function updateVariantAction(
  exerciseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const name = text(formData, "name").trim();
  const setup = (optionalText(formData, "machineSetup") ?? "").trim();
  if (!name) return fail("Die Variante braucht einen Namen.");
  if (name.length > 80) return fail("Der Name ist zu lang.");
  if (setup.length > 500) return fail("Die Einstellung ist zu lang.");

  try {
    await updateVariant(user, exerciseId, { name, machineSetup: setup || null });
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }

  revalidatePath("/exercises");
  revalidatePath(`/exercises/${exerciseId}`);
  return { ok: true };
}

/** Einstellungen eines Geräts in einem Studio. */
export async function setGymExerciseSettingsAction(
  gymId: string,
  exerciseId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const setup = optionalText(formData, "machineSetup")?.trim() ?? "";
  if (setup.length > 500) return fail("Die Einstellung ist zu lang.");

  try {
    await setGymExerciseSettings(user, gymId, exerciseId, {
      machineSetup: setup || null,
      weightStepKg: null,
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
