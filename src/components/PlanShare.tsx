"use client";

import { useActionState, useState, useSyncExternalStore } from "react";

import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage } from "@/components/ui";
import type { FormState } from "@/lib/result";

const noSubscribe = () => () => {};

/** Teilen-Link mit Kopier-Schaltfläche; ohne APP_URL ergänzt der Browser die Adresse. */
export function ShareLink({ url }: { url: string }) {
  const [copied, setCopied] = useState(false);
  // Adresse und Teilen-Menü kennt erst der Browser; auf dem Server bleibt es
  // beim relativen Link und ohne Teilen-Knopf – ohne Hydration-Fehler.
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => "");
  const canShare = useSyncExternalStore(noSubscribe, () => "share" in navigator, () => false);
  const full = url.startsWith("/") ? origin + url : url;

  return (
    <div>
      <code className="block overflow-x-auto rounded-lg bg-surface-2 px-3 py-2 font-mono text-xs break-all text-fg">
        {full}
      </code>
      <div className="mt-2 flex gap-4 text-sm font-semibold text-accent">
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(full).then(
              () => setCopied(true),
              () => setCopied(false),
            );
          }}
        >
          {copied ? "Kopiert ✓" : "Link kopieren"}
        </button>
        {canShare ? (
          <button
            type="button"
            onClick={() => {
              void navigator.share({ url: full }).catch(() => undefined);
            }}
          >
            Teilen …
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** „In meine Pläne übernehmen“ auf der öffentlichen Seite eines Plans. */
export function ImportSharedPlanForm({
  action,
  loggedIn,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  loggedIn: boolean;
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  return (
    <form action={formAction} className="space-y-2">
      <SubmitButton size="lg" className="w-full" pendingLabel="Wird übernommen …">
        {loggedIn ? "In meine Pläne übernehmen" : "Anmelden und übernehmen"}
      </SubmitButton>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
