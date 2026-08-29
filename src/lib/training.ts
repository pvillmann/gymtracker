import type { TrackingMode } from "@/db/schema";

/**
 * Bewegtes Gewicht eines Satzes. Bei Körpergewichts-Übungen zählt das
 * Körpergewicht mit, sonst wären Klimmzüge im Volumen immer 0.
 * Zeit-Übungen tragen kein Volumen bei.
 */
export function setVolume(
  mode: TrackingMode,
  weightKg: number,
  reps: number,
  bodyweightKg: number,
): number {
  if (mode === "time") return 0;
  return Math.max(0, effectiveLoad(mode, weightKg, bodyweightKg) * reps);
}

/**
 * Tatsächlich bewegte Last eines Satzes. Bei Körpergewichts-Übungen ist das
 * Zusatzgewicht allein aussagelos – ohne das Körpergewicht wäre ein Klimmzug
 * mit 0 kg Zusatz rechnerisch nichts wert.
 */
export function effectiveLoad(
  mode: TrackingMode,
  weightKg: number,
  bodyweightKg: number,
): number {
  return mode === "bodyweight_reps" ? bodyweightKg + weightKg : weightKg;
}

/**
 * Geschätztes 1-Wiederholungs-Maximum nach Epley. Macht Sätze mit
 * unterschiedlichen Wiederholungszahlen überhaupt erst vergleichbar:
 * 60 kg × 8 ist mehr Leistung als 70 kg × 3.
 */
export function estimateOneRepMax(weightKg: number, reps: number): number {
  if (weightKg <= 0 || reps <= 0) return 0;
  if (reps === 1) return weightKg;
  return weightKg * (1 + reps / 30);
}

export type Trend = "up" | "down" | "flat" | "new";

/** Vergleicht zwei Werte mit Toleranz, damit Rundungsrauschen nicht als Fortschritt zählt. */
export function trendOf(
  current: number,
  previous: number | null | undefined,
  tolerance = 0.01,
): Trend {
  if (previous === null || previous === undefined) return "new";
  const diff = current - previous;
  if (Math.abs(diff) <= Math.max(tolerance, Math.abs(previous) * tolerance)) {
    return "flat";
  }
  return diff > 0 ? "up" : "down";
}

export function percentChange(
  current: number,
  previous: number | null | undefined,
): number | null {
  if (!previous || previous <= 0) return null;
  return ((current - previous) / previous) * 100;
}

export type SetComparison = { trend: Trend; label: string };

type ComparableSet = {
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
};

/**
 * Vergleicht einen Satz mit dem gleichnummerierten Satz des letzten Trainings.
 * Die Richtung kommt aus dem geschätzten 1RM, der Text nennt die Größe, die
 * sich tatsächlich verändert hat – das liest sich unterwegs schneller.
 */
export function compareSets(
  current: ComparableSet,
  previous: ComparableSet | null | undefined,
  mode: TrackingMode,
): SetComparison {
  if (!previous) return { trend: "new", label: "neu" };

  if (mode === "time") {
    const now = current.durationSeconds ?? 0;
    const before = previous.durationSeconds ?? 0;
    const diff = now - before;
    if (diff === 0) return { trend: "flat", label: "gleich" };
    return {
      trend: diff > 0 ? "up" : "down",
      label: `${diff > 0 ? "+" : "−"}${Math.abs(diff)} s`,
    };
  }

  const weightDiff = current.weightKg - previous.weightKg;
  const repsDiff = current.reps - previous.reps;
  const trend = trendOf(
    estimateOneRepMax(current.weightKg, current.reps),
    estimateOneRepMax(previous.weightKg, previous.reps),
  );

  if (Math.abs(weightDiff) >= 0.05) {
    const rounded = Math.round(Math.abs(weightDiff) * 10) / 10;
    const value = rounded.toLocaleString("de-DE", { maximumFractionDigits: 1 });
    return { trend, label: `${weightDiff > 0 ? "+" : "−"}${value} kg` };
  }

  if (repsDiff !== 0) {
    return {
      trend,
      label: `${repsDiff > 0 ? "+" : "−"}${Math.abs(repsDiff)} Wdh.`,
    };
  }

  return { trend: "flat", label: "gleich" };
}
