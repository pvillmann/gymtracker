"use client";

import { useActionState, useMemo } from "react";

import { uploadWithLinkAction } from "@/actions/photo-upload";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function PhotoLinkUpload({ token, equipmentName }: { token: string; equipmentName: string }) {
  const action = useMemo(() => uploadWithLinkAction.bind(null, token), [token]);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  if (state.ok) {
    return (
      <div className="rounded-card border border-up/40 bg-up/10 px-5 py-6 text-center">
        <p className="font-semibold text-up">Foto gespeichert.</p>
        <p className="mt-1 text-sm text-muted">
          Es hängt jetzt an „{equipmentName}“. Den Link brauchst du nicht mehr.
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      {/* Kein capture-Attribut: das Foto liegt meist schon in der Galerie.
          Ohne HEIC im accept wandelt iOS Kamerafotos in JPEG um. */}
      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        required
        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg"
      />
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton size="lg" className="w-full" pendingLabel="Wird hochgeladen …">
        Foto hochladen
      </SubmitButton>
      <p className="text-xs text-faint">
        Das Foto wird verkleinert, Standort und andere Metadaten werden entfernt. Es
        gehört zum gemeinsamen Katalog und ist für alle Nutzer dieser Instanz sichtbar –
        bitte nur eigene Fotos.
      </p>
    </form>
  );
}
