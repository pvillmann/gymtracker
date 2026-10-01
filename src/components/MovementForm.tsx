"use client";

import { useActionState, useState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Select } from "@/components/ui";
import type { Movement } from "@/db/schema";
import { MUSCLE_GROUPS, TRACKING_MODES } from "@/lib/constants";
import type { FormState } from "@/lib/result";

/** Ein Vorschlag aus wger, wie ihn /api/wger/search liefert. */
type WgerSuggestion = {
  id: number;
  name: string;
  muscleGroup: string | null;
  licenseName: string | null;
  licenseAuthor: string | null;
};

/**
 * Eine Übung im gemeinsamen Katalog: Name, Muskelgruppe, Messart. Maschinen
 * werden danach auf ihrer Seite zugeordnet. Beim Anlegen lässt sich der
 * Eintrag aus wger übernehmen – Quelle und Lizenz holt der Server selbst.
 */
export function MovementForm({
  action,
  movement,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  movement?: Movement;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [name, setName] = useState(movement?.name ?? "");
  const [muscleGroup, setMuscleGroup] = useState(movement?.muscleGroup ?? "");
  const [wger, setWger] = useState<{
    loading: boolean;
    error?: string;
    results?: WgerSuggestion[];
  }>({ loading: false });
  const [wgerPick, setWgerPick] = useState<WgerSuggestion | null>(null);

  const searchWger = async () => {
    setWger({ loading: true });
    try {
      const response = await fetch(`/api/wger/search?q=${encodeURIComponent(name.trim())}`);
      const body = (await response.json()) as { results?: WgerSuggestion[]; error?: string };
      setWger({ loading: false, results: body.results, error: body.error });
    } catch {
      setWger({ loading: false, error: "wger ist gerade nicht erreichbar." });
    }
  };

  return (
    <Card>
      <form action={formAction} onReset={(e) => e.preventDefault()} className="space-y-4">
        <Field
          label="Name der Übung"
          hint="Die Bewegung, nicht die Maschine – z. B. „Seitheben“. Maschinen ordnest du danach zu."
        >
          <Input
            name="name"
            required
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="z. B. Seitheben"
          />
        </Field>
        <input type="hidden" name="wgerId" value={wgerPick ? wgerPick.id : ""} />

        {!movement && name.trim().length >= 2 ? (
          <div className="-mt-2 space-y-2">
            {wgerPick ? (
              <p className="text-xs text-faint">
                Aus wger übernommen: „{wgerPick.name}“
                {wgerPick.licenseAuthor ? ` · ${wgerPick.licenseAuthor}` : ""}
                {wgerPick.licenseName ? ` · ${wgerPick.licenseName}` : ""}
                {name.trim() !== wgerPick.name ? " · bearbeitet" : ""}{" "}
                <button
                  type="button"
                  onClick={() => setWgerPick(null)}
                  className="font-medium text-accent"
                >
                  verwerfen
                </button>
              </p>
            ) : (
              <button
                type="button"
                onClick={searchWger}
                disabled={wger.loading}
                className="text-sm font-medium text-accent disabled:opacity-60"
              >
                {wger.loading ? "Suche in wger …" : `„${name.trim()}“ in wger suchen`}
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
                          setName(result.name);
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
          hint={movement ? "Gilt für alle Maschinen der Übung – bei allen Nutzern dieser Instanz." : undefined}
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
          <Select name="trackingMode" defaultValue={movement?.trackingMode ?? "weight_reps"}>
            {TRACKING_MODES.map((mode) => (
              <option key={mode.value} value={mode.value}>
                {mode.label}
              </option>
            ))}
          </Select>
        </Field>

        <ErrorMessage>{state.error}</ErrorMessage>
        {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}

        <SubmitButton size="lg" className="w-full" pendingLabel="Speichern …">
          {submitLabel}
        </SubmitButton>
      </form>
    </Card>
  );
}
