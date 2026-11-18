"use client";

import { useActionState } from "react";

import { addMealAction } from "@/actions/nutrition";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

/** Von Hand eintragen. Nach dem Speichern leer – für die nächste Mahlzeit. */
export function MealForm() {
  const [state, formAction] = useActionState<FormState, FormData>(addMealAction, {});
  return (
    <form action={formAction} className="space-y-3">
      <Field label="Was">
        <Input name="description" required maxLength={300} placeholder="z. B. Skyr mit Beeren, 250 g" />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="kcal">
          <Input name="kcal" inputMode="decimal" required placeholder="320" />
        </Field>
        <Field label="Eiweiß (g)">
          <Input name="proteinG" inputMode="decimal" placeholder="30" />
        </Field>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton className="w-full" variant="secondary">
        Eintragen
      </SubmitButton>
    </form>
  );
}
