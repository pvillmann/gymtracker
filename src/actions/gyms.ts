"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { deleteGym, findOrCreateGym, renameGym } from "@/lib/services/gyms";

/** Studios sind gemeinsamer Katalog: anlegen und umbenennen darf jeder. */
export async function createGymAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  let id: string;
  try {
    id = await findOrCreateGym(user, text(formData, "name"));
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/gyms");
  redirect(`/gyms/${id}`);
}

export async function renameGymAction(
  gymId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  try {
    await renameGym(user, gymId, text(formData, "name"));
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/gyms");
  revalidatePath(`/gyms/${gymId}`);
  return { ok: true };
}

/** Löschen nur, wer das Studio angelegt hat, oder ein Admin – prüft der Service. */
export async function deleteGymAction(gymId: string): Promise<void> {
  const user = await requireUser();
  await deleteGym(user, gymId);
  revalidatePath("/gyms");
  redirect("/gyms");
}
