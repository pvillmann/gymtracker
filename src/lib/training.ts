import type { TrackingMode } from "@/db/schema";

/**
 * Wie ein Gerät die eingestellte Last weitergibt: Übersetzung (0.5 bei einem
 * 2:1-Kabelzug) und Eigengewicht (Schlitten der Beinpresse).
 */
export type LoadTransfer = {
  loadFactor: number;
  baseLoadKg: number;
  /** Getrennte Arme: das eingetragene Gewicht gilt je Seite, bewegt wird das Doppelte. */
  perSide?: boolean;
  /** Stufen statt kg: kein bewegtes Gewicht, nur Vergleich am selben Gerät. */
  level?: boolean;
};

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
  transfer?: LoadTransfer | null,
): number {
  if (mode === "time") return 0;
  // Eine Stufe ist keine Masse – sie zählt nicht in die Tonnage.
  if (mode === "weight_reps" && transfer?.level) return 0;
  // Übersetzung und Eigengewicht gelten nur für Gewicht × Wiederholungen –
  // bei Körpergewichts-Übungen ist die Last der Körper, nicht das Gerät.
  const load =
    mode === "weight_reps" && transfer
      ? transfer.baseLoadKg + weightKg * transfer.loadFactor * (transfer.perSide ? 2 : 1)
      : effectiveLoad(mode, weightKg, bodyweightKg);
  return Math.max(0, load * reps);
}

/**
 * Tatsächlich bewegte Last eines Satzes.
 *
 * Bei Körpergewichts-Übungen ist das Zusatzgewicht allein aussagelos – ohne
 * das Körpergewicht wäre ein Klimmzug mit 0 kg Zusatz rechnerisch nichts wert.
 *
 * An einer assistierten Maschine ist es umgekehrt: das eingestellte
 * Gegengewicht nimmt dir Last ab, es wird also abgezogen. Weniger Gegengewicht
 * ist demnach die Steigerung, nicht mehr.
 */
export function effectiveLoad(
  mode: TrackingMode,
  weightKg: number,
  bodyweightKg: number,
): number {
  if (mode === "bodyweight_reps") return bodyweightKg + weightKg;
  // Nicht unter null: mehr Gegengewicht als Körpergewicht hebt sich auf.
  if (mode === "assisted_reps") return Math.max(0, bodyweightKg - weightKg);
  return weightKg;
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
  bodyweightKg: number,
  /** Stufen statt kg bzw. Gewicht je Seite – nur für den Text. */
  unit?: { perSide?: boolean; level?: boolean } | null,
  /** Zielbereich aus dem Plan, nur für Arbeitssätze. */
  target?: { repsMin: number; repsMax: number } | null,
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
  // Die Richtung kommt aus der effektiven Last, nicht aus dem eingestellten
  // Gewicht. Nur so zeigt eine Maschine mit Gegengewicht nach oben, wenn du
  // die Hilfe reduzierst.
  const currentMax = estimateOneRepMax(effectiveLoad(mode, current.weightKg, bodyweightKg), current.reps);
  const previousMax = estimateOneRepMax(effectiveLoad(mode, previous.weightKg, bodyweightKg), previous.reps);
  const weightChanged = Math.abs(weightDiff) >= 0.05;
  const inTarget = target ? current.reps >= target.repsMin && current.reps <= target.repsMax : false;

  // Was „besser“ heißt, in dieser Reihenfolge:
  // 1. Gleiches Gewicht, mehr Wiederholungen ist immer Fortschritt.
  // 2. Unter dem Zielbereich war das Gewicht zu schwer – egal was das 1RM sagt.
  // 3. Gewicht geändert, aber im Zielbereich: Epley ist zwischen 8 und 10
  //    Wiederholungen nicht genauer als ein paar Prozent. 40 × 10 gegen
  //    41,25 × 8 (−2 %) ist der geplante Sprung, kein Rückschritt.
  // 4. Sonst entscheidet das 1RM wie bisher.
  let trend: Trend;
  if (!weightChanged && repsDiff > 0) trend = "up";
  else if (target && current.reps < target.repsMin) trend = "down";
  else if (weightChanged && inTarget) trend = trendOf(currentMax, previousMax, 0.025);
  else trend = trendOf(currentMax, previousMax);

  const parts: string[] = [];

  if (weightChanged) {
    const rounded = Math.round(Math.abs(weightDiff) * 100) / 100;
    const value = rounded.toLocaleString("de-DE", { maximumFractionDigits: 2 });
    // Beim Gegengewicht benennt das Label die Hilfe, der Pfeil die Leistung:
    // "▲ −5 kg Hilfe" heißt fünf Kilo weniger Unterstützung.
    const suffix =
      mode === "assisted_reps"
        ? " kg Hilfe"
        : unit?.level
          ? rounded === 1
            ? " Stufe"
            : " Stufen"
          : " kg"; // „/Seite“ steht schon am Satz – im Schild kostet es die Zeile.
    parts.push(`${weightDiff > 0 ? "+" : "−"}${value}${suffix}`);
  }

  // Beide Größen nennen, wenn sich beide geändert haben: "▼ +1 kg" allein
  // widerspricht sich – der Pfeil kommt dann von den Wiederholungen, die im
  // Text fehlen würden.
  if (repsDiff !== 0) {
    parts.push(`${repsDiff > 0 ? "+" : "−"}${Math.abs(repsDiff)} Wdh.`);
  }

  if (target && current.reps < target.repsMin) parts.push(`unter Ziel (${target.repsMin})`);
  else if (target && current.reps > target.repsMax) parts.push("über Ziel – steigern");

  if (parts.length === 0) return { trend: "flat", label: "gleich" };
  return { trend, label: parts.join(" · ") };
}
