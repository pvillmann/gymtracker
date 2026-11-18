import { KCAL_PER_KG, GOALS, type GoalKey, type RateStatus } from "@/lib/goals";

/**
 * Wochenrückblick, Regelteil (Issue #60, Etappe 3): aus den Zahlen einer
 * Woche feste Hinweise. Rein und getestet – Haiku bekommt Fakten und Hinweise
 * und formuliert nur Rückmeldung und Korrekturen, rechnet aber nichts selbst.
 */

export type WeeklyFacts = {
  weekStart: number;
  training: {
    sessions: number;
    sessionsBefore: number;
    workingSets: number;
    volumeKg: number;
    volumeBeforeKg: number;
    /** Übungen ohne Fortschritt über die letzten drei Einheiten. */
    stalled: string[];
  };
  nutrition: {
    loggedDays: number;
    avgKcal: number | null;
    avgProteinG: number | null;
    proteinTargetG: number;
    daysBelowProtein: number;
    calorieTarget: number | null;
  };
  body: {
    trendStartKg: number | null;
    trendEndKg: number | null;
    kgPerWeek: number | null;
    pctPerWeek: number | null;
    rateStatus: RateStatus | null;
    goal: GoalKey | null;
    fatPercentNow: number | null;
    fatPercentBefore: number | null;
  };
};

export type Hint = { kind: "nutrition" | "training" | "body" | "data"; text: string };

const de = (value: number, digits = 0) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });
const round10 = (value: number) => Math.round(value / 10) * 10;

/** Feste Hinweise, wichtigste zuerst, höchstens fünf. */
export function weeklyHints(facts: WeeklyFacts): Hint[] {
  const hints: Hint[] = [];
  const { training, nutrition, body } = facts;

  if (nutrition.loggedDays > 0 && nutrition.loggedDays < 4) {
    hints.push({
      kind: "data",
      text: `Nur an ${nutrition.loggedDays} von 7 Tagen Essen eingetragen – Aussagen zur Ernährung sind wackelig.`,
    });
  }

  if (body.rateStatus && body.goal && body.kgPerWeek !== null && body.trendEndKg !== null) {
    const targetKgPerWeek = (GOALS[body.goal].ratePct / 100) * body.trendEndKg;
    // Wie viel kcal am Tag fehlen oder zu viel sind, um aufs Ziel zu kommen.
    const kcalPerDay = round10(((targetKgPerWeek - body.kgPerWeek) * KCAL_PER_KG) / 7);
    if (body.rateStatus === "zu-schnell" && body.goal !== "maintain" && GOALS[body.goal].ratePct < 0) {
      hints.push({
        kind: "body",
        text: `Abnahme mit ${de(Math.abs(body.pctPerWeek ?? 0), 1)} % pro Woche schneller als geplant – für den Muskelerhalt etwa ${de(Math.abs(kcalPerDay))} kcal am Tag mehr essen.`,
      });
    } else if (body.rateStatus === "zu-langsam") {
      hints.push({
        kind: "body",
        text: `Tempo langsamer als geplant – rechnerisch etwa ${de(Math.abs(kcalPerDay))} kcal am Tag ${kcalPerDay < 0 ? "weniger" : "mehr"}.`,
      });
    } else if (body.rateStatus === "falsche-richtung") {
      hints.push({ kind: "body", text: "Der Gewichtstrend läuft gegen das Ziel." });
    }
  }

  if (nutrition.loggedDays >= 3 && nutrition.daysBelowProtein >= Math.ceil(nutrition.loggedDays / 2)) {
    hints.push({
      kind: "nutrition",
      text: `Eiweiß an ${nutrition.daysBelowProtein} von ${nutrition.loggedDays} Tagen unter Ziel (Ø ${de(nutrition.avgProteinG ?? 0)}\u00a0g statt ${nutrition.proteinTargetG}\u00a0g).`,
    });
  }

  if (training.stalled.length > 0) {
    hints.push({
      kind: "training",
      text: `Ohne Fortschritt seit drei Einheiten: ${training.stalled.slice(0, 3).join(", ")}.`,
    });
  }

  if (training.sessions === 0) {
    hints.push({ kind: "training", text: "Die ganze Woche kein Training." });
  } else if (training.sessionsBefore > 0 && training.sessions < training.sessionsBefore - 1) {
    hints.push({
      kind: "training",
      text: `${training.sessions} statt ${training.sessionsBefore} Trainings wie in der Woche davor.`,
    });
  }

  return hints.slice(0, 5);
}

/**
 * Stillstand: Bestwert (geschätztes 1RM) der letzten drei Einheiten nicht
 * höher als der beste davor. Braucht mindestens vier Einheiten.
 */
export function isStalled(sessionBests: number[]): boolean {
  if (sessionBests.length < 4) return false;
  const recent = sessionBests.slice(-3);
  const before = sessionBests.slice(0, -3);
  return Math.max(...recent) <= Math.max(...before) * 1.005;
}

/** Hat die Woche überhaupt etwas, worüber man schreiben kann? */
export function hasSubstance(facts: WeeklyFacts): boolean {
  return facts.training.sessions > 0 || facts.nutrition.loggedDays > 0 || facts.body.trendEndKg !== null;
}
