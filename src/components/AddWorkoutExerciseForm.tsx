"use client";

import { useActionState, useMemo } from "react";

import { addExerciseToWorkoutAction } from "@/actions/workouts";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Select } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function AddWorkoutExerciseForm({
  workoutId,
  extras,
  options,
}: {
  workoutId: string;
  /** Bereits spontan ergänzte Übungen – wandern als Hidden-Felder wieder mit. */
  extras: string[];
  options: Array<{ id: string; name: string; muscleGroup: string | null }>;
}) {
  const action = useMemo(
    () => addExerciseToWorkoutAction.bind(null, workoutId),
    [workoutId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted">
        Alle deine Übungen sind schon in diesem Training.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
      {extras.map((id) => (
        <input key={id} type="hidden" name="extra" value={id} />
      ))}
      <Field label="Übung">
        <Select name="exerciseId" required defaultValue="">
          <option value="" disabled>
            Übung wählen …
          </option>
          {options.map((option) => (
            <option key={option.id} value={option.id}>
              {option.muscleGroup ? `${option.muscleGroup} · ` : ""}
              {option.name}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton variant="secondary" className="w-full" pendingLabel="…">
        Übung ergänzen
      </SubmitButton>
    </form>
  );
}
