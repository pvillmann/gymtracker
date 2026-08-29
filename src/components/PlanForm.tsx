"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function PlanForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: { name: string; notes: string | null };
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name">
        <Input
          name="name"
          required
          maxLength={80}
          defaultValue={defaults?.name}
          placeholder="z. B. Push A"
        />
      </Field>
      <Field label="Notiz" hint="Optional – z. B. Fokus oder Trainingstag.">
        <Textarea
          name="notes"
          rows={2}
          maxLength={1000}
          defaultValue={defaults?.notes ?? ""}
          placeholder="Montag · Brust, Schultern, Trizeps"
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton className="w-full" pendingLabel="Speichern …">
        {submitLabel}
      </SubmitButton>
    </form>
  );
}
