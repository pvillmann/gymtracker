import "server-only";

import { and, asc, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  exercises,
  planExercises,
  plans,
  type TrackingMode,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";

export type PlanInput = { name: string; notes?: string | null };

export type PlanTargets = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds?: number;
  restSeconds: number;
  notes?: string | null;
};

type ResolvedTargets = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number;
  notes: string | null;
};

/**
 * Baut die zu speichernden Zielwerte je nach Messart: Zeit-Übungen bekommen
 * eine Zieldauer statt eines Wiederholungsbereichs, damit z. B. beim Laufband
 * nicht sinnlos "8–12 Wdh." im Plan steht.
 */
export function resolveTargets(
  trackingMode: TrackingMode,
  targets: PlanTargets,
): ResolvedTargets {
  const base = {
    targetSets: targets.targetSets,
    targetRepsMin: targets.targetRepsMin,
    targetRepsMax: targets.targetRepsMax,
    restSeconds: targets.restSeconds,
    notes: targets.notes ?? null,
  };

  if (trackingMode === "time") {
    if (!targets.targetDurationSeconds) {
      throw new ServiceError("Bitte eine Zieldauer angeben.");
    }
    return { ...base, targetDurationSeconds: targets.targetDurationSeconds };
  }

  if (targets.targetRepsMin > targets.targetRepsMax) {
    throw new ServiceError(
      "Die Mindest-Wiederholungen dürfen nicht größer sein als das Maximum.",
    );
  }
  return { ...base, targetDurationSeconds: null };
}

export async function requireOwnPlan(userId: string, planId: string) {
  const rows = await db
    .select({ id: plans.id, name: plans.name })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);

  const plan = rows[0];
  if (!plan) throw new ServiceError("Diesen Plan gibt es nicht.");
  return plan;
}

export async function getOwnedPlanItem(userId: string, itemId: string) {
  const rows = await db
    .select({
      id: planExercises.id,
      planId: planExercises.planId,
      position: planExercises.position,
      trackingMode: exercises.trackingMode,
      exerciseName: exercises.name,
    })
    .from(planExercises)
    .innerJoin(plans, eq(plans.id, planExercises.planId))
    .innerJoin(exercises, eq(exercises.id, planExercises.exerciseId))
    .where(and(eq(planExercises.id, itemId), eq(plans.userId, userId)))
    .limit(1);

  const item = rows[0];
  if (!item) throw new ServiceError("Diesen Plan-Eintrag gibt es nicht.");
  return item;
}

export async function createPlan(user: User, input: PlanInput): Promise<string> {
  const planId = newId();
  await db.insert(plans).values({
    id: planId,
    userId: user.id,
    name: input.name,
    notes: input.notes ?? null,
  });
  return planId;
}

export async function updatePlan(
  user: User,
  planId: string,
  input: PlanInput,
): Promise<void> {
  await requireOwnPlan(user.id, planId);
  await db
    .update(plans)
    .set({ name: input.name, notes: input.notes ?? null })
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));
}

export async function setPlanArchived(
  user: User,
  planId: string,
  archived: boolean,
): Promise<void> {
  await requireOwnPlan(user.id, planId);
  await db
    .update(plans)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));
}

/**
 * Löscht den Plan. Bereits absolvierte Trainings bleiben erhalten – deren
 * plan_id wird per Fremdschlüssel auf NULL gesetzt, der Name steckt im Workout.
 */
export async function deletePlan(user: User, planId: string): Promise<void> {
  await db.delete(plans).where(and(eq(plans.id, planId), eq(plans.userId, user.id)));
}

export async function addPlanItem(
  user: User,
  planId: string,
  exerciseId: string,
  targets: PlanTargets,
): Promise<{ itemId: string; position: number }> {
  await requireOwnPlan(user.id, planId);

  const owned = await db
    .select({ id: exercises.id, trackingMode: exercises.trackingMode })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)))
    .limit(1);

  const exercise = owned[0];
  if (!exercise) throw new ServiceError("Diese Übung gibt es nicht.");

  const resolved = resolveTargets(exercise.trackingMode, targets);

  const [last] = await db
    .select({ max: sql<number | null>`max(${planExercises.position})` })
    .from(planExercises)
    .where(eq(planExercises.planId, planId));

  const itemId = newId();
  const position = (last?.max ?? -1) + 1;

  await db.insert(planExercises).values({
    id: itemId,
    planId,
    exerciseId,
    position,
    ...resolved,
  });

  return { itemId, position };
}

export async function updatePlanItem(
  user: User,
  itemId: string,
  targets: PlanTargets,
): Promise<{ planId: string }> {
  const item = await getOwnedPlanItem(user.id, itemId);
  const resolved = resolveTargets(item.trackingMode, targets);

  await db.update(planExercises).set(resolved).where(eq(planExercises.id, itemId));

  return { planId: item.planId };
}

export async function removePlanItem(
  user: User,
  itemId: string,
): Promise<{ planId: string }> {
  const item = await getOwnedPlanItem(user.id, itemId);
  await db.delete(planExercises).where(eq(planExercises.id, itemId));
  return { planId: item.planId };
}

/** Tauscht den Eintrag mit seinem Nachbarn und vergibt die Positionen neu. */
export async function movePlanItem(
  user: User,
  itemId: string,
  direction: "up" | "down",
): Promise<{ planId: string }> {
  const item = await getOwnedPlanItem(user.id, itemId);

  const siblings = await db
    .select({ id: planExercises.id, position: planExercises.position })
    .from(planExercises)
    .where(eq(planExercises.planId, item.planId))
    .orderBy(asc(planExercises.position));

  const index = siblings.findIndex((s) => s.id === itemId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) {
    return { planId: item.planId };
  }

  const [reordered] = siblings.splice(index, 1);
  siblings.splice(targetIndex, 0, reordered);

  // Positionen komplett neu vergeben, damit keine Lücken entstehen.
  for (const [position, sibling] of siblings.entries()) {
    if (sibling.position !== position) {
      await db
        .update(planExercises)
        .set({ position })
        .where(eq(planExercises.id, sibling.id));
    }
  }

  return { planId: item.planId };
}
