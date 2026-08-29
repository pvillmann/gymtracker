"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input, Select } from "@/components/ui";
import type { TrackingMode } from "@/db/schema";
import type { FormState } from "@/lib/result";

const REST_OPTIONS = [0, 30, 45, 60, 90, 120, 150, 180, 240, 300];

function restLabel(seconds: number): string {
  if (seconds === 0) return "keine";
  if (seconds < 60) return `${seconds} s`;
  const minutes = seconds / 60;
  return Number.isInteger(minutes) ? `${minutes} min` : `${seconds} s`;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Zieldauer als Minuten + Sekunden statt einem nackten Sekundenfeld – "20 min"
 * einzugeben ist für Laufband & Co. deutlich angenehmer als "1200".
 */
function DurationField({
  name,
  label,
  defaultSeconds,
}: {
  name: string;
  label: string;
  defaultSeconds: number;
}) {
  const [minutes, setMinutes] = useState(Math.floor(defaultSeconds / 60));
  const [seconds, setSeconds] = useState(defaultSeconds % 60);

  return (
    <Field label={label}>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={600}
          aria-label="Minuten"
          value={minutes}
          onChange={(event) => setMinutes(clamp(Number(event.target.value) || 0, 0, 600))}
        />
        <span className="shrink-0 text-sm text-muted">min</span>
        <Input
          type="number"
          inputMode="numeric"
          min={0}
          max={59}
          aria-label="Sekunden"
          value={seconds}
          onChange={(event) => setSeconds(clamp(Number(event.target.value) || 0, 0, 59))}
        />
        <span className="shrink-0 text-sm text-muted">s</span>
      </div>
      <input type="hidden" name={name} value={minutes * 60 + seconds} />
    </Field>
  );
}

export type PlanItemDefaults = {
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number;
  notes: string | null;
};

/**
 * Zielvorgaben eines Plan-Eintrags. Bei Zeit-Übungen (z. B. Laufband, Plank)
 * ergibt ein Wiederholungsbereich keinen Sinn – dort steht stattdessen eine
 * Zieldauer.
 */
export function PlanItemFields({
  trackingMode,
  defaults,
}: {
  trackingMode: TrackingMode;
  defaults?: PlanItemDefaults;
}) {
  const isTimed = trackingMode === "time";
  // Durchgehendes Cardio (Laufband, Rad) braucht weder mehrere Sätze noch
  // eine Pause – nur Intervall-Cardio (Sprints, Plank-Halten) tut das. Neue
  // Zeit-Übungen starten deshalb bei 1 Satz ohne Pause; wer Intervalle will,
  // stellt das gezielt um.
  const defaultSets = defaults?.targetSets ?? (isTimed ? 1 : 3);
  const defaultRest = defaults?.restSeconds ?? (isTimed ? 0 : 90);

  return (
    <>
      {isTimed ? (
        <div className="grid grid-cols-2 gap-2">
          <Field label="Sätze" hint="1 = durchgehend, mehr für Intervalle">
            <Input
              type="number"
              name="targetSets"
              inputMode="numeric"
              min={1}
              max={20}
              required
              defaultValue={defaultSets}
            />
          </Field>
          <DurationField
            name="targetDurationSeconds"
            label="Zieldauer"
            defaultSeconds={defaults?.targetDurationSeconds ?? 60}
          />
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2">
          <Field label="Sätze">
            <Input
              type="number"
              name="targetSets"
              inputMode="numeric"
              min={1}
              max={20}
              required
              defaultValue={defaultSets}
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
      )}
      <Field label="Pause zwischen den Sätzen">
        <Select name="restSeconds" defaultValue={String(defaultRest)}>
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
  options: Array<{
    id: string;
    name: string;
    muscleGroup: string | null;
    trackingMode: TrackingMode;
  }>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [exerciseId, setExerciseId] = useState("");

  if (options.length === 0) {
    return (
      <p className="text-sm text-muted">
        Alle deine Übungen sind schon in diesem Plan.
      </p>
    );
  }

  const selected = options.find((option) => option.id === exerciseId);

  return (
    <form action={formAction} className="space-y-3">
      <Field label="Übung">
        <Select
          name="exerciseId"
          required
          value={exerciseId}
          onChange={(event) => setExerciseId(event.target.value)}
        >
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
      {/* key erzwingt einen Remount beim Wechsel des Tracking-Modus – sonst
          behält React die Sätze-/Pause-Felder bei und die neuen
          defaultValue-Werte (z. B. 1 Satz statt 3) greifen nicht. */}
      <PlanItemFields
        key={selected?.trackingMode ?? "weight_reps"}
        trackingMode={selected?.trackingMode ?? "weight_reps"}
      />
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton className="w-full" pendingLabel="Wird hinzugefügt …">
        Zum Plan hinzufügen
      </SubmitButton>
    </form>
  );
}

export function EditPlanItemForm({
  action,
  trackingMode,
  defaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  trackingMode: TrackingMode;
  defaults: PlanItemDefaults;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      <PlanItemFields trackingMode={trackingMode} defaults={defaults} />
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton size="sm" variant="secondary" className="w-full">
        Zielwerte speichern
      </SubmitButton>
    </form>
  );
}
