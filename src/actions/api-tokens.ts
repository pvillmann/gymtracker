"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireUser } from "@/lib/auth";
import { createApiToken, revokeApiToken } from "@/lib/api-tokens";
import { text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";

/** Wie FormState, trägt aber den einmalig sichtbaren Klartext-Schlüssel. */
export type TokenFormState = FormState & { token?: string };

const tokenName = z
  .string()
  .trim()
  .min(1, "Bitte eine Bezeichnung angeben.")
  .max(60);

export async function createApiTokenAction(
  _prev: TokenFormState,
  formData: FormData,
): Promise<TokenFormState> {
  const user = await requireUser();

  const parsed = tokenName.safeParse(text(formData, "name"));
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Eingabe unvollständig.");
  }

  const created = await createApiToken(user.id, parsed.data);

  revalidatePath("/settings");
  // Der Klartext geht genau einmal an die Oberfläche und wird nirgends
  // gespeichert – danach existiert nur noch der Hash.
  return { ok: true, token: created.token };
}

export async function revokeApiTokenAction(tokenId: string): Promise<void> {
  const user = await requireUser();
  await revokeApiToken(user.id, tokenId);
  revalidatePath("/settings");
}
