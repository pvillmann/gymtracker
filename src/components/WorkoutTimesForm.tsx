"use client";

import { useActionState, useMemo } from "react";

import { updateWorkoutTimesAction } from "@/actions/workouts";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function WorkoutTimesForm({
  workoutId,
  startedAt,
  finishedAt,
}: {
  workoutId: string;
  /** Bereits serverseitig formatiert – siehe toDateTimeInput. */
  startedAt: string;
  finishedAt: string;
}) {
  const action = useMemo(
    () => updateWorkoutTimesAction.bind(null, workoutId),
    [workoutId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Field label="Beginn">
          <Input
            type="datetime-local"
            name="startedAt"
            required
            defaultValue={startedAt}
          />
        </Field>
        <Field label="Ende">
          <Input
            type="datetime-local"
            name="finishedAt"
            defaultValue={finishedAt}
          />
        </Field>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton variant="secondary" size="sm" className="w-full">
        Zeiten speichern
      </SubmitButton>
    </form>
  );
}
