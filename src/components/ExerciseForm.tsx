"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Select, Textarea } from "@/components/ui";
import type { Exercise } from "@/db/schema";
import { MUSCLE_GROUPS, TRACKING_MODES } from "@/lib/constants";
import type { FormState } from "@/lib/result";

export type MovementOption = { name: string; muscleGroup: string | null };

export function ExerciseForm({
  action,
  exercise,
  movementName,
  movements,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  exercise?: Exercise;
  /** Vorbelegung, z. B. beim Anlegen eines weiteren Geräts für eine Bewegung. */
  movementName?: string;
  movements: MovementOption[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [movement, setMovement] = useState(movementName ?? "");
  const known = movements.find((m) => m.name === movement.trim());
  const [muscleGroup, setMuscleGroup] = useState(
    exercise?.muscleGroup ?? known?.muscleGroup ?? "",
  );

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="Name der Übung / Maschine">
          <Input
            name="name"
            required
            maxLength={80}
            defaultValue={exercise?.name}
            placeholder="z. B. Seitheben Kabelturm"
          />
        </Field>

        <Field
          label="Bewegung"
          hint={
            known && known.name !== exercise?.name
              ? `Weiteres Gerät für „${known.name}“. Im Plan steht die Bewegung, das Gerät wählst du im Training – verglichen wird nur am selben Gerät.`
              : "Gleicher Name wie bei einer anderen Übung macht beide zu Geräten derselben Bewegung. Leer: die Übung ist ihre eigene Bewegung."
          }
        >
          <Input
            name="movementName"
            maxLength={80}
            list="movement-names"
            value={movement}
            onChange={(event) => {
              const next = event.target.value;
              setMovement(next);
              // Die Muskelgruppe gehört der Bewegung: wer eine bestehende
              // wählt, übernimmt deren Angabe.
              const match = movements.find((m) => m.name === next.trim());
              if (match) setMuscleGroup(match.muscleGroup ?? "");
            }}
            placeholder="z. B. Seitheben"
          />
          <datalist id="movement-names">
            {movements.map((m) => (
              <option key={m.name} value={m.name} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Muskelgruppe"
          hint={known ? "Gilt für alle Geräte dieser Bewegung." : undefined}
        >
          <Select
            name="muscleGroup"
            value={muscleGroup}
            onChange={(event) => setMuscleGroup(event.target.value)}
          >
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
