"use client";

import { useActionState, useMemo } from "react";

import { updateWorkoutNotesAction } from "@/actions/workouts";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function WorkoutNotesForm({
  workoutId,
  notes,
}: {
  workoutId: string;
  notes: string | null;
}) {
  const action = useMemo(
    () => updateWorkoutNotesAction.bind(null, workoutId),
    [workoutId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <Textarea
        name="notes"
        rows={3}
        maxLength={1000}
        defaultValue={notes ?? ""}
        placeholder="Wie lief es? Schlaf, Ernährung, Schmerzen …"
        aria-label="Notiz zum Training"
      />
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton variant="secondary" size="sm" className="w-full">
        Notiz speichern
      </SubmitButton>
    </form>
  );
}
