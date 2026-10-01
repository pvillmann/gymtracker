"use client";

import { useFormStatus } from "react-dom";

import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui";

/**
 * Absende-Button, der sich während der laufenden Server-Action selbst sperrt –
 * verhindert Doppel-Submits bei wackeligem Handynetz im Gym.
 */
export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
  formAction,
  name,
  value,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
  /** Mehrere Absende-Buttons in einem Formular unterscheiden sich über name/value. */
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={formAction}
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}
