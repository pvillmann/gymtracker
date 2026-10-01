"use client";

import { useActionState, useMemo } from "react";

import { createGymAction, renameGymAction } from "@/actions/gyms";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function CreateGymForm() {
  const [state, formAction] = useActionState<FormState, FormData>(createGymAction, {});
  return (
    <form action={formAction} className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" maxLength={60} required placeholder="z. B. FitX Innenstadt" aria-label="Neues Studio" />
        <SubmitButton size="sm" className="h-12 shrink-0" pendingLabel="…">
          Anlegen
        </SubmitButton>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}

export function RenameGymForm({ gymId, name }: { gymId: string; name: string }) {
  const action = useMemo(() => renameGymAction.bind(null, gymId), [gymId]);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} onReset={(e) => e.preventDefault()} className="space-y-2">
      <div className="flex gap-2">
        <Input name="name" defaultValue={name} maxLength={60} required aria-label="Name des Studios" />
        <SubmitButton variant="secondary" size="sm" className="h-12 shrink-0" pendingLabel="…">
          Umbenennen
        </SubmitButton>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
    </form>
  );
}
