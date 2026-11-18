/**
 * Ziele aus Regeln – reine Funktionen, keine Datenbank. Haiku bekommt später
 * nur, was hier herauskommt (Issue #60, Etappe 2).
 *
 * Quellen:
 * - Eiweiß ~1,6 g/kg/Tag: darüber kein weiterer Zuwachs an fettfreier Masse
 *   durch Krafttraining (Morton et al. 2018, Br J Sports Med, Meta-Analyse).
 *   Bis ~2,0 g/kg als Obergrenze der Spanne, im Defizit eher am oberen Ende.
 * - Ab BMI 30 als Bezug das Gewicht bei BMI 25 statt des tatsächlichen –
 *   pro kg Gesamtgewicht wird das Ziel sonst übertrieben. Das ist eine
 *   verbreitete Konvention, keine geklärte Evidenz.
 * - Abnehmtempo 0,5–1 % Körpergewicht pro Woche erhält Muskeln besser
 *   (Helms et al. 2014, JISSN).
 * - 7.700 kcal/kg ist eine Faustregel; in den ersten Wochen enthält ein Kilo
 *   weniger Energie (Wasser, Glykogen). Deshalb Verbrauch erst ab 3 Wochen.
 */

const DAY = 86_400;
export const KCAL_PER_KG = 7700;

/** Wochenziel in % des Körpergewichts: negativ = abnehmen. */
export const GOALS = {
  "lose-1": { label: "Abnehmen, zügig (−1 %/Woche)", ratePct: -1 },
  "lose-0.75": { label: "Abnehmen (−0,75 %/Woche)", ratePct: -0.75 },
  "lose-0.5": { label: "Abnehmen, sanft (−0,5 %/Woche)", ratePct: -0.5 },
  maintain: { label: "Gewicht halten", ratePct: 0 },
  "gain-0.25": { label: "Aufbauen (+0,25 %/Woche)", ratePct: 0.25 },
} as const;
export type GoalKey = keyof typeof GOALS;
export const isGoal = (value: unknown): value is GoalKey => typeof value === "string" && value in GOALS;

/**
 * Geglätteter Gewichtstrend (exponentiell, 10 % je Tag – wie „The Hacker's
 * Diet“). Einzelne Messungen schwanken um 1–2 kg durch Wasser und Essen.
 * Eingabe nach Zeit sortiert; Lücken werden tageweise überbrückt. Mehrere
 * Wiegungen eines Tages (Zeitzone des Servers) zählen als ein Wert, ihr
 * Mittel – sonst ginge ein Tag mit Doppelwiegung doppelt in den Trend ein.
 */
export function weightTrend(points: Array<{ t: number; value: number }>, smoothing = 0.1): Array<{ t: number; value: number }> {
  const days = perDay(points);
  if (days.length === 0) return [];
  const out: Array<{ t: number; value: number }> = [];
  let trend = days[0].value;
  let lastT = days[0].t;
  for (const point of days) {
    const days = Math.max(0, (point.t - lastT) / DAY);
    // Über mehrere Tage ohne Messung: so oft glätten wie Tage vergangen sind.
    const keep = (1 - smoothing) ** Math.max(1, days);
    trend = trend * keep + point.value * (1 - keep);
    out.push({ t: point.t, value: Math.round(trend * 100) / 100 });
    lastT = point.t;
  }
  return out;
}

/** Ein Punkt je Kalendertag: Mittel der Werte, Zeitpunkt der letzten Wiegung. */
function perDay(points: Array<{ t: number; value: number }>): Array<{ t: number; value: number }> {
  const out: Array<{ t: number; value: number; key: number; n: number }> = [];
  for (const point of points) {
    const day = new Date(point.t * 1000);
    day.setHours(0, 0, 0, 0);
    const key = day.getTime();
    const last = out.at(-1);
    if (last && last.key === key) {
      last.value = (last.value * last.n + point.value) / (last.n + 1);
      last.n += 1;
      last.t = point.t;
    } else {
      out.push({ t: point.t, value: point.value, key, n: 1 });
    }
  }
  return out.map(({ t, value }) => ({ t, value }));
}

/** Steigung des Trends in kg/Woche über die letzten `days` Tage (lineare Regression). */
export function weeklyRate(trend: Array<{ t: number; value: number }>, days = 14, now = Date.now() / 1000): { kgPerWeek: number; span: number } | null {
  const window = trend.filter((p) => p.t >= now - days * DAY);
  if (window.length < 3) return null;
  const span = (window.at(-1)!.t - window[0].t) / DAY;
  if (span < 7) return null;
  const meanT = window.reduce((s, p) => s + p.t, 0) / window.length;
  const meanV = window.reduce((s, p) => s + p.value, 0) / window.length;
  let num = 0;
  let den = 0;
  for (const p of window) {
    num += (p.t - meanT) * (p.value - meanV);
    den += (p.t - meanT) ** 2;
  }
  if (den === 0) return null;
  return { kgPerWeek: Math.round((num / den) * 7 * DAY * 100) / 100, span: Math.round(span) };
}

export type RateStatus = "zu-schnell" | "im-ziel" | "zu-langsam" | "falsche-richtung";

/** Liegt das Tempo im Zielkorridor (±0,25 Prozentpunkte um das Ziel, Abnehmen höchstens 1 %)? */
export function rateStatus(ratePctPerWeek: number, goal: GoalKey): RateStatus {
  const target = GOALS[goal].ratePct;
  if (target < 0) {
    if (ratePctPerWeek >= 0) return "falsche-richtung";
    if (ratePctPerWeek < Math.max(-1.25, target - 0.25)) return "zu-schnell";
    if (ratePctPerWeek > target + 0.25) return "zu-langsam";
    return "im-ziel";
  }
  if (target === 0) return Math.abs(ratePctPerWeek) <= 0.25 ? "im-ziel" : ratePctPerWeek > 0 ? "zu-schnell" : "falsche-richtung";
  if (ratePctPerWeek < 0) return "falsche-richtung";
  if (ratePctPerWeek > target + 0.25) return "zu-schnell";
  if (ratePctPerWeek < target - 0.15) return "zu-langsam";
  return "im-ziel";
}

/** Eiweißziel in g/Tag: 1,6 g/kg (Spanne bis 2,0), ab BMI 30 bezogen auf BMI 25. */
export function proteinTarget(weightKg: number, heightCm: number | null): { grams: number; upper: number; referenceKg: number; adjusted: boolean } {
  let referenceKg = weightKg;
  let adjusted = false;
  if (heightCm) {
    const meters = heightCm / 100;
    if (weightKg / meters ** 2 >= 30) {
      referenceKg = Math.round(25 * meters ** 2 * 10) / 10;
      adjusted = true;
    }
  }
  return { grams: Math.round(referenceKg * 1.6), upper: Math.round(referenceKg * 2.0), referenceKg, adjusted };
}

/**
 * Tatsächlicher Verbrauch aus Essen und Trend: Schnitt der Tage mit Einträgen
 * minus Energie der Trendänderung. Nur mit genug Daten, sonst null mit Grund.
 */
export function estimateExpenditure(input: {
  /** Tagessummen im Zeitraum (ohne den laufenden Tag). */
  days: Array<{ kcal: number; meals: number }>;
  /** Trend am Anfang und Ende des Zeitraums. */
  trendStart: number | null;
  trendEnd: number | null;
}): { kcal: number; loggedDays: number } | { missing: string } {
  const { days, trendStart, trendEnd } = input;
  if (days.length < 21) return { missing: `noch ${21 - days.length} Tage bis zur ersten Rechnung` };
  const logged = days.filter((d) => d.meals > 0);
  // Drei von vier Tagen eingetragen – sonst fehlt zu viel vom Essen.
  if (logged.length < days.length * 0.75) {
    return { missing: `zu wenige Tage mit Einträgen (${logged.length} von ${days.length})` };
  }
  if (trendStart === null || trendEnd === null) return { missing: "zu wenige Wiegungen" };
  const intake = logged.reduce((s, d) => s + d.kcal, 0) / logged.length;
  const storedPerDay = ((trendEnd - trendStart) * KCAL_PER_KG) / days.length;
  return { kcal: Math.round((intake - storedPerDay) / 10) * 10, loggedDays: logged.length };
}

/** Kalorienziel für das Wochenziel; nie unter 1.500 kcal (Männer) / 1.200 kcal (Frauen). */
export function calorieTarget(expenditure: number, weightKg: number, goal: GoalKey, sex: "m" | "f" | null): number {
  const kgPerWeek = (GOALS[goal].ratePct / 100) * weightKg;
  const target = expenditure + (kgPerWeek * KCAL_PER_KG) / 7;
  const floor = sex === "f" ? 1200 : 1500;
  return Math.max(floor, Math.round(target / 10) * 10);
}
