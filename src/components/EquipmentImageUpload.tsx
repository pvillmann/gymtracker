"use client";

import { useActionState, useMemo } from "react";

import { uploadEquipmentImageAction } from "@/actions/equipment";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage } from "@/components/ui";
import type { FormState } from "@/lib/result";

export function EquipmentImageUpload({ equipmentId }: { equipmentId: string }) {
  const action = useMemo(
    () => uploadEquipmentImageAction.bind(null, equipmentId),
    [equipmentId],
  );
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-3">
      {/* Ohne HEIC im accept wandelt iOS Kamerafotos beim Hochladen in JPEG um. */}
      <input
        type="file"
        name="photo"
        accept="image/jpeg,image/png,image/webp"
        required
        className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface-2 file:px-3 file:py-2 file:text-sm file:font-medium file:text-fg"
      />
      <ErrorMessage>{state.error}</ErrorMessage>
      <SubmitButton variant="secondary" className="w-full" pendingLabel="Wird hochgeladen …">
        Foto hochladen
      </SubmitButton>
    </form>
  );
}
