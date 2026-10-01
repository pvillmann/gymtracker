"use server";

import { revalidatePath } from "next/cache";

import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { uploadPhotoWithLink } from "@/lib/services/photo-upload";

/**
 * Upload über einen Einmal-Link – ohne Anmeldung. Berechtigt ist, wer den
 * Link kennt; was er darf, legt der Link fest: ein Foto für eine Maschine.
 */
export async function uploadWithLinkAction(
  token: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return fail("Bitte ein Foto auswählen.");

  try {
    const { equipmentId } = await uploadPhotoWithLink(token, Buffer.from(await file.arrayBuffer()));
    revalidatePath(`/equipment/${equipmentId}`);
    revalidatePath("/equipment");
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  return { ok: true };
}
