"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { text } from "@/lib/formdata";
import { fail, type FormState } from "@/lib/result";
import { isServiceError } from "@/lib/services/errors";
import { deleteMeal, logMeal } from "@/lib/services/nutrition";

const num = (value: string) => (value.trim() ? Number(value.trim().replace(",", ".")) : null);

/** Mahlzeit von Hand – der Weg über den Chat ist der übliche. */
export async function addMealAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const kcal = num(text(formData, "kcal"));
  if (kcal === null || !Number.isFinite(kcal)) return fail("Bitte Kalorien angeben.");
  const protein = num(text(formData, "proteinG"));
  if (protein !== null && !Number.isFinite(protein)) return fail("Eiweiß bitte als Zahl.");
  try {
    await logMeal(user, {
      description: text(formData, "description"),
      kcal,
      proteinG: protein,
      confidence: "mittel",
      source: "manuell",
    });
  } catch (error) {
    if (isServiceError(error)) return fail(error.message);
    throw error;
  }
  revalidatePath("/ernaehrung");
  revalidatePath("/");
  return { ok: true };
}

export async function deleteMealAction(mealId: string): Promise<void> {
  const user = await requireUser();
  try {
    await deleteMeal(user, mealId);
  } catch (error) {
    if (!isServiceError(error)) throw error;
  }
  revalidatePath("/ernaehrung");
  revalidatePath("/");
}
