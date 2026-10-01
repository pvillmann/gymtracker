"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Select, Textarea } from "@/components/ui";
import type { Exercise } from "@/db/schema";
import { MUSCLE_GROUPS, TRACKING_MODES } from "@/lib/constants";
import type { FormState } from "@/lib/result";

export type MovementOption = { name: string; muscleGroup: string | null };
export type EquipmentOption = { id: string; name: string };

/** Ein Vorschlag aus wger, wie ihn /api/wger/search liefert. */
type WgerSuggestion = {
  id: number;
  name: string;
  muscleGroup: string | null;
  licenseName: string | null;
  licenseAuthor: string | null;
};

export function ExerciseForm({
  action,
  exercise,
  movementName,
  movements,
  equipment,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  exercise?: Exercise;
  /** Vorbelegung, z. B. beim Anlegen eines weiteren Geräts für eine Bewegung. */
  movementName?: string;
  movements: MovementOption[];
  equipment: EquipmentOption[];
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [movement, setMovement] = useState(movementName ?? "");
  const known = movements.find((m) => m.name === movement.trim());
  const [muscleGroup, setMuscleGroup] = useState(
    exercise?.muscleGroup ?? known?.muscleGroup ?? "",
  );
  // Vorschläge aus wger – nur für Bewegungen, die es hier noch nicht gibt.
  const [wger, setWger] = useState<{
    loading: boolean;
    error?: string;
    results?: WgerSuggestion[];
  }>({ loading: false });
  const [wgerPick, setWgerPick] = useState<WgerSuggestion | null>(null);

  const searchWger = async () => {
    setWger({ loading: true });
    try {
      const response = await fetch(`/api/wger/search?q=${encodeURIComponent(movement.trim())}`);
      const body = (await response.json()) as { results?: WgerSuggestion[]; error?: string };
      setWger({ loading: false, results: body.results, error: body.error });
    } catch {
      setWger({ loading: false, error: "wger ist gerade nicht erreichbar." });
    }
  };

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
          <input type="hidden" name="wgerId" value={wgerPick && !known ? wgerPick.id : ""} />
          <datalist id="movement-names">
            {movements.map((m) => (
              <option key={m.name} value={m.name} />
            ))}
          </datalist>
        </Field>

        {!known && movement.trim().length >= 2 ? (
          <div className="-mt-2 space-y-2">
            {wgerPick ? (
              <p className="text-xs text-faint">
                Aus wger übernommen: „{wgerPick.name}“
                {wgerPick.licenseAuthor ? ` · ${wgerPick.licenseAuthor}` : ""}
                {wgerPick.licenseName ? ` · ${wgerPick.licenseName}` : ""}
                {movement.trim() !== wgerPick.name ? " · bearbeitet" : ""}
              </p>
            ) : (
              <button
                type="button"
                onClick={searchWger}
                disabled={wger.loading}
                className="text-sm font-medium text-accent disabled:opacity-60"
              >
                {wger.loading ? "Suche in wger …" : `„${movement.trim()}“ in wger suchen`}
              </button>
            )}
            {wger.error ? <p className="text-xs text-down">{wger.error}</p> : null}
            {!wgerPick && wger.results ? (
              wger.results.length === 0 ? (
                <p className="text-xs text-faint">Nichts gefunden.</p>
              ) : (
                <ul className="divide-y divide-line-soft rounded-xl border border-line">
                  {wger.results.map((result) => (
                    <li key={result.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setWgerPick(result);
                          setMovement(result.name);
                          if (result.muscleGroup) setMuscleGroup(result.muscleGroup);
                        }}
                        className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2"
                      >
                        <span className="font-medium">{result.name}</span>
                        {result.muscleGroup ? (
                          <span className="text-muted"> · {result.muscleGroup}</span>
                        ) : null}
                        <span className="block text-xs text-faint">
                          {[result.licenseAuthor, result.licenseName].filter(Boolean).join(" · ")}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )
            ) : null}
          </div>
        ) : null}

        <Field
          label="Muskelgruppe"
          hint={
            known
              ? "Gehört zur Bewegung und gilt für alle ihre Geräte – bei allen Nutzern dieser Instanz."
              : undefined
          }
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

        <Field
          label="Gerät"
          hint="Die Maschine, an der die Übung läuft – mit Foto, Übersetzung und Eigengewicht. Anlegen unter Übungen → Geräte."
        >
          <Select name="equipmentId" defaultValue={exercise?.equipmentId ?? ""}>
            <option value="">– kein Gerät –</option>
            {equipment.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
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
