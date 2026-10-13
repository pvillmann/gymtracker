"use client";

import { useActionState } from "react";

import {
  changePasswordAction,
  deleteAccountAction,
  updateAppearanceAction,
  updateProfileAction,
} from "@/actions/profile";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import { ACCENTS, GLASS_LEVELS, type AccentName, type GlassLevel } from "@/lib/appearance";
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

export function DeleteAccountForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    deleteAccountAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Passwort zur Bestätigung">
        <Input
          type="password"
          name="password"
          autoComplete="current-password"
          required
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      <ConfirmSubmitButton
        variant="danger"
        className="w-full"
        message="Konto wirklich unwiderruflich löschen? Alle Trainingspläne, Übungen und Trainings gehen dabei verloren – das lässt sich nicht rückgängig machen."
      >
        Konto endgültig löschen
      </ConfirmSubmitButton>
    </form>
  );
}

/**
 * Akzentfarbe und Glasstärke. Gewählt wird per Radio – die Auswahl wirkt
 * nach dem Speichern auf allen Seiten.
 */
export function AppearanceForm({ accent, glass }: { accent: AccentName; glass: GlassLevel }) {
  const [state, formAction] = useActionState<FormState, FormData>(updateAppearanceAction, {});

  return (
    <form action={formAction} className="space-y-5">
      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">Akzentfarbe</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(ACCENTS) as Array<[AccentName, (typeof ACCENTS)[AccentName]]>).map(
            ([key, option]) => (
              <label
                key={key}
                className="flex cursor-pointer items-center gap-2 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm has-[:checked]:border-fg has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-fg"
              >
                <input type="radio" name="accentColor" value={key} defaultChecked={key === accent} className="sr-only" />
                <span
                  aria-hidden="true"
                  className="h-4 w-4 shrink-0 rounded-full"
                  style={{ background: option.color }}
                />
                {option.label}
              </label>
            ),
          )}
        </div>
      </fieldset>

      <fieldset>
        <legend className="mb-2 text-sm font-medium text-muted">Kopfleiste und Navigation</legend>
        <div className="grid grid-cols-3 gap-2">
          {(Object.entries(GLASS_LEVELS) as Array<[GlassLevel, string]>).map(([key, label]) => (
            <label
              key={key}
              className="flex cursor-pointer items-center justify-center rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm has-[:checked]:border-accent has-[:checked]:text-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent"
            >
              <input type="radio" name="glass" value={key} defaultChecked={key === glass} className="sr-only" />
              {label}
            </label>
          ))}
        </div>
        <p className="mt-2 text-xs text-faint">
          „Gedämpft“ und „Klar“ lassen den Inhalt beim Scrollen durchscheinen. Ist auf dem Gerät
          „Transparenz reduzieren“ an, bleibt es deckend.
        </p>
      </fieldset>

      <ErrorMessage>{state.error}</ErrorMessage>
      {state.ok ? <p className="text-sm font-medium text-up">Gespeichert.</p> : null}
      <SubmitButton className="w-full">Speichern</SubmitButton>
    </form>
  );
}
