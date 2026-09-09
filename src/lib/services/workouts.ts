import "server-only";

import { and, asc, desc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  exercises,
  plans,
  workouts,
  workoutSets,
  type TrackingMode,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { getActiveWorkout } from "@/lib/queries";
import { ServiceError } from "@/lib/services/errors";
import { setVolume } from "@/lib/training";

/**
 * Fachlogik rund um Trainings, unabhängig davon, wer sie aufruft.
 *
 * Die Oberfläche kommt über Server Actions mit Cookie-Anmeldung hierher, der
 * MCP-Server mit einem API-Schlüssel. Beide sollen dieselben Regeln bekommen –
 * Satznummerierung und Volumenrechnung dürfen sich nicht auseinanderentwickeln.
 */

async function requireOpenWorkout(userId: string, workoutId: string) {
  const rows = await db
    .select({ id: workouts.id, finishedAt: workouts.finishedAt })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);

  const workout = rows[0];
  if (!workout) throw new ServiceError("Dieses Training gibt es nicht.");
  if (workout.finishedAt !== null) {
    throw new ServiceError("Dieses Training ist bereits beendet.");
  }
  return workout;
}

export async function requireOwnExercise(userId: string, exerciseId: string) {
  const rows = await db
    .select({
      id: exercises.id,
      name: exercises.name,
      trackingMode: exercises.trackingMode,
    })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)))
    .limit(1);

  const exercise = rows[0];
  if (!exercise) throw new ServiceError("Diese Übung gibt es nicht.");
  return exercise;
}

/** Schließt Lücken in der Satz-Nummerierung, etwa nach dem Löschen. */
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
      await db.update(workoutSets).set({ setNumber }).where(eq(workoutSets.id, set.id));
    }
  }
}

export type StartedWorkout = { workoutId: string; name: string; resumed: boolean };

/**
 * Startet ein Training – oder gibt das bereits laufende zurück. Zwei
 * gleichzeitig offene Trainings würden den Vergleich zum letzten Mal verwirren.
 */
export async function startWorkout(
  user: User,
  planId: string | null,
): Promise<StartedWorkout> {
  const running = await getActiveWorkout(user.id);
  if (running) {
    return { workoutId: running.id, name: running.name, resumed: true };
  }

  let name = "Freies Training";
  if (planId) {
    const rows = await db
      .select({ name: plans.name })
      .from(plans)
      .where(and(eq(plans.id, planId), eq(plans.userId, user.id)))
      .limit(1);
    if (!rows[0]) throw new ServiceError("Diesen Plan gibt es nicht.");
    name = rows[0].name;
  }

  const workoutId = newId();
  await db.insert(workouts).values({ id: workoutId, userId: user.id, planId, name });

  return { workoutId, name, resumed: false };
}

export type SetValues = {
  weightKg: number;
  reps: number;
  durationSeconds?: number;
  isWarmup?: boolean;
};

/** Prüft, ob die Werte zur Messart der Übung passen. */
function assertValuesFit(mode: TrackingMode, values: SetValues): void {
  if (mode === "time") {
    if (!values.durationSeconds) throw new ServiceError("Bitte eine Dauer angeben.");
    return;
  }
  if (values.reps <= 0) throw new ServiceError("Bitte die Wiederholungen angeben.");
}

export type LoggedSet = {
  setId: string;
  setNumber: number;
  volumeKg: number;
  exerciseName: string;
};

export async function logSet(
  user: User,
  workoutId: string,
  exerciseId: string,
  values: SetValues,
): Promise<LoggedSet> {
  await requireOpenWorkout(user.id, workoutId);
  const exercise = await requireOwnExercise(user.id, exerciseId);
  assertValuesFit(exercise.trackingMode, values);

  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(
      and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.exerciseId, exercise.id)),
    );

  const setId = newId();
  const setNumber = (existing?.count ?? 0) + 1;
  const volumeKg = setVolume(
    exercise.trackingMode,
    values.weightKg,
    values.reps,
    user.bodyweightKg,
  );

  await db.insert(workoutSets).values({
    id: setId,
    workoutId,
    exerciseId: exercise.id,
    setNumber,
    weightKg: values.weightKg,
    reps: values.reps,
    durationSeconds: values.durationSeconds ?? null,
    isWarmup: values.isWarmup ?? false,
    volumeKg,
  });

  return { setId, setNumber, volumeKg, exerciseName: exercise.name };
}

/** Lädt einen Satz inklusive Besitzprüfung über das zugehörige Training. */
export async function getOwnedSet(userId: string, setId: string) {
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
  if (!set) throw new ServiceError("Diesen Satz gibt es nicht.");
  return set;
}

export async function updateSet(
  user: User,
  setId: string,
  values: SetValues,
): Promise<void> {
  const existing = await getOwnedSet(user.id, setId);
  const exercise = await requireOwnExercise(user.id, existing.exerciseId);
  assertValuesFit(exercise.trackingMode, values);

  await db
    .update(workoutSets)
    .set({
      weightKg: values.weightKg,
      reps: values.reps,
      durationSeconds: values.durationSeconds ?? null,
      isWarmup: values.isWarmup ?? false,
      volumeKg: setVolume(
        exercise.trackingMode,
        values.weightKg,
        values.reps,
        user.bodyweightKg,
      ),
    })
    .where(eq(workoutSets.id, setId));
}

export async function deleteSet(user: User, setId: string): Promise<{ workoutId: string }> {
  const existing = await getOwnedSet(user.id, setId);

  await db.delete(workoutSets).where(eq(workoutSets.id, setId));
  await renumberSets(existing.workoutId, existing.exerciseId);

  return { workoutId: existing.workoutId };
}

/** Nimmt den zuletzt protokollierten Satz einer Übung zurück. */
export async function deleteLastSet(
  user: User,
  workoutId: string,
  exerciseId: string,
): Promise<{ setNumber: number }> {
  await requireOpenWorkout(user.id, workoutId);

  const rows = await db
    .select({ id: workoutSets.id, setNumber: workoutSets.setNumber })
    .from(workoutSets)
    .where(
      and(eq(workoutSets.workoutId, workoutId), eq(workoutSets.exerciseId, exerciseId)),
    )
    .orderBy(desc(workoutSets.setNumber))
    .limit(1);

  const last = rows[0];
  if (!last) throw new ServiceError("Für diese Übung ist noch kein Satz gespeichert.");

  await deleteSet(user, last.id);
  return { setNumber: last.setNumber };
}

/**
 * Beendet ein Training. Eines ohne einen einzigen Satz wird verworfen statt
 * gespeichert – sonst sammeln sich leere Einträge in der Historie.
 */
export async function finishWorkout(
  user: User,
  workoutId: string,
): Promise<{ discarded: boolean }> {
  await requireOpenWorkout(user.id, workoutId);

  const [logged] = await db
    .select({ count: sql<number>`count(*)` })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, workoutId));

  if ((logged?.count ?? 0) === 0) {
    await db.delete(workouts).where(eq(workouts.id, workoutId));
    return { discarded: true };
  }

  await db
    .update(workouts)
    .set({ finishedAt: Math.floor(Date.now() / 1000) })
    .where(eq(workouts.id, workoutId));

  return { discarded: false };
}

/** Wie requireOpenWorkout, akzeptiert aber auch beendete Trainings. */
export async function requireOwnWorkout(userId: string, workoutId: string) {
  const rows = await db
    .select({ id: workouts.id, finishedAt: workouts.finishedAt })
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);

  const workout = rows[0];
  if (!workout) throw new ServiceError("Dieses Training gibt es nicht.");
  return workout;
}

/** Verwirft ein Training samt seiner Sätze, egal ob offen oder beendet. */
export async function discardWorkout(user: User, workoutId: string): Promise<void> {
  await requireOwnWorkout(user.id, workoutId);
  await db.delete(workouts).where(eq(workouts.id, workoutId));
}

export async function setWorkoutNotes(
  user: User,
  workoutId: string,
  notes: string,
): Promise<void> {
  await requireOwnWorkout(user.id, workoutId);
  const trimmed = notes.trim().slice(0, 1000);
  await db
    .update(workouts)
    .set({ notes: trimmed || null })
    .where(eq(workouts.id, workoutId));
}
