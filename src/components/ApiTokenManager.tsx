"use client";

import { useActionState, useState } from "react";

import { createApiTokenAction, revokeApiTokenAction, type TokenFormState } from "@/actions/api-tokens";
import { ConfirmSubmitButton } from "@/components/ConfirmSubmitButton";
import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input } from "@/components/ui";
import { formatDate } from "@/lib/format";

type Token = {
  id: string;
  name: string;
  preview: string;
  lastUsedAt: number | null;
  createdAt: number;
};

function NewTokenNotice({ token }: { token: string }) {
  const [copied, setCopied] = useState(false);

  return (
    <Card className="mt-4 border-accent/40 bg-accent/8">
      <p className="text-sm font-semibold text-accent">
        Schlüssel erzeugt – jetzt kopieren
      </p>
      <p className="mt-1 text-sm text-muted">
        Er wird nur dieses eine Mal angezeigt. Danach liegt in der Datenbank nur
        noch sein Hash.
      </p>
      <code className="mt-3 block overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs break-all text-fg">
        {token}
      </code>
      <button
        type="button"
        className="mt-3 text-sm font-semibold text-accent"
        onClick={() => {
          void navigator.clipboard?.writeText(token).then(
            () => setCopied(true),
            () => setCopied(false),
          );
        }}
      >
        {copied ? "Kopiert ✓" : "In die Zwischenablage"}
      </button>
    </Card>
  );
}

export function ApiTokenManager({ tokens }: { tokens: Token[] }) {
  const [state, formAction] = useActionState<TokenFormState, FormData>(
    createApiTokenAction,
    {},
  );

  return (
    <>
      {tokens.length > 0 ? (
        <ul className="mb-4 space-y-2">
          {tokens.map((token) => (
            <li
              key={token.id}
              className="flex items-center gap-3 rounded-xl bg-surface-2 px-3 py-2"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{token.name}</p>
                <p className="mt-0.5 truncate font-mono text-xs text-faint">
                  {token.preview}
                </p>
                <p className="mt-0.5 text-xs text-faint tnum">
                  seit {formatDate(token.createdAt)} ·{" "}
                  {token.lastUsedAt
                    ? `zuletzt genutzt ${formatDate(token.lastUsedAt)}`
                    : "noch nie genutzt"}
                </p>
              </div>
              <form action={revokeApiTokenAction.bind(null, token.id)}>
                <ConfirmSubmitButton
                  size="sm"
                  variant="secondary"
                  message={`Schlüssel „${token.name}“ widerrufen? Verbindungen, die ihn nutzen, funktionieren sofort nicht mehr.`}
                >
                  Widerrufen
                </ConfirmSubmitButton>
              </form>
            </li>
          ))}
        </ul>
      ) : null}

      <form action={formAction} className="space-y-3">
        <Field label="Neuer Schlüssel" hint="Bezeichnung, z. B. „Handy“ oder „Laptop“.">
          <Input name="name" required maxLength={60} placeholder="Handy" />
        </Field>
        <ErrorMessage>{state.error}</ErrorMessage>
        <SubmitButton variant="secondary" className="w-full" pendingLabel="Wird erzeugt …">
          Schlüssel erzeugen
        </SubmitButton>
      </form>

      {state.token ? <NewTokenNotice token={state.token} /> : null}
    </>
  );
}
