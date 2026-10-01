"use client";

import { useActionState, type ReactNode } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import type { ButtonVariant } from "@/components/ui";
import type { FormState } from "@/lib/result";

/**
 * Kleines Formular für eine einzelne Zuordnung (hinzufügen, entfernen,
 * umschalten): feste Felder versteckt, optional ein Auswahlfeld davor,
 * Fehlermeldung darunter.
 */
export function InlineActionForm({
  action,
  fields,
  label,
  pendingLabel,
  variant = "secondary",
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  fields: Record<string, string>;
  label: string;
  pendingLabel?: string;
  variant?: ButtonVariant;
  /** Zusätzliche Eingaben vor dem Button, z. B. ein Select. */
  children?: ReactNode;
  className?: string;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className={className}>
      {Object.entries(fields).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      <div className="flex items-center gap-2">
        {children}
        <SubmitButton size="sm" variant={variant} pendingLabel={pendingLabel} className="shrink-0">
          {label}
        </SubmitButton>
      </div>
      {state.error ? <p className="mt-1 text-xs text-down">{state.error}</p> : null}
    </form>
  );
}
