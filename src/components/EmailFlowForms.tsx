"use client";

import { useActionState, useMemo } from "react";

import {
  requestPasswordResetAction,
  resendVerificationAction,
  resetPasswordAction,
} from "@/actions/auth";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function ResendVerificationForm({ email }: { email: string }) {
  const [state, formAction] = useActionState<FormState, FormData>(
    resendVerificationAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <input type="hidden" name="email" value={email} />
      {state.ok ? (
        <p className="text-sm font-medium text-up">
          Falls das Konto existiert und noch nicht bestätigt ist, haben wir
          gerade eine neue Mail geschickt.
        </p>
      ) : null}
      <SubmitButton
        variant="secondary"
        className="w-full"
        pendingLabel="Wird gesendet …"
      >
        Bestätigungsmail erneut senden
      </SubmitButton>
    </form>
  );
}

export function RequestPasswordResetForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    requestPasswordResetAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="E-Mail">
        <Input
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="du@beispiel.de"
        />
      </Field>
      {state.ok ? (
        <p className="text-sm font-medium text-up">
          Falls ein Konto mit dieser Adresse existiert, haben wir einen Link
          zum Zurücksetzen geschickt.
        </p>
      ) : null}
      <SubmitButton size="lg" className="w-full" pendingLabel="Wird gesendet …">
        Link zum Zurücksetzen senden
      </SubmitButton>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const action = useMemo(() => resetPasswordAction.bind(null, token), [token]);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Neues Passwort" hint="Mindestens 8 Zeichen.">
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton size="lg" className="w-full" pendingLabel="Wird gespeichert …">
        Neues Passwort speichern
      </SubmitButton>
    </form>
  );
}
