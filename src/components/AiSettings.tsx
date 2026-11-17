"use client";

import { useActionState } from "react";

import {
  deleteAnthropicKeyAction,
  saveAnthropicKeyAction,
  toggleAiSuggestionsAction,
} from "@/actions/profile";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

/** Eigener Anthropic-Schlüssel und Schalter für die KI-Vorschläge. */
export function AiSettings({ hint, enabled }: { hint: string | null; enabled: boolean }) {
  const [state, formAction] = useActionState<FormState, FormData>(saveAnthropicKeyAction, {});

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        Mit eigenem API-Schlüssel verfeinert Claude Haiku den Progressionsvorschlag im Training –
        etwa ein Deload nach Stillstand. Ohne Schlüssel gilt die feste Regel.
      </p>

      {hint ? (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5 text-sm">
          <span>
            Schlüssel hinterlegt <span className="text-faint tnum">{hint}</span>
          </span>
          <form action={toggleAiSuggestionsAction.bind(null, !enabled)}>
            <SubmitButton size="sm" variant={enabled ? "secondary" : "primary"} pendingLabel="…">
              {enabled ? "Ausschalten" : "Einschalten"}
            </SubmitButton>
          </form>
        </div>
      ) : null}

      <form action={formAction} className="space-y-3">
        <Field
          label={hint ? "Neuer Schlüssel" : "Anthropic-API-Schlüssel"}
          hint="Wird bei Anthropic geprüft und nur verschlüsselt gespeichert. Kosten trägt dein Konto."
        >
          <Input
            type="password"
            name="anthropicKey"
            autoComplete="off"
            spellCheck={false}
            placeholder="sk-ant-…"
            required
          />
        </Field>
        <ErrorMessage>{state.error}</ErrorMessage>
        {state.ok ? <p className="text-sm font-medium text-up">Schlüssel gespeichert, Vorschläge an.</p> : null}
        <SubmitButton className="w-full" pendingLabel="Wird geprüft …">
          Schlüssel speichern
        </SubmitButton>
      </form>

      {hint ? (
        <form action={deleteAnthropicKeyAction}>
          <SubmitButton size="sm" variant="ghost" className="w-full" pendingLabel="…">
            Schlüssel löschen
          </SubmitButton>
        </form>
      ) : null}

      <p className="text-xs text-faint">
        Eingeschaltet gehen pro Übung Name, Zielbereich, Plannotiz und die letzten drei Trainings
        daran an die Anthropic-API – keine Namen, E-Mail oder andere Übungen.
      </p>
    </div>
  );
}
