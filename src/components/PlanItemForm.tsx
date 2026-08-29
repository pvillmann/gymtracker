"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input, Select } from "@/components/ui";
import type { FormState } from "@/lib/result";

const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

function restLabel(seconds: number): string {
  if (seconds === 0) return "keine";
  if (seconds < 60) return `${seconds} s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${seconds} s`;
}

export type PlanItemDefaults = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  restSeconds: number;
  notes: string | null;
};

/** Zielvorgaben eines Plan-Eintrags: Sätze, Wiederholungsbereich, Pause. */
export function PlanItemFields({ defaults }: { defaults?: PlanItemDefaults }) {
  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <Field label="Sätze">
          <Input
            type="number"
            name="targetSets"
            inputMode="numeric"
            min={1}
            max={20}
            required
            defaultValue={defaults?.targetSets ?? 3}
          />
        </Field>
        <Field label="Wdh. von">
          <Input
            type="number"
            name="targetRepsMin"
            inputMode="numeric"
            min={1}
            max={200}
            required
            defaultValue={defaults?.targetRepsMin ?? 8}
          />
        </Field>
        <Field label="bis">
          <Input
            type="number"
            name="targetRepsMax"
            inputMode="numeric"
            min={1}
            max={200}
            required
            defaultValue={defaults?.targetRepsMax ?? 12}
          />
        </Field>
      </div>
      <Field label="Pause zwischen den Sätzen">
        <Select name="restSeconds" defaultValue={String(defaults?.restSeconds ?? 90)}>
          {REST_OPTIONS.map((seconds) => (
            <option key={seconds} value={seconds}>
              {restLabel(seconds)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Notiz">
        <Input
          name="notes"
          maxLength={300}
          defaultValue={defaults?.notes ?? ""}
          placeholder="z. B. langsam ablassen"
        />
      </Field>
    </>
  );
}

export function AddPlanItemForm({
  action,
  options,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  options: Array<{ id: string; name: string; muscleGroup: string | null }>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted">
        Alle deine Übungen sind schon in diesem Plan.
      </p>
    );
  }

  return (
    <form action={formAction} className="space-y-3">
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
      <PlanItemFields />
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton className="w-full" pendingLabel="Wird hinzugefügt …">
        Zum Plan hinzufügen
      </SubmitButton>
    </form>
  );
}

export function EditPlanItemForm({
  action,
  defaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults: PlanItemDefaults;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <PlanItemFields defaults={defaults} />
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton size="sm" variant="secondary" className="w-full">
        Zielwerte speichern
      </SubmitButton>
    </form>
  );
}
