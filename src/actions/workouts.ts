"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { exercises, plans, workouts, workoutSets } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { optionalText, text } from "@/lib/formdata";
import { newId } from "@/lib/ids";
import { getActiveWorkout } from "@/lib/queries";
import { fail, type FormState } from "@/lib/result";
import { setVolume } from "@/lib/training";

/** Akzeptiert auch "42,5" – auf deutschen Tastaturen tippt man das Komma. */
const decimal = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().replace(",", ".");
  return normalized === "" ? 0 : Number(normalized);
}, z.number());

const setInput = z.object({
  exerciseId: z.string().min(1),
  weightKg: decimal.pipe(z.number().min(0).max(1000)),
  reps: decimal.pipe(z.number().int().min(0).max(500)),
  durationSeconds: decimal.pipe(z.number().int().min(0).max(36_000)).optional(),
  isWarmup: z.coerce.boolean().optional(),
});

async function assertWorkoutOwner(userId: string, workoutId: string) {
  const rows = await db
    .select({ id: workouts.id, finishedAt: workouts.finishedAt })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);
  const workout = rows[0];
  if (!workout) throw new Error("NOT_FOUND");
  return workout;
}

/** Lädt einen Satz inklusive Besitzprüfung über das zugehörige Training. */
async function getOwnedSet(userId: string, setId: string) {
  const rows = await db
    .select({
      id: workoutSets.id,
      workoutId: workoutSets.workoutId,
      exerciseId: workoutSets.exerciseId,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workoutSets.id, setId), eq(workouts.userId, userId)))
    .limit(1);

  const set = rows[0];
  if (!set) throw new Error("NOT_FOUND");
  return set;
}

/** Schließt Lücken in der Satz-Nummerierung, z. B. nachdem ein Satz gelöscht wurde. */
async function renumberSets(workoutId: string, exerciseId: string): Promise<void> {
  const remaining = await db
    .select({ id: workoutSets.id, setNumber: workoutSets.setNumber })
    .from(workoutSets)
    .where(
      and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.exerciseId, exerciseId)),
    )
    .orderBy(asc(workoutSets.setNumber));

  for (const [index, set] of remaining.entries()) {
    const setNumber = index + 1;
    if (set.setNumber !== setNumber) {
      await db
        .update(workoutSets)
        .set({ setNumber })
        .where(eq(workoutSets.id, set.id));
    }
  }
}

/**
 * Startet ein Training. Läuft bereits eines, wird dorthin weitergeleitet –
 * zwei gleichzeitig offene Trainings würden die Vergleichslogik verwirren.
 */
export async function startWorkoutAction(planId: string | null): Promise<void> {
  const user = await requireUser();

  const running = await getActiveWorkout(user.id);
  if (running) redirect(`/workout/${running.id}`);

  let name = "Freies Training";
  if (planId) {
    const rows = await db
      .select({ name: plans.name })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.userId, user.id)))
      .limit(1);
    if (!rows[0]) throw new Error("NOT_FOUND");
    name = rows[0].name;
  }

  const id = newId();
  await db.insert(workouts).values({ id, userId: user.id, planId, name });

  revalidatePath("/");
  redirect(`/workout/${id}`);
}

export async function logSetAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const workout = await assertWorkoutOwner(user.id, workoutId);
  if (workout.finishedAt !== null) return fail("Dieses Training ist bereits beendet.");

  const parsed = setInput.safeParse({
    exerciseId: text(formData, "exerciseId"),
    weightKg: text(formData, "weightKg", "0"),
    reps: text(formData, "reps", "0"),
    durationSeconds: optionalText(formData, "durationSeconds") || undefined,
    isWarmup: formData.get("isWarmup") === "on",
  });
  if (!parsed.success) return fail("Bitte gültige Werte eintragen.");

  const rows = await db
    .select({
      id: exercises.id,
      trackingMode: exercises.trackingMode,
    })
    .from(exercises)
    .where(
      and(eq(exercises.id, parsed.data.exerciseId), eq(exercises.userId, user.id)),
    )
    .limit(1);

  const exercise = rows[0];
  if (!exercise) return fail("Diese Übung gibt es nicht.");

  if (exercise.trackingMode === "time") {
    if (!parsed.data.durationSeconds) return fail("Bitte eine Dauer eintragen.");
  } else if (parsed.data.reps <= 0) {
    return fail("Bitte die Wiederholungen eintragen.");
  }

  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(
      and(
        eq(workoutSets.workoutId, workoutId),
        eq(workoutSets.exerciseId, exercise.id),
      ),
    );

  await db.insert(workoutSets).values({
    id: newId(),
    workoutId,
    exerciseId: exercise.id,
    setNumber: (existing?.count ?? 0) + 1,
    weightKg: parsed.data.weightKg,
    reps: parsed.data.reps,
    durationSeconds: parsed.data.durationSeconds ?? null,
    isWarmup: parsed.data.isWarmup ?? false,
    volumeKg: setVolume(
      exercise.trackingMode,
      parsed.data.weightKg,
      parsed.data.reps,
      user.bodyweightKg,
    ),
  });

  revalidatePath(`/workout/${workoutId}`);
  return { ok: true };
}

export async function updateSetAction(
  setId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const existing = await getOwnedSet(user.id, setId);

  const parsed = setInput
    .omit({ exerciseId: true })
    .safeParse({
      weightKg: text(formData, "weightKg", "0"),
      reps: text(formData, "reps", "0"),
      durationSeconds: optionalText(formData, "durationSeconds") || undefined,
      isWarmup: formData.get("isWarmup") === "on",
    });
  if (!parsed.success) return fail("Bitte gültige Werte eintragen.");

  const rows = await db
    .select({ trackingMode: exercises.trackingMode })
    .from(exercises)
    .where(eq(exercises.id, existing.exerciseId))
    .limit(1);
  const trackingMode = rows[0]?.trackingMode ?? "weight_reps";

  await db
    .update(workoutSets)
    .set({
      weightKg: parsed.data.weightKg,
      reps: parsed.data.reps,
      durationSeconds: parsed.data.durationSeconds ?? null,
      isWarmup: parsed.data.isWarmup ?? false,
      volumeKg: setVolume(
        trackingMode,
        parsed.data.weightKg,
        parsed.data.reps,
        user.bodyweightKg,
      ),
    })
    .where(eq(workoutSets.id, setId));

  revalidatePath(`/workout/${existing.workoutId}`);
  revalidatePath(`/history/${existing.workoutId}`);
  return { ok: true };
}

export async function deleteSetAction(setId: string): Promise<void> {
  const user = await requireUser();
  const existing = await getOwnedSet(user.id, setId);

  await db.delete(workoutSets).where(eq(workoutSets.id, setId));
  await renumberSets(existing.workoutId, existing.exerciseId);

  revalidatePath(`/workout/${existing.workoutId}`);
  revalidatePath(`/history/${existing.workoutId}`);
}

export async function finishWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkoutOwner(user.id, workoutId);

  const [logged] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, workoutId));

  // Ein Training ohne einen einzigen Satz landet nicht in der Historie.
  if ((logged?.count ?? 0) === 0) {
    await db.delete(workouts).where(eq(workouts.id, workoutId));
    revalidatePath("/");
    redirect("/");
  }

  await db
    .update(workouts)
    .set({ finishedAt: Math.floor(Date.now() / 1000) })
    .where(eq(workouts.id, workoutId));

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/stats");
  redirect(`/history/${workoutId}?feier=1`);
}

export async function discardWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkoutOwner(user.id, workoutId);

  await db.delete(workouts).where(eq(workouts.id, workoutId));

  revalidatePath("/");
  redirect("/");
}

export async function updateWorkoutNotesAction(
  workoutId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  await assertWorkoutOwner(user.id, workoutId);

  const notes = text(formData, "notes").trim().slice(0, 1000);
  await db
    .update(workouts)
    .set({ notes: notes || null })
    .where(eq(workouts.id, workoutId));

  revalidatePath(`/workout/${workoutId}`);
  revalidatePath(`/history/${workoutId}`);
  return { ok: true };
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
  const workout = await assertWorkoutOwner(user.id, workoutId);
  if (workout.finishedAt !== null) return fail("Dieses Training ist bereits beendet.");

  const exerciseId = text(formData, "exerciseId");
  const owned = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)))
    .limit(1);
  if (owned.length === 0) return fail("Bitte eine Übung auswählen.");

  const extras = new Set(
    formData.getAll("extra").map(String).filter(Boolean),
  );
  extras.add(exerciseId);

  const query = [...extras]
    .map((id) => `extra=${encodeURIComponent(id)}`)
    .join("&");

  redirect(`/workout/${workoutId}?${query}#uebung-${exerciseId}`);
}

/** Löscht ein abgeschlossenes Training samt seiner Sätze. */
export async function deleteWorkoutAction(workoutId: string): Promise<void> {
  const user = await requireUser();
  await assertWorkoutOwner(user.id, workoutId);

  await db.delete(workouts).where(eq(workouts.id, workoutId));

  revalidatePath("/");
  revalidatePath("/history");
  revalidatePath("/stats");
  redirect("/history");
}
