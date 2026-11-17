import type { BodyMetric } from "@/db/schema";

/**
 * Liest den JSON-Export der iOS-App „Health Auto Export“ (REST-API-
 * Automation). Dokumentiert ist dort nur das Grundformat:
 *
 *   { "data": { "metrics": [ { "name": "step_count", "units": "count",
 *       "data": [ { "qty": 8500, "date": "2024-02-06 14:30:00 -0800",
 *                   "source": "Apple Watch" } ] } ] } }
 *
 * Metrik-Namen sind snake_case der Anzeigenamen. Die genauen Namen für
 * Gewicht & Co. nennt die Doku nicht – daher mehrere Schreibweisen, und was
 * nicht erkannt wird, meldet die Antwort zurück, statt es still zu schlucken.
 * Einheiten folgen der Einstellung in der App (metrisch oder imperial) und
 * werden hier umgerechnet; unbekannte Einheiten werden abgelehnt.
 */

export type HealthPoint = { metric: BodyMetric; measuredAt: number; value: number; source: string | null };

export type HealthParseResult = {
  points: HealthPoint[];
  /** Metriken, die (noch) nicht übernommen werden – Name aus dem Export. */
  ignored: string[];
  /** Erkannte Metriken mit unbekannter Einheit, z. B. "weight_body_mass (oz)". */
  badUnits: string[];
  /** Punkte mit unlesbarem Datum oder unplausiblem Wert. */
  rejected: number;
};

const NAMES: Record<string, BodyMetric> = {
  weight_body_mass: "weight",
  body_mass: "weight",
  weight: "weight",
  body_fat_percentage: "body_fat",
  body_fat: "body_fat",
  lean_body_mass: "lean_mass",
  resting_heart_rate: "resting_hr",
  heart_rate_variability: "hrv",
  heart_rate_variability_sdnn: "hrv",
  sleep_analysis: "sleep",
  step_count: "steps",
  active_energy: "active_energy",
  active_energy_burned: "active_energy",
};

const POUND = 0.45359237;
const STONE = 6.35029318;

/** Umrechnung in die Einheit, in der gespeichert wird; null = unbekannt. */
function convert(metric: BodyMetric, unit: string): ((v: number) => number) | null {
  const u = unit.trim().toLowerCase();
  switch (metric) {
    case "weight":
    case "lean_mass":
      if (u === "kg") return (v) => v;
      if (u === "lb" || u === "lbs") return (v) => v * POUND;
      if (u === "st") return (v) => v * STONE;
      if (u === "g") return (v) => v / 1000;
      return null;
    case "body_fat":
      // HealthKit kennt Prozent als Anteil (0,18) – die App rechnet meist in
      // Prozent um. Beides annehmen, ein Körperfett unter 1 % gibt es nicht.
      if (u === "%" || u === "percent" || u === "") return (v) => (v <= 1 ? v * 100 : v);
      return null;
    case "resting_hr":
      return u === "count/min" || u === "bpm" || u === "/min" ? (v) => v : null;
    case "hrv":
      return u === "ms" ? (v) => v : null;
    case "sleep":
      if (u === "hr" || u === "h") return (v) => v;
      if (u === "min") return (v) => v / 60;
      return null;
    case "steps":
      return u === "count" || u === "" ? (v) => v : null;
    case "active_energy":
      if (u === "kcal" || u === "cal") return (v) => v;
      if (u === "kj") return (v) => v / 4.184;
      return null;
  }
}

/** Plausible Bereiche nach der Umrechnung – alles andere ist ein Messfehler. */
const RANGE: Record<BodyMetric, [number, number]> = {
  weight: [20, 400],
  body_fat: [2, 75],
  lean_mass: [10, 300],
  resting_hr: [20, 200],
  hrv: [1, 400],
  sleep: [0, 24],
  steps: [0, 200_000],
  active_energy: [0, 20_000],
};

/** "2024-02-06 14:30:00 -0800" oder ISO 8601 → Unix-Sekunden. */
export function parseHealthDate(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?)\s*([+-]\d{2}):?(\d{2})$/.exec(value.trim());
  const iso = m ? `${m[1]}T${m[2]}${m[3]}:${m[4]}` : value.trim();
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function number(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, 80) : null;
}

export function parseHealthExport(payload: unknown): HealthParseResult {
  const result: HealthParseResult = { points: [], ignored: [], badUnits: [], rejected: 0 };
  const root = (payload ?? {}) as { data?: { metrics?: unknown }; metrics?: unknown };
  const metrics = root.data?.metrics ?? root.metrics;
  if (!Array.isArray(metrics)) return result;

  for (const entry of metrics as Array<Record<string, unknown>>) {
    const name = typeof entry?.name === "string" ? entry.name.trim().toLowerCase() : "";
    const metric = NAMES[name];
    if (!metric) {
      if (name && !result.ignored.includes(name)) result.ignored.push(name);
      continue;
    }
    const units = typeof entry.units === "string" ? entry.units : "";
    const toUnit = convert(metric, units);
    if (!toUnit) {
      result.badUnits.push(`${name} (${units || "ohne Einheit"})`);
      continue;
    }
    if (!Array.isArray(entry.data)) continue;

    for (const point of entry.data as Array<Record<string, unknown>>) {
      // Schlaf zusammengefasst: ein Eintrag pro Nacht mit totalSleep bzw.
      // asleep in Stunden. Einzelne Schlafphasen (ohne „Daten
      // zusammenfassen“) überlappen je Quelle und werden nicht addiert.
      const raw =
        metric === "sleep" ? (number(point?.totalSleep) ?? number(point?.asleep)) : number(point?.qty);
      const at = parseHealthDate(metric === "sleep" ? (point?.sleepEnd ?? point?.date) : point?.date);
      if (raw === null || at === null) {
        result.rejected += 1;
        continue;
      }
      const value = Math.round(toUnit(raw) * 100) / 100;
      const [min, max] = RANGE[metric];
      if (value < min || value > max) {
        result.rejected += 1;
        continue;
      }
      result.points.push({ metric, measuredAt: at, value, source: text(point.source) });
    }
  }
  return result;
}

/** Summen pro Tag statt Einzelwerten – Schritte und Energie kommen in Stücken. */
export const CUMULATIVE: ReadonlySet<BodyMetric> = new Set(["steps", "active_energy"]);
