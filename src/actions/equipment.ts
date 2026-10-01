"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { optionalText, text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import {
  addEquipmentImage,
  createEquipment,
  deleteEquipment,
  deleteEquipmentImage,
  updateEquipment,
  type EquipmentInput,
} from "@/lib/services/equipment";
import { isServiceError } from "@/lib/services/errors";

const optional = z
  .string()
  .trim()
  .max(80)
  .optional()
  .transform((v) => (v ? v : null));

const decimal = z.preprocess(
  (value) => (typeof value === "string" ? Number(value.trim().replace(",", ".") || 0) : value),
  z.number(),
);

const equipmentInput = z.object({
  name: z.string().trim().min(1, "Das Gerät braucht einen Namen.").max(80),
  manufacturer: optional,
  model: optional,
  kind: z.enum(["stack", "plates", "cable", "free", "bodyweight", "other"]),
  loadFactor: decimal.pipe(z.number().positive().max(4)),
  baseLoadKg: decimal.pipe(
    z.number().min(0, "Das Eigengewicht kann nicht negativ sein.").max(500),
  ),
  notes: z
    .string()
    .trim()
    .max(1000)
    .optional()
    .transform((v) => (v ? v : null)),
});

function readForm(formData: FormData) {
  return equipmentInput.safeParse({
    name: text(formData, "name"),
    manufacturer: optionalText(formData, "manufacturer"),
    model: optionalText(formData, "model"),
    kind: text(formData, "kind", "other"),
    loadFactor: text(formData, "loadFactor", "1"),
    baseLoadKg: text(formData, "baseLoadKg", "0"),
    notes: optionalText(formData, "notes"),
  });
}

export async function createEquipmentAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");

  let id: string;
  try {
    id = await createEquipment(user, parsed.data as EquipmentInput);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/equipment");
  redirect(`/equipment/${id}`);
}

export async function updateEquipmentAction(
  equipmentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = readForm(formData);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Eingaben unvollständig.");

  try {
    await updateEquipment(user, equipmentId, parsed.data as EquipmentInput);
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/equipment");
  revalidatePath(`/equipment/${equipmentId}`);
  return { ok: true };
}

export async function deleteEquipmentAction(equipmentId: string): Promise<void> {
  const user = await requireUser();
  await deleteEquipment(user, equipmentId);
  revalidatePath("/equipment");
  redirect("/equipment");
}

export async function uploadEquipmentImageAction(
  equipmentId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("Bitte ein Foto auswählen.");

  try {
    await addEquipmentImage(user, equipmentId, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath(`/equipment/${equipmentId}`);
  revalidatePath("/equipment");
  return { ok: true };
}

export async function deleteEquipmentImageAction(imageId: string): Promise<void> {
  const user = await requireUser();
  const equipmentId = await deleteEquipmentImage(user, imageId);
  revalidatePath(`/equipment/${equipmentId}`);
  revalidatePath("/equipment");
}
