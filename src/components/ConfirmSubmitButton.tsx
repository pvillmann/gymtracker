"use client";

import { useFormStatus } from "react-dom";

import { buttonClass, type ButtonSize, type ButtonVariant } from "./ui";

/** Absende-Button mit Rückfrage – für Aktionen, die Daten wegwerfen. */
export function ConfirmSubmitButton({
  children,
  message,
  variant = "danger",
  size = "md",
  className,
}: {
  children: React.ReactNode;
  message: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
      className={buttonClass(variant, size, className)}
    >
      {children}
    </button>
  );
}
