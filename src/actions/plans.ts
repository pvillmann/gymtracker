"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import {
  addPlanItem,
  createPlan,
  deletePlan,
  movePlanItem,
  removePlanItem,
  setPlanArchived,
  updatePlan,
  updatePlanItem,
  type PlanTargets,
} from "@/lib/services/plans";

/**
 * Dünner Adapter: Formulardaten einlesen, Fachlogik in lib/services/plans
 * aufrufen, Caches invalidieren. Die Regeln stehen im Service, damit der
 * MCP-Endpunkt exakt dieselben bekommt.
 */

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
  // Leeres Feld ("" bei fehlender Eingabe) darf nicht zu 0 kollabieren –
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

function readTargets(formData: FormData, withDefaults: boolean) {
  return itemInput.safeParse({
    targetSets: text(formData, "targetSets", withDefaults ? "3" : ""),
    targetRepsMin: text(formData, "targetRepsMin", withDefaults ? "8" : ""),
    targetRepsMax: text(formData, "targetRepsMax", withDefaults ? "12" : ""),
    targetDurationSeconds: optionalText(formData, "targetDurationSeconds"),
    restSeconds: text(formData, "restSeconds", withDefaults ? "90" : ""),
    notes: optionalText(formData, "notes"),
  });
}

function readPlan(formData: FormData) {
  return planInput.safeParse({
    name: text(formData, "name"),
    notes: optionalText(formData, "notes"),
  });
}

/** Macht aus einem Service-Fehler eine Formularmeldung. */
async function guarded<T>(
  run: () => Promise<T>,
): Promise<{ ok: true; value: T } | { ok: false; state: FormState }> {
  try {
    return { ok: true, value: await run() };
  } catch (error) {
    if (isServiceError(error)) return { ok: false, state: fail(error.message) };
    throw error;
  }
}

export async function createPlanAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readPlan(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  const planId = await createPlan(user, parsed.data);

  revalidatePath("/plans");
  redirect(`/plans/${planId}`);
}

export async function updatePlanAction(
  planId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readPlan(formData);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  }

  const result = await guarded(() => updatePlan(user, planId, parsed.data));
  if (!result.ok) return result.state;

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

export async function setPlanArchivedAction(
  planId: string,
  archived: boolean,
): Promise<void> {
  const user = await requireUser();
  await setPlanArchived(user, planId, archived);

  revalidatePath("/plans");
  revalidatePath(`/plans/${planId}`);
}

export async function deletePlanAction(planId: string): Promise<void> {
  const user = await requireUser();
  await deletePlan(user, planId);

  revalidatePath("/plans");
  redirect("/plans");
}

export async function addPlanExerciseAction(
  planId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const exerciseId = text(formData, "exerciseId");
  if (!exerciseId) return fail("Bitte eine Übung auswählen.");

  const parsed = readTargets(formData, true);
  if (!parsed.success) return fail("Bitte gültige Zielwerte angeben.");

  const result = await guarded(() =>
    addPlanItem(user, planId, exerciseId, parsed.data as PlanTargets),
  );
  if (!result.ok) return result.state;

  revalidatePath(`/plans/${planId}`);
  return { ok: true };
}

export async function updatePlanExerciseAction(
  itemId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();

  const parsed = readTargets(formData, false);
  if (!parsed.success) return fail("Bitte gültige Zielwerte angeben.");

  const result = await guarded(() =>
    updatePlanItem(user, itemId, parsed.data as PlanTargets),
  );
  if (!result.ok) return result.state;

  revalidatePath(`/plans/${result.value.planId}`);
  return { ok: true };
}

export async function removePlanExerciseAction(itemId: string): Promise<void> {
  const user = await requireUser();
  const { planId } = await removePlanItem(user, itemId);

  revalidatePath(`/plans/${planId}`);
}

/** Tauscht den Eintrag mit seinem Nachbarn – Reihenfolge per Pfeiltaste. */
export async function movePlanExerciseAction(
  itemId: string,
  direction: "up" | "down",
): Promise<void> {
  const user = await requireUser();
  const { planId } = await movePlanItem(user, itemId, direction);

  revalidatePath(`/plans/${planId}`);
}
