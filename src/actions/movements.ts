"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { mergeMovements } from "@/lib/services/merge";
import {
  createMovement,
  deleteMovement,
  linkGymEquipment,
  setMovementArchived,
  linkMovementEquipment,
  unlinkGymEquipment,
  unlinkMovementEquipment,
  updateMovement,
  type MovementInput,
} from "@/lib/services/machines";

const movementInput = z.object({
  name: z.string().trim().min(1, "Die Übung braucht einen Namen.").max(80),
  muscleGroup: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((v) => (v ? v : null)),
  trackingMode: z.enum(["weight_reps", "bodyweight_reps", "assisted_reps", "time"]),
});

function readForm(formData: FormData) {
  return movementInput.safeParse({
    name: text(formData, "name"),
    muscleGroup: optionalText(formData, "muscleGroup"),
    trackingMode: text(formData, "trackingMode", "weight_reps"),
  });
}

async function guarded(run: () => Promise<void>): Promise<FormState | null> {
  try {
    await run();
    return null;
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
}

export async function createMovementAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  const wgerId = Number(text(formData, "wgerId")) || null;

  let id = "";
  const failed = await guarded(async () => {
    id = await createMovement(user, parsed.data as MovementInput, wgerId);
  });
  if (failed) return failed;
  revalidatePath("/exercises");
  redirect(`/movements/${id}`);
}

export async function updateMovementAction(
  movementId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");
  const failed = await guarded(() => updateMovement(user, movementId, parsed.data as MovementInput));
  if (failed) return failed;
  revalidatePath("/exercises");
  revalidatePath(`/movements/${movementId}`);
  return { ok: true };
}

/** Maschine ↔ Übung – aus Sicht der Übung oder der Maschine. */
export async function linkMovementMachineAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const movementId = text(formData, "movementId");
  const equipmentId = text(formData, "equipmentId");
  if (!movementId || !equipmentId) return fail("Bitte Übung und Maschine wählen.");
  const failed = await guarded(() => linkMovementEquipment(user, movementId, equipmentId));
  revalidateLink(movementId, equipmentId);
  return failed ?? { ok: true };
}

export async function unlinkMovementMachineAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const movementId = text(formData, "movementId");
  const equipmentId = text(formData, "equipmentId");
  const failed = await guarded(() => unlinkMovementEquipment(user, movementId, equipmentId));
  revalidateLink(movementId, equipmentId);
  return failed ?? { ok: true };
}

function revalidateLink(movementId: string, equipmentId: string) {
  revalidatePath(`/movements/${movementId}`);
  revalidatePath(`/equipment/${equipmentId}`);
  revalidatePath("/exercises");
}

/** Maschine ↔ Studio: steht die Maschine dort oder nicht. */
export async function setMachineInGymAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const equipmentId = text(formData, "equipmentId");
  const gymId = text(formData, "gymId");
  const present = text(formData, "present") === "1";
  if (!equipmentId || !gymId) return fail("Bitte Studio und Maschine wählen.");
  const failed = await guarded(() =>
    present
      ? linkGymEquipment(user, gymId, equipmentId)
      : unlinkGymEquipment(user, gymId, equipmentId),
  );
  revalidatePath(`/equipment/${equipmentId}`);
  revalidatePath(`/gyms/${gymId}`);
  return failed ?? { ok: true };
}

/** Archivieren bzw. wiederherstellen – gemeinsamer Katalog, darf jeder. */
export async function setMovementArchivedAction(movementId: string, archived: boolean): Promise<void> {
  const user = await requireUser();
  await setMovementArchived(user, movementId, archived);
  revalidatePath("/exercises");
  revalidatePath(`/movements/${movementId}`);
}

/** Löschen nur ohne Verlauf; der Service prüft Rechte und Sätze. */
export async function deleteMovementAction(movementId: string): Promise<void> {
  const user = await requireUser();
  await deleteMovement(user, movementId);
  revalidatePath("/exercises");
  redirect("/exercises");
}

/** Diese Übung in eine andere zusammenführen – danach gibt es sie nicht mehr. */
export async function mergeMovementAction(
  sourceId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const targetId = text(formData, "targetId");
  if (!targetId) return fail("Bitte die Übung wählen, die bleibt.");
  const failed = await guarded(async () => {
    await mergeMovements(user, sourceId, targetId);
  });
  if (failed) return failed;
  revalidatePath("/exercises");
  revalidatePath("/plans");
  redirect(`/movements/${targetId}`);
}
