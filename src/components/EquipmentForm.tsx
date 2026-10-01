"use client";

import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Select, Textarea } from "@/components/ui";
import type { Equipment } from "@/db/schema";
import { EQUIPMENT_KINDS, LOAD_RATIOS } from "@/lib/constants";
import { formatKg } from "@/lib/format";
import type { FormState } from "@/lib/result";

export function EquipmentForm({
  action,
  equipment,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  equipment?: Equipment;
  submitLabel: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const factor = equipment?.loadFactor ?? 1;
  // Ein Faktor, der zu keiner der üblichen Übersetzungen passt (per MCP
  // angelegt), soll beim Speichern nicht stillschweigend auf 1:1 springen.
  const known = LOAD_RATIOS.some((r) => Math.abs(r.factor - factor) < 0.001);

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="Name">
          <Input
            name="name"
            required
            maxLength={80}
            defaultValue={equipment?.name}
            placeholder="z. B. Matrix Ultra Lateral Raise"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Hersteller">
            <Input
              name="manufacturer"
              maxLength={80}
              defaultValue={equipment?.manufacturer ?? ""}
              placeholder="Matrix"
            />
          </Field>
          <Field label="Modell">
            <Input
              name="model"
              maxLength={80}
              defaultValue={equipment?.model ?? ""}
              placeholder="Ultra"
            />
          </Field>
        </div>
        <Field label="Art">
          <Select name="kind" defaultValue={equipment?.kind ?? "stack"}>
            {EQUIPMENT_KINDS.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Übersetzung"
          hint="Steht oft am Kabelzug. Bei 2:1 kommt nur die Hälfte des gesteckten Gewichts an – das bewegte Gewicht in der Statistik wird entsprechend gerechnet."
        >
          <Select name="loadFactor" defaultValue={String(factor)}>
            {LOAD_RATIOS.map((ratio) => (
              <option key={ratio.label} value={String(ratio.factor)}>
                {ratio.label}
              </option>
            ))}
            {known ? null : (
              <option value={String(factor)}>Faktor {formatKg(factor)}</option>
            )}
          </Select>
        </Field>
        <Field
          label="Eigengewicht (kg)"
          hint="Was ohne aufgelegtes Gewicht schon bewegt wird, z. B. der Schlitten der Beinpresse. Meist unbekannt – dann 0 lassen."
        >
          <Input
            name="baseLoadKg"
            inputMode="decimal"
            defaultValue={formatKg(equipment?.baseLoadKg ?? 0)}
          />
        </Field>
        <Field label="Notiz">
          <Textarea
            name="notes"
            rows={2}
            maxLength={1000}
            defaultValue={equipment?.notes ?? ""}
            placeholder="Steht hinten links, Griffe tauschbar …"
          />
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
