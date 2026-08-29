"use client";

import { useActionState } from "react";

import { changePasswordAction, updateProfileAction } from "@/actions/profile";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function ProfileForm({
  name,
  bodyweightKg,
}: {
  name: string;
  bodyweightKg: number;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    updateProfileAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name">
        <Input name="name" required maxLength={60} defaultValue={name} />
      </Field>
      <Field
        label="Körpergewicht (kg)"
        hint="Wird für das Volumen von Klimmzügen, Dips & Co. gebraucht."
      >
        <Input
          name="bodyweightKg"
          inputMode="decimal"
          required
          defaultValue={String(bodyweightKg).replace(".", ",")}
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton className="w-full">Speichern</SubmitButton>
    </form>
  );
}

export function PasswordForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    changePasswordAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Aktuelles Passwort">
        <Input
          type="password"
          name="currentPassword"
          autoComplete="current-password"
          required
        />
      </Field>
      <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
        <Input
          type="password"
          name="newPassword"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? (
        <p className="text-sm font-medium text-up">
          Passwort geändert. Andere Geräte wurden abgemeldet.
        </p>
      ) : null}
      <SubmitButton variant="secondary" className="w-full">
        Passwort ändern
      </SubmitButton>
    </form>
  );
}
