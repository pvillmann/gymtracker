import type { EquipmentKind, SetEffort, TrackingMode } from "@/db/schema";

/**
 * Progressionsvorschlag nach doppelter Progression: erst die Wiederholungen
 * bis ans obere Ende des Zielbereichs, dann das Gewicht um einen Sprung
 * hoch und mit den Wiederholungen wieder unten anfangen.
 *
 * Bewusst eine reine Funktion ohne Datenbank: dieselbe Regel läuft im
 * Training, in Tests und als Grundwert für den optionalen KI-Vorschlag.
 */

export type ProgressionKind =
  /** Gewicht hoch (bei Gegengewicht: Hilfe runter). */
  | "increase"
  /** Gleiches Gewicht, mehr Wiederholungen. */
  | "reps"
  /** Wie letztes Mal – letzter Satz war am Limit. */
  | "hold";

export type Suggestion = {
  kind: ProgressionKind;
  /** Vorgeschlagenes Gewicht für alle Arbeitssätze (kg, kg je Seite oder Stufe). */
  weight: number;
  /** Wiederholungen je Arbeitssatz, in der Reihenfolge vom letzten Mal. */
  reps: number[];
  /** Ein Satz, warum – steht über den Feldern. */
  reason: string;
};

export type ProgressionInput = {
  mode: TrackingMode;
  /** Arbeitssätze vom letzten Mal an dieser Maschine, in Reihenfolge. */
  previous: Array<{ weightKg: number; reps: number }>;
  /** Einschätzung des letzten Arbeitssatzes vom letzten Mal. */
  lastEffort: SetEffort | null;
  /** Zielbereich aus dem Plan; ohne Plan entscheidet nur die Einschätzung. */
  target: { repsMin: number; repsMax: number } | null;
  /** Kleinster Sprung in der Einheit der Maschine. */
  step: number;
  /** Stufen statt kg – nur für die Texte. */
  level?: boolean;
};

/**
 * Standard-Sprung, wenn an der Maschine keiner eingetragen ist. Grob, aber
 * besser als ein fester Wert für alles: Steckgewichte springen meist in 5 kg,
 * Scheiben in 2,5 kg (je Seite also 1,25), Kurzhanteln in 2 kg.
 */
export function defaultStep(device: {
  kind: EquipmentKind;
  perSide?: boolean;
  loadUnit?: string;
  progressionStep?: number | null;
} | null): number {
  if (device?.progressionStep) return device.progressionStep;
  if (!device) return 2.5;
  if (device.loadUnit === "level") return 1;
  switch (device.kind) {
    case "plates":
      return device.perSide ? 1.25 : 2.5;
    case "stack":
    case "cable":
      return 5;
    case "free":
      return 2;
    default:
      return 2.5;
  }
}

const round = (value: number) => Math.round(value * 100) / 100;

function formatAmount(value: number, level?: boolean): string {
  const text = value.toLocaleString("de-DE", { maximumFractionDigits: 2 });
  return level ? `${text} ${value === 1 ? "Stufe" : "Stufen"}` : `${text} kg`;
}

/**
 * Der Vorschlag fürs heutige Training – oder null, wenn es nichts
 * vorzuschlagen gibt (Zeit-Übung, kein Verlauf).
 */
export function suggestNext(input: ProgressionInput): Suggestion | null {
  const { mode, previous, lastEffort, target, step, level } = input;
  if (mode === "time" || previous.length === 0 || step <= 0) return null;

  // Bei Gegengewicht ist weniger Hilfe die Steigerung.
  const direction = mode === "assisted_reps" ? -1 : 1;
  // Ohne Zusatzgewicht gibt es bei Körpergewichts-Übungen nur Wiederholungen.
  const weightless = mode === "bodyweight_reps" && previous.every((s) => s.weightKg === 0);

  // Maßgeblich ist das Gewicht des schwersten Arbeitssatzes vom letzten Mal.
  const weight = previous.reduce(
    (best, s) => (direction > 0 ? Math.max(best, s.weightKg) : Math.min(best, s.weightKg)),
    previous[0].weightKg,
  );
  const atWeight = previous.filter((s) => s.weightKg === weight);
  const lastReps = previous.map((s) => s.reps);

  if (lastEffort === "max") {
    return {
      kind: "hold",
      weight,
      reps: lastReps,
      reason: "Letztes Mal am Limit – heute dieselben Werte sauber wiederholen.",
    };
  }

  const repsMax = target?.repsMax ?? null;
  const repsMin = target?.repsMin ?? null;
  const allTop = repsMax !== null && atWeight.every((s) => s.reps >= repsMax);
  // „Leicht“ zählt einen Satz knapp unter dem Ziel als geschafft.
  const easyEnough =
    lastEffort === "easy" && (repsMax === null || atWeight.every((s) => s.reps >= repsMax - 1));

  // Ein Sprung von mehr als 10 % ist an kleinen Gewichten zu groß, um danach
  // noch den Zielbereich zu treffen – dann erst zwei Wiederholungen über das
  // Ziel hinaus, wie bei Alpha Progression. Nicht bei Stufen (keine Masse)
  // und nicht bei Gegengewicht (weniger Hilfe ist kein Anteil der Last).
  const bigJump = !level && direction > 0 && weight > 0 && step / weight > 0.1;
  const readyForJump =
    !weightless &&
    (easyEnough ||
      (allTop && (!bigJump || atWeight.every((s) => s.reps >= (repsMax ?? 0) + 2))));

  if (readyForJump) {
    const next = round(Math.max(0, weight + direction * step));
    return {
      kind: "increase",
      weight: next,
      reps: lastReps.map(() => repsMin ?? Math.max(1, Math.min(...lastReps) - 2)),
      reason:
        direction > 0
          ? `${easyEnough && !allTop ? "Letztes Mal leicht" : `Alle Sätze mit ${repsMax} Wdh. geschafft`} – +${formatAmount(step, level)}.`
          : `Alle Sätze geschafft – ${formatAmount(step, level)} weniger Hilfe.`,
    };
  }

  // Ohne Plan und ohne „leicht“ gibt es keinen Anlass zu steigern.
  if (repsMax === null) return null;

  const cap = bigJump && allTop ? repsMax + 2 : repsMax;
  return {
    kind: "reps",
    weight,
    reps: lastReps.map((r) => Math.min(r + 1, cap)),
    reason: bigJump && allTop
      ? `Der nächste Sprung (${formatAmount(step, level)}) ist groß – erst zwei Wiederholungen über das Ziel.`
      : `Gleiches Gewicht, eine Wiederholung mehr – bis ${repsMax} Wdh., dann wird gesteigert.`,
  };
}
