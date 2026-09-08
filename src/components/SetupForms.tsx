"use client";

import { useActionState } from "react";

import { createAdminAccountAction, promoteExistingAccountAction } from "@/actions/setup";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Field, Input, Select } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function PromoteAccountForm({
  accounts,
}: {
  accounts: Array<{ id: string; name: string; email: string }>;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(
    promoteExistingAccountAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Konto">
        <Select name="userId" required defaultValue={accounts[0]?.id}>
          {accounts.map((account) => (
            <option key={account.id} value={account.id}>
              {account.name} · {account.email}
            </option>
          ))}
        </Select>
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton className="w-full" pendingLabel="Wird übernommen …">
        Dieses Konto zum Administrator machen
      </SubmitButton>
    </form>
  );
}

export function CreateAdminForm() {
  const [state, formAction] = useActionState<FormState, FormData>(
    createAdminAccountAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Name">
        <Input name="name" required maxLength={60} placeholder="Pascal" />
      </Field>
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
      <Field label="Passwort" hint="Mindestens 8 Zeichen.">
        <Input
          type="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
        />
      </Field>
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton size="lg" className="w-full" pendingLabel="Wird angelegt …">
        Konto anlegen und Einrichtung abschließen
      </SubmitButton>
    </form>
  );
}
