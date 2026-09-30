import type { TrackingMode } from "@/db/schema";
import { formatDuration, formatKg } from "@/lib/format";

export type SetLike = {
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  isWarmup: boolean;
};

/**
 * Aufwärm- und Arbeitssätze werden getrennt gezählt: "A1, A2, 1, 2, 3".
 * set_number in der Datenbank bleibt die Reihenfolge über beide hinweg –
 * zählen und vergleichen darf man damit aber nicht, sonst ist nach einem
 * Aufwärmsatz der erste Arbeitssatz "Satz 2" und wird mit dem zweiten Satz
 * vom letzten Mal verglichen.
 */
export function setsOfKind<T extends { isWarmup: boolean }>(
  sets: readonly T[],
  isWarmup: boolean,
): T[] {
  return sets.filter((s) => s.isWarmup === isWarmup);
}

/** 1-basierte Nummer eines Satzes unter den Sätzen seiner Art. */
export function ordinalOfKind<T extends { isWarmup: boolean }>(
  sets: readonly T[],
  set: T,
): number {
  return setsOfKind(sets, set.isWarmup).indexOf(set) + 1;
}

/** Der n-te Satz derselben Art – das Gegenstück für den Vergleich. */
export function nthOfKind<T extends { isWarmup: boolean }>(
  sets: readonly T[],
  isWarmup: boolean,
  ordinal: number,
): T | undefined {
  return setsOfKind(sets, isWarmup)[ordinal - 1];
}

/** Anzeige-Nummer: "A1" für Aufwärmsätze, "1" für Arbeitssätze. */
export function setLabel(isWarmup: boolean, ordinal: number): string {
  return isWarmup ? `A${ordinal}` : String(ordinal);
}

/** Ein einzelner Satz als Text: "40 kg × 12" bzw. "1:30". */
export function describeSet(set: SetLike, mode: TrackingMode): string {
  if (mode === "time") {
    return formatDuration(set.durationSeconds ?? 0);
  }
  if (mode === "assisted_reps") {
    // Das Minus macht sofort klar, dass hier Last abgenommen wird.
    return set.weightKg > 0
      ? `−${formatKg(set.weightKg)} kg × ${set.reps}`
      : `${set.reps} Wdh.`;
  }
  if (mode === "bodyweight_reps") {
    return set.weightKg > 0
      ? `+${formatKg(set.weightKg)} kg × ${set.reps}`
      : `${set.reps} Wdh.`;
  }
  return `${formatKg(set.weightKg)} kg × ${set.reps}`;
}

/**
 * Sätze kompakt zusammenfassen: gleiche Sätze werden zusammengefasst,
 * "40 kg × 12, 40 kg × 12, 35 kg × 10" wird zu "2× 40 kg × 12, 35 kg × 10".
 */
export function describeSets(sets: SetLike[], mode: TrackingMode): string {
  const working = sets.filter((s) => !s.isWarmup);
  const relevant = working.length > 0 ? working : sets;
  if (relevant.length === 0) return "–";

  const groups: Array<{ label: string; count: number }> = [];
  for (const set of relevant) {
    const label = describeSet(set, mode);
    const last = groups.at(-1);
    if (last && last.label === label) last.count += 1;
    else groups.push({ label, count: 1 });
  }

  return groups
    .map((group) => (group.count > 1 ? `${group.count}× ${group.label}` : group.label))
    .join(", ");
}

export function trackingModeLabel(mode: TrackingMode): string {
  switch (mode) {
    case "bodyweight_reps":
      return "Körpergewicht";
    case "assisted_reps":
      return "Gegengewicht";
    case "time":
      return "Zeit";
    default:
      return "Gewicht";
  }
}
