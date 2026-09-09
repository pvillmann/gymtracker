"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { parseDurationInput } from "@/lib/format";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import {
  deleteSet,
  discardWorkout,
  finishWorkout,
  getOwnedSet,
  logSet,
  requireOwnExercise,
  requireOwnWorkout,
  setWorkoutNotes,
  startWorkout,
  updateSet,
  type SetValues,
} from "@/lib/services/workouts";

/**
 * Diese Datei ist bewusst dünn: sie übersetzt Formulardaten in Werte, ruft die
 * Fachlogik in lib/services/workouts auf und kümmert sich um Weiterleitungen
 * und Cache-Invalidierung. Die Regeln selbst stehen im Service, damit der
 * MCP-Endpunkt exakt dieselben bekommt.
 */

/** Akzeptiert auch "42,5" – auf deutschen Tastaturen tippt man das Komma. */
const decimal = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? 0 : Number(normalized);
}, z.number());

/** Akzeptiert "mm:ss" (z. B. "10:30") genauso wie reine Sekunden ("45"). */
const duration = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return Math.round(parseDurationInput(value));
}, z.number());

const setValues = z.object({
  weightKg: decimal.pipe(z.number().min(0).max(1000)),
  reps: decimal.pipe(z.number().int().min(0).max(500)),
  durationSeconds: duration.pipe(z.number().int().min(0).max(36_000)).optional(),
  isWarmup: z.coerce.boolean().optional(),
});

function readSetValues(formData: FormData) {
  return setValues.safeParse({
    weightKg: text(formData, "weightKg", "0"),
    reps: text(formData, "reps", "0"),
    durationSeconds: optionalText(formData, "durationSeconds") || undefined,
    isWarmup: formData.get("isWarmup") === "on",
  });
}

/** Macht aus einem Service-Fehler eine Formularmeldung. */
async function guarded(run: () => Promise<void>): Promise<FormState> {
  try {
    await run();
    return { ok: true };
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
}

export async function startWorkoutAction(planId: string | null): Promise<void> {
  const user = await requireUser();
  const started = await startWorkout(user, planId);

  revalidatePath("/");
  redirect(`/workout/${started.workoutId}`);
}

export async function logSetAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readSetValues(formData);
  if (!parsed.success) return fail("Bitte gültige Werte eintragen.");

  const exerciseId = text(formData, "exerciseId");

  const result = await guarded(async () => {
    await logSet(user, workoutId, exerciseId, parsed.data as SetValues);
  });

  if (result.ok) revalidatePath(`/workout/${workoutId}`);
  return result;
}

export async function updateSetAction(
  setId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readSetValues(formData);
  if (!parsed.success) return fail("Bitte gültige Werte eintragen.");

  const existing = await getOwnedSet(user.id, setId);
  const result = await guarded(async () => {
    await updateSet(user, setId, parsed.data as SetValues);
  });

  if (result.ok) {
    revalidatePath(`/workout/${existing.workoutId}`);
    revalidatePath(`/history/${existing.workoutId}`);
  }
  return result;
}

export async function deleteSetAction(setId: string): Promise<void> {
  const user = await requireUser();
  const { workoutId } = await deleteSet(user, setId);

  revalidatePath(`/workout/${workoutId}`);
  revalidatePath(`/history/${workoutId}`);
}

export async function finishWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  const { discarded } = await finishWorkout(user, workoutId);

  revalidatePath("/");
  if (discarded) redirect("/");

  revalidatePath("/history");
  revalidatePath("/stats");
  redirect(`/history/${workoutId}?feier=1`);
}

export async function discardWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  await discardWorkout(user, workoutId);

  revalidatePath("/");
  redirect("/");
}

export async function updateWorkoutNotesAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const result = await guarded(async () => {
    await setWorkoutNotes(user, workoutId, text(formData, "notes"));
  });

  if (result.ok) {
    revalidatePath(`/workout/${workoutId}`);
    revalidatePath(`/history/${workoutId}`);
  }
  return result;
}

/**
 * Nimmt eine Übung spontan ins laufende Training auf, die nicht im Plan steht.
 * Die Auswahl steht in der URL, bis der erste Satz protokolliert ist – danach
 * ergibt sie sich ohnehin aus den gespeicherten Sätzen.
 */
export async function addExerciseToWorkoutAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const workout = await requireOwnWorkout(user.id, workoutId);
  if (workout.finishedAt !== null) return fail("Dieses Training ist bereits beendet.");

  const exerciseId = text(formData, "exerciseId");
  if (!exerciseId) return fail("Bitte eine Übung auswählen.");
  // Besitz prüfen, bevor die ID in die URL wandert.
  try {
    await requireOwnExercise(user.id, exerciseId);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }

  const extras = new Set(formData.getAll("extra").map(String).filter(Boolean));
  extras.add(exerciseId);

  const query = [...extras].map((id) => `extra=${encodeURIComponent(id)}`).join("&");
  redirect(`/workout/${workoutId}?${query}#uebung-${exerciseId}`);
}

/** Löscht ein abgeschlossenes Training samt seiner Sätze. */
export async function deleteWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  await discardWorkout(user, workoutId);

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/stats");
  redirect("/history");
}
