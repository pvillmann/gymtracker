"use server";

import { and, asc, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { db } from "@/db";
import { exercises, planExercises, plans, type TrackingMode } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { optionalText, text } from "@/lib/formdata";
import { newId } from "@/lib/ids";
import { fail, type FormState } from "@/lib/result";

const planInput = z.object({
  name: z.string().trim().min(1, "Der Plan braucht einen Namen.").max(80),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : null)),
});

const itemInput = z.object({
  targetSets: z.coerce.number().int().min(1).max(20),
  targetRepsMin: z.coerce.number().int().min(1).max(200),
  targetRepsMax: z.coerce.number().int().min(1).max(200),
  // Leeres Feld ("" bei fehlender Eingabe) darf nicht zu 0 kollabieren -
  // sonst würde Number("") als gültige Dauer 0 durchrutschen.
  targetDurationSeconds: z
    .string()
    .optional()
    .transform((v) => (v ? Number(v) : undefined))
    .pipe(z.number().int().min(1).max(36_000).optional()),
  restSeconds: z.coerce.number().int().min(0).max(900),
  notes: z
    .string()
    .trim()
    .max(300)
    .optional()
    .transform((v) => (v ? v : null)),
});

type ResolvedTargetFields = Omit<z.infer<typeof itemInput>, "targetDurationSeconds"> & {
  targetDurationSeconds: number | null;
};

type ResolveResult =
  | { ok: true; fields: ResolvedTargetFields }
  | { ok: false; error: string };

/**
 * Baut die zu speichernden Zielwerte je nach Tracking-Modus: Zeit-Übungen
 * bekommen eine Zieldauer statt eines Wiederholungsbereichs, damit z. B. beim
 * Laufband nicht sinnlos "8-12 Wdh." im Plan steht.
 */
function resolveTargetFields(
  trackingMode: TrackingMode,
  data: z.infer<typeof itemInput>,
): ResolveResult {
  if (trackingMode === "time") {
    if (!data.targetDurationSeconds) {
      return { ok: false, error: "Bitte eine Zieldauer angeben." };
    }
    return {
      ok: true,
      fields: { ...data, targetDurationSeconds: data.targetDurationSeconds },
    };
  }
  if (data.targetRepsMin > data.targetRepsMax) {
    return {
      ok: false,
      error: "Die Mindest-Wiederholungen dürfen nicht größer sein als das Maximum.",
    };
  }
  return { ok: true, fields: { ...data, targetDurationSeconds: null } };
}

/** Wirft, wenn der Plan nicht dem angemeldeten Nutzer gehört. */
async function assertPlanOwner(userId: string, planId: string): Promise<void> {
  const rows = await db
    .select({ id: plans.id })
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("NOT_FOUND");
}

/** Lädt einen Plan-Eintrag inklusive Besitzprüfung über den zugehörigen Plan. */
async function getOwnedItem(userId: string, itemId: string) {
  const rows = await db
    .select({
      id: planExercises.id,
      planId: planExercises.planId,
      position: planExercises.position,
      trackingMode: exercises.trackingMode,
    })
    .from(planExercises)
    .innerJoin(plans, eq(plans.id, planExercises.planId))
    .innerJoin(exercises, eq(exercises.id, planExercises.exerciseId))
    .where(and(eq(planExercises.id, itemId), eq(plans.userId, userId)))
    .limit(1);

  const item = rows[0];
  if (!item) throw new Error("NOT_FOUND");
  return item;
}

export async function createPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = planInput.safeParse({
    name: text(formData, "name"),
    notes: optionalText(formData, "notes"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  const id = newId();
  await db.insert(plans).values({ id, userId: user.id, ...parsed.data });

  revalidatePath("/plans");
  redirect(`/plans/${id}`);
}

export async function updatePlanAction(
  planId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = planInput.safeParse({
    name: text(formData, "name"),
    notes: optionalText(formData, "notes"),
  });
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  await db
    .update(plans)
    .set(parsed.data)
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

export async function setPlanArchivedAction(
  planId: string,
  archived: boolean,
): Promise<void> {
  const user = await requireUser();

  await db
    .update(plans)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
}

/**
 * Löscht den Plan. Bereits absolvierte Trainings bleiben erhalten – deren
 * plan_id wird per Fremdschlüssel auf NULL gesetzt, der Name steckt im Workout.
 */
export async function deletePlanAction(planId: string): Promise<void> {
  const user = await requireUser();

  await db
    .delete(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, user.id)));

  revalidatePath("/plans");
  redirect("/plans");
}

export async function addPlanExerciseAction(
  planId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  await assertPlanOwner(user.id, planId);

  const exerciseId = text(formData, "exerciseId");
  if (!exerciseId) return fail("Bitte eine Übung auswählen.");

  const owned = await db
    .select({ id: exercises.id, trackingMode: exercises.trackingMode })
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, user.id)))
    .limit(1);
  const exercise = owned[0];
  if (!exercise) return fail("Diese Übung gibt es nicht.");

  const parsed = itemInput.safeParse({
    targetSets: text(formData, "targetSets", "3"),
    targetRepsMin: text(formData, "targetRepsMin", "8"),
    targetRepsMax: text(formData, "targetRepsMax", "12"),
    targetDurationSeconds: optionalText(formData, "targetDurationSeconds"),
    restSeconds: text(formData, "restSeconds", "90"),
    notes: optionalText(formData, "notes"),
  });
  if (!parsed.success) return fail("Bitte gültige Zielwerte angeben.");

  const resolved = resolveTargetFields(exercise.trackingMode, parsed.data);
  if (!resolved.ok) return fail(resolved.error);

  const [last] = await db
    .select({ max: sql<number | null>`max(${planExercises.position})` })
    .from(planExercises)
    .where(eq(planExercises.planId, planId));

  await db.insert(planExercises).values({
    id: newId(),
    planId,
    exerciseId,
    position: (last?.max ?? -1) + 1,
    ...resolved.fields,
  });

  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

export async function updatePlanExerciseAction(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const item = await getOwnedItem(user.id, itemId);

  const parsed = itemInput.safeParse({
    targetSets: text(formData, "targetSets"),
    targetRepsMin: text(formData, "targetRepsMin"),
    targetRepsMax: text(formData, "targetRepsMax"),
    targetDurationSeconds: optionalText(formData, "targetDurationSeconds"),
    restSeconds: text(formData, "restSeconds"),
    notes: optionalText(formData, "notes"),
  });
  if (!parsed.success) return fail("Bitte gültige Zielwerte angeben.");

  const resolved = resolveTargetFields(item.trackingMode, parsed.data);
  if (!resolved.ok) return fail(resolved.error);

  await db
    .update(planExercises)
    .set(resolved.fields)
    .where(eq(planExercises.id, itemId));

  revalidatePath(`/plans/${item.planId}`);
  return { ok: true };
}

export async function removePlanExerciseAction(itemId: string): Promise<void> {
  const user = await requireUser();
  const item = await getOwnedItem(user.id, itemId);

  await db.delete(planExercises).where(eq(planExercises.id, itemId));

  revalidatePath(`/plans/${item.planId}`);
}

/** Tauscht den Eintrag mit seinem Nachbarn – Reihenfolge per Pfeiltaste. */
export async function movePlanExerciseAction(
  itemId: string,
  direction: "up" | "down",
): Promise<void> {
  const user = await requireUser();
  const item = await getOwnedItem(user.id, itemId);

  const siblings = await db
    .select({ id: planExercises.id, position: planExercises.position })
    .from(planExercises)
    .where(eq(planExercises.planId, item.planId))
    .orderBy(asc(planExercises.position));

  const index = siblings.findIndex((s) => s.id === itemId);
  const targetIndex = direction === "up" ? index - 1 : index + 1;
  if (index < 0 || targetIndex < 0 || targetIndex >= siblings.length) return;

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

  revalidatePath(`/plans/${item.planId}`);
}
