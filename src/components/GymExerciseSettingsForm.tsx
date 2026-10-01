"use client";

import { useActionState, useMemo } from "react";

import { setGymExerciseSettingsAction } from "@/actions/exercises";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input, Textarea } from "@/components/ui";
import { formatKg } from "@/lib/format";
import type { FormState } from "@/lib/result";

/**
 * Was an diesem Gerät in einem bestimmten Studio anders ist als sonst: die
 * Einstellungen und die Gewichtsstufe. Leer gilt der Wert der Übung.
 */
export function GymExerciseSettingsForm({
  gymId,
  exerciseId,
  machineSetup,
  weightStepKg,
  fallbackStepKg,
}: {
  gymId: string;
  exerciseId: string;
  machineSetup: string | null;
  weightStepKg: number | null;
  fallbackStepKg: number;
}) {
  const action = useMemo(
    () => setGymExerciseSettingsAction.bind(null, gymId, exerciseId),
    [gymId, exerciseId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <Field label="Einstellungen hier">
        <Textarea
          name="machineSetup"
          rows={2}
          maxLength={500}
          defaultValue={machineSetup ?? ""}
          placeholder="Sitz 4, Lehne 2 – leer: Einstellung der Übung"
        />
      </Field>
      <Field label="Gewichtsstufe hier (kg)">
        <Input
          name="weightStepKg"
          inputMode="decimal"
          defaultValue={weightStepKg === null ? "" : formatKg(weightStepKg)}
          placeholder={`leer: ${formatKg(fallbackStepKg)} kg wie bei der Übung`}
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton variant="secondary" size="sm" className="w-full">
        Speichern
      </SubmitButton>
    </form>
  );
}
