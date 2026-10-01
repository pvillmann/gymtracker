"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { SetEffort } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { parseDurationInput } from "@/lib/format";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { getActiveWorkout, getPlan, listGyms } from "@/lib/queries";
import { isServiceError } from "@/lib/services/errors";
import { findOrCreateGym, setPlanGym } from "@/lib/services/gyms";
import { getOrCreateVariant, requireMovement } from "@/lib/services/machines";
import {
  chooseVariant,
  deleteSet,
  discardWorkout,
  finishWorkout,
  getOwnedSet,
  logSet,
  rateSet,
  requireOwnWorkout,
  setWorkoutNotes,
  setWorkoutTimes,
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

/**
 * Startet ein Training. Ohne Studio-Angabe im Formular wird gefragt – außer
 * der Plan hat "Nicht erneut fragen" gesetzt, oder es ist ein freies Training
 * und noch kein Studio angelegt (dann gäbe es nichts zu wählen).
 */
export async function startWorkoutAction(
  planId: string | null,
  formData?: FormData,
): Promise<void> {
  const user = await requireUser();

  // Läuft schon eines, geht es dorthin zurück – ohne Rückfrage.
  const active = await getActiveWorkout(user.id);
  if (active) redirect(`/workout/${active.id}`);

  const startPage = `/workout/start${planId ? `?plan=${encodeURIComponent(planId)}` : ""}`;
  const choice = formData?.get("gym");
  let gymId: string | null = null;

  if (typeof choice === "string" && choice !== "") {
    if (choice === "new") {
      const name = String(formData?.get("newGym") ?? "").trim();
      if (!name || name.length > 60) {
        redirect(`${startPage}${planId ? "&" : "?"}fehler=name`);
      }
      gymId = await findOrCreateGym(user, name);
    } else if (choice !== "none") {
      gymId = choice;
    }
    if (planId && formData?.get("remember") === "on") {
      await setPlanGym(user, planId, true, gymId);
    }
  } else if (planId) {
    const plan = await getPlan(user.id, planId);
    if (!plan) redirect("/plans");
    if (!plan.rememberGym) redirect(startPage);
    gymId = plan.defaultGymId;
  } else if ((await listGyms()).length > 0) {
    redirect(startPage);
  }

  const started = await startWorkout(user, planId, gymId);

  revalidatePath("/");
  redirect(`/workout/${started.workoutId}`);
}

/** "Nicht erneut fragen" am Plan setzen oder wieder entfernen. */
export async function setPlanGymAction(planId: string, formData: FormData): Promise<void> {
  const user = await requireUser();
  const remember = formData.get("remember") === "on";
  const gym = String(formData.get("gym") ?? "");
  await setPlanGym(user, planId, remember, gym && gym !== "none" ? gym : null);
  revalidatePath(`/plans/${planId}`);
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

/**
 * Maschine für eine Übung im Training wählen. Die Variante (Übung ×
 * Maschine) mit eigenem Verlauf entsteht dabei von selbst, falls neu.
 */
export async function chooseMachineAction(
  workoutId: string,
  movementId: string,
  machineKey: string,
): Promise<void> {
  const user = await requireUser();
  const exerciseId = await getOrCreateVariant(
    user,
    movementId,
    machineKey === "none" ? null : machineKey,
  );
  await chooseVariant(user, workoutId, exerciseId);
  revalidatePath(`/workout/${workoutId}`);
}

export async function rateSetAction(
  setId: string,
  effort: SetEffort | null,
): Promise<void> {
  const user = await requireUser();
  const parsed = z.enum(["max", "ok", "easy"]).nullable().safeParse(effort);
  if (!parsed.success) return;

  const { workoutId } = await rateSet(user, setId, parsed.data);
  revalidatePath(`/workout/${workoutId}`);
  revalidatePath(`/history/${workoutId}`);
}

export async function deleteSetAction(setId: string): Promise<void> {
  const user = await requireUser();
  const { workoutId } = await deleteSet(user, setId);

  revalidatePath(`/workout/${workoutId}`);
  revalidatePath(`/history/${workoutId}`);
}

export async function finishWorkoutAction(
  workoutId: string,
  endAt?: number,
): Promise<void> {
  const user = await requireUser();
  const { discarded } = await finishWorkout(user, workoutId, endAt);

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

  // Ergänzt wird eine Übung; die Maschine wählt das Training nach Studio.
  const movementId = text(formData, "exerciseId");
  if (!movementId) return fail("Bitte eine Übung auswählen.");
  try {
    await requireMovement(movementId);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }

  const extras = new Set(formData.getAll("extra").map(String).filter(Boolean));
  extras.add(movementId);

  const query = [...extras].map((id) => `extra=${encodeURIComponent(id)}`).join("&");
  redirect(`/workout/${workoutId}?${query}`);
}

/**
 * Ein "datetime-local"-Feld liefert "2026-09-08T20:12" in Ortszeit. Genau so
 * soll es auch gelesen werden – der Server läuft über TZ in derselben Zone.
 */
function readLocalDateTime(value: string): number | null {
  if (!value) return null;
  const parsed = new Date(value);
  const seconds = Math.floor(parsed.getTime() / 1000);
  return Number.isFinite(seconds) ? seconds : null;
}

export async function updateWorkoutTimesAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const startedAt = readLocalDateTime(text(formData, "startedAt"));
  if (startedAt === null) return fail("Bitte einen gültigen Beginn angeben.");

  const rawEnd = optionalText(formData, "finishedAt");
  const finishedAt = rawEnd ? readLocalDateTime(rawEnd) : undefined;
  if (rawEnd && finishedAt === null) return fail("Bitte ein gültiges Ende angeben.");

  const result = await guarded(async () => {
    await setWorkoutTimes(user, workoutId, { startedAt, finishedAt: finishedAt ?? undefined });
  });

  if (result.ok) {
    revalidatePath(`/history/${workoutId}`);
    revalidatePath("/history");
    revalidatePath("/stats");
  }
  return result;
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
