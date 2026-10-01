"use client";

import { useActionState, useMemo } from "react";

import { createGymAction, deleteGymAction, renameGymAction } from "@/actions/gyms";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

function GymRow({ id, name }: { id: string; name: string }) {
  const rename = useMemo(() => renameGymAction.bind(null, id), [id]);
  const [state, formAction] = useActionState<FormState, FormData>(rename, {});

  return (
    <li className="space-y-2 py-3 first:pt-0 last:pb-0">
      <form action={formAction} className="flex gap-2">
        <Input name="name" defaultValue={name} maxLength={60} aria-label="Name des Studios" />
        <SubmitButton variant="secondary" size="sm" className="h-12 shrink-0">
          Umbenennen
        </SubmitButton>
      </form>
      <ErrorMessage>{state.error}</ErrorMessage>
      <form action={deleteGymAction.bind(null, id)}>
        <ConfirmSubmitButton
          size="sm"
          message={`Studio „${name}“ löschen? Trainings bleiben erhalten, verlieren aber den Bezug zum Studio; die Geräteeinstellungen dort gehen verloren.`}
        >
          Löschen
        </ConfirmSubmitButton>
      </form>
    </li>
  );
}

export function GymManager({ gyms }: { gyms: Array<{ id: string; name: string }> }) {
  const [state, formAction] = useActionState<FormState, FormData>(createGymAction, {});

  return (
    <div className="space-y-4">
      {gyms.length > 0 ? (
        <ul className="divide-y divide-line-soft">
          {gyms.map((gym) => (
            <GymRow key={gym.id} id={gym.id} name={gym.name} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">
          Noch kein Studio. Mit Studio wählt das Training das Gerät vor, das du
          dort zuletzt benutzt hast, und zeigt die Einstellungen von dort.
        </p>
      )}
      <form action={formAction} className="flex gap-2 border-t border-line-soft pt-4">
        <Input name="name" maxLength={60} placeholder="Neues Studio" aria-label="Neues Studio" />
        <SubmitButton size="sm" className="h-12 shrink-0">
          Anlegen
        </SubmitButton>
      </form>
      <ErrorMessage>{state.error}</ErrorMessage>
    </div>
  );
}
