"use client";

import { useActionState, useMemo } from "react";

import { updateVariantAction } from "@/actions/exercises";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input, Textarea } from "@/components/ui";
import type { FormState } from "@/lib/result";

/**
 * Was an der eigenen Variante privat ist: der Name und die Einstellung an
 * der Maschine. Alles andere gehört zur Übung bzw. zur Maschine.
 */
export function VariantForm({
  exerciseId,
  name,
  machineSetup,
}: {
  exerciseId: string;
  name: string;
  machineSetup: string | null;
}) {
  const action = useMemo(() => updateVariantAction.bind(null, exerciseId), [exerciseId]);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <Card>
      <form action={formAction} onReset={(e) => e.preventDefault()} className="space-y-4">
        <Field label="Name">
          <Input name="name" required maxLength={80} defaultValue={name} />
        </Field>
        <Field
          label="Einstellungen an der Maschine"
          hint="Sitzhöhe, Lehne, Griffposition – damit du es beim nächsten Mal sofort weißt. Pro Studio abweichend: oben unter „Pro Studio“."
        >
          <Textarea
            name="machineSetup"
            rows={3}
            maxLength={500}
            defaultValue={machineSetup ?? ""}
            placeholder="Sitz 4, Lehne 2, enger Griff"
          />
        </Field>
        <ErrorMessage>{state.error}</ErrorMessage>
        {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
        <SubmitButton className="w-full" pendingLabel="Speichern …">
          Speichern
        </SubmitButton>
      </form>
    </Card>
  );
}
