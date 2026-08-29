"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Select, Textarea } from "@/components/ui";
import type { Exercise } from "@/db/schema";
import { MUSCLE_GROUPS, TRACKING_MODES } from "@/lib/constants";
import type { FormState } from "@/lib/result";

export function ExerciseForm({
  action,
  exercise,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  exercise?: Exercise;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="Name der Übung / Maschine">
          <Input
            name="name"
            required
            maxLength={80}
            defaultValue={exercise?.name}
            placeholder="z. B. Beinpresse"
          />
        </Field>

        <Field label="Muskelgruppe">
          <Select name="muscleGroup" defaultValue={exercise?.muscleGroup ?? ""}>
            <option value="">– keine –</option>
            {MUSCLE_GROUPS.map((group) => (
              <option key={group} value={group}>
                {group}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Art der Messung">
          <Select
            name="trackingMode"
            defaultValue={exercise?.trackingMode ?? "weight_reps"}
          >
            {TRACKING_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Gewichtsstufe (kg)"
          hint="Kleinster Sprung an der Maschine – steuert die +/− Tasten beim Training."
        >
          <Input
            type="number"
            name="weightStepKg"
            inputMode="decimal"
            step="0.25"
            min="0.25"
            max="50"
            defaultValue={exercise?.weightStepKg ?? 2.5}
          />
        </Field>

        <Field
          label="Einstellungen an der Maschine"
          hint="Sitzhöhe, Lehne, Griffposition – damit du es beim nächsten Mal sofort weißt."
        >
          <Textarea
            name="machineSetup"
            rows={3}
            maxLength={500}
            defaultValue={exercise?.machineSetup ?? ""}
            placeholder="Sitz 4, Lehne 2, enger Griff"
          />
        </Field>

        <ErrorMessage>{state.error}</ErrorMessage>
        {state.ok ? (
          <p className="text-sm font-medium text-up">Gespeichert.</p>
        ) : null}

        <SubmitButton size="lg" className="w-full" pendingLabel="Speichern …">
          {submitLabel}
        </SubmitButton>
      </form>
    </Card>
  );
}
