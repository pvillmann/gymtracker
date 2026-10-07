"use client";

import { useActionState, useMemo, useState } from "react";

import { mergeMovementAction } from "@/actions/movements";
import { SubmitButton } from "@/components/SubmitButton";
import { ErrorMessage, Select } from "@/components/ui";
import type { FormState } from "@/lib/result";

/**
 * Dublette auflösen: diese Übung geht in einer anderen auf. Nicht umkehrbar,
 * deshalb mit Rückfrage vor dem Absenden.
 */
export function MergeMovementForm({
  sourceId,
  sourceName,
  targets,
}: {
  sourceId: string;
  sourceName: string;
  targets: Array<{ id: string; name: string }>;
}) {
  const action = useMemo(() => mergeMovementAction.bind(null, sourceId), [sourceId]);
  const [state, formAction] = useActionState<FormState, FormData>(action, {});
  const [targetId, setTargetId] = useState("");
  const target = targets.find((t) => t.id === targetId);

  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        const ok = window.confirm(
          `„${sourceName}“ in „${target?.name}“ zusammenführen? Verlauf, Pläne und Maschinen wandern dorthin, „${sourceName}“ wird gelöscht – für alle Nutzer, nicht umkehrbar.`,
        );
        if (!ok) event.preventDefault();
      }}
      className="space-y-2"
    >
      <div className="flex items-center gap-2">
        <Select
          name="targetId"
          aria-label="Übung, die bleibt"
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          required
          className="h-9 py-0 text-sm"
        >
          <option value="" disabled>
            Bleibt: Übung wählen …
          </option>
          {targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingLabel="…" className="shrink-0">
          Zusammenführen
        </SubmitButton>
      </div>
      <ErrorMessage>{state.error}</ErrorMessage>
    </form>
  );
}
