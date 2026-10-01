"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { deleteGym, findOrCreateGym, renameGym } from "@/lib/services/gyms";

async function guarded(run: () => Promise<void>): Promise<FormState> {
  try {
    await run();
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/settings");
  return { ok: true };
}

export async function createGymAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  return guarded(async () => {
    await findOrCreateGym(user, text(formData, "name"));
  });
}

export async function renameGymAction(
  gymId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  return guarded(() => renameGym(user, gymId, text(formData, "name")));
}

export async function deleteGymAction(gymId: string): Promise<void> {
  const user = await requireUser();
  await deleteGym(user, gymId);
  revalidatePath("/settings");
}
