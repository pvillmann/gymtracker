import type { SetEffort, TrackingMode } from "@/db/schema";
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

/**
 * Die drei Stufen der Selbsteinschätzung. Der Hinweis in Wiederholungen ist
 * nur ein Anker, damit "ok" an einem müden Tag dasselbe heißt wie an einem
 * guten – gespeichert wird die Stufe, keine Zahl.
 */
export const EFFORTS: ReadonlyArray<{ value: SetEffort; label: string; hint: string }> = [
  { value: "max", label: "Am Limit", hint: "0–1 Wdh. übrig" },
  { value: "ok", label: "Ok", hint: "2–3 Wdh. übrig" },
  { value: "easy", label: "Leicht", hint: "4+ Wdh. übrig" },
];

export function effortLabel(effort: SetEffort): string {
  return EFFORTS.find((e) => e.value === effort)?.label ?? effort;
}

/**
 * Die Einschätzung eines Trainings an einer Übung: die des letzten
 * bewerteten Arbeitssatzes. Wer nach der Bewertung noch einen Satz
 * nachschiebt und den nicht bewertet, verliert sie so nicht.
 */
export function lastEffort(
  sets: ReadonlyArray<{ isWarmup: boolean; effort: SetEffort | null }>,
): SetEffort | null {
  return setsOfKind(sets, false).findLast((s) => s.effort !== null)?.effort ?? null;
}

/**
 * Wie das Gewicht an einer Maschine gemeint ist: je Seite (getrennte Arme)
 * oder als Stufe statt kg. null/undefined: normales Gewicht in kg.
 */
export type LoadUnit = { perSide?: boolean; level?: boolean } | null | undefined;

/** Die Einheit einer Maschine aus ihren Feldern; ohne Maschine normales kg. */
export function loadUnitOf(
  device: { perSide: boolean; loadUnit: string } | null | undefined,
): LoadUnit {
  return device ? { perSide: device.perSide, level: device.loadUnit === "level" } : null;
}

/** Das Gewicht als Text: "40 kg", "40 kg/Seite" oder "Stufe 8". */
export function describeWeight(weightKg: number, unit?: LoadUnit): string {
  if (unit?.level) return `Stufe ${formatKg(weightKg)}`;
  return `${formatKg(weightKg)} kg${unit?.perSide ? "/Seite" : ""}`;
}

/** Ein einzelner Satz als Text: "40 kg × 12" bzw. "1:30". */
export function describeSet(set: SetLike, mode: TrackingMode, unit?: LoadUnit): string {
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
  return `${describeWeight(set.weightKg, unit)} × ${set.reps}`;
}

/**
 * Sätze kompakt zusammenfassen: gleiche Sätze werden zusammengefasst,
 * "40 kg × 12, 40 kg × 12, 35 kg × 10" wird zu "2× 40 kg × 12, 35 kg × 10".
 */
export function describeSets(sets: SetLike[], mode: TrackingMode, unit?: LoadUnit): string {
  const working = sets.filter((s) => !s.isWarmup);
  const relevant = working.length > 0 ? working : sets;
  if (relevant.length === 0) return "–";

  const groups: Array<{ label: string; count: number }> = [];
  for (const set of relevant) {
    const label = describeSet(set, mode, unit);
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
