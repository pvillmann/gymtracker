import type { TrackingMode } from "@/db/schema";
import { formatDuration, formatKg } from "@/lib/format";

export type SetLike = {
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  isWarmup: boolean;
};

/** Ein einzelner Satz als Text: "40 kg × 12" bzw. "1:30". */
export function describeSet(set: SetLike, mode: TrackingMode): string {
  if (mode === "time") {
    return formatDuration(set.durationSeconds ?? 0);
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
    case "time":
      return "Zeit";
    default:
      return "Gewicht";
  }
}
