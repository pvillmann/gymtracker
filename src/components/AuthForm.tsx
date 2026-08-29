"use client";

import Link from "next/link";
import { useActionState } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { Card, ErrorMessage, Field, Input } from "@/components/ui";
import type { FormState } from "@/lib/result";

type Action = (prev: FormState, formData: FormData) => Promise<FormState>;

export function AuthForm({
  mode,
  action,
  requiresCode = false,
}: {
  mode: "login" | "register";
  action: Action;
  requiresCode?: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const isRegister = mode === "register";

  return (
    <Card className="p-5">
      <form action={formAction} className="space-y-4">
        {isRegister ? (
          <Field label="Name">
            <Input name="name" autoComplete="name" required placeholder="Pascal" />
          </Field>
        ) : null}

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

        <Field
          label="Passwort"
          hint={isRegister ? "Mindestens 8 Zeichen." : undefined}
        >
          <Input
            type="password"
            name="password"
            autoComplete={isRegister ? "new-password" : "current-password"}
            required
            minLength={isRegister ? 8 : undefined}
          />
        </Field>

        {isRegister && requiresCode ? (
          <Field
            label="Registrierungscode"
            hint="Auf diesem Server ist die Registrierung durch einen Code geschützt."
          >
            <Input name="code" required />
          </Field>
        ) : null}

        <ErrorMessage>{state.error}</ErrorMessage>

        <SubmitButton
          size="lg"
          className="w-full"
          pendingLabel={isRegister ? "Konto wird angelegt …" : "Anmelden …"}
        >
          {isRegister ? "Konto anlegen" : "Anmelden"}
        </SubmitButton>
      </form>

      <p className="mt-5 text-center text-sm text-muted">
        {isRegister ? "Schon ein Konto? " : "Noch kein Konto? "}
        <Link
          href={isRegister ? "/login" : "/register"}
          className="font-semibold text-accent underline-offset-4 hover:underline"
        >
          {isRegister ? "Anmelden" : "Registrieren"}
        </Link>
      </p>
    </Card>
  );
}
