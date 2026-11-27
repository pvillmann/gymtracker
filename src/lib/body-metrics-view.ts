import type { BodyMetric } from "@/db/schema";
import type { MetricSeries } from "@/lib/services/body-metrics";

const de = (value: number, digits = 1) => value.toLocaleString("de-DE", { maximumFractionDigits: digits });

export const BODY_METRICS: Record<BodyMetric, { label: string; format: (v: number) => string }> = {
  weight: { label: "Gewicht", format: (v) => `${de(v)} kg` },
  body_fat: { label: "Körperfett", format: (v) => `${de(v)} %` },
  lean_mass: { label: "Magermasse", format: (v) => `${de(v)} kg` },
  resting_hr: { label: "Ruhepuls", format: (v) => `${de(v, 0)} /min` },
  hrv: { label: "HRV (SDNN)", format: (v) => `${de(v, 0)} ms` },
  sleep: { label: "Schlaf", format: (v) => `${Math.floor(v)} h ${String(Math.round((v % 1) * 60)).padStart(2, "0")} min` },
  steps: { label: "Schritte", format: (v) => de(v, 0) },
  active_energy: { label: "Aktive Energie", format: (v) => `${de(v, 0)} kcal` },
  impedance: { label: "Widerstand (Waage)", format: (v) => `${de(v, 0)} Ω` },
};

const ORDER: BodyMetric[] = ["weight", "body_fat", "lean_mass", "resting_hr", "hrv", "sleep", "steps", "active_energy"];
const WEEK = 7 * 86_400;

export type BodyTile = {
  metric: BodyMetric;
  value: string;
  /** „Ø 7 Tage 79,9 kg“ */
  average: string | null;
  /** „−0,9 kg in 4 Wochen“ – Wochenschnitt gegen den vor vier Wochen. */
  change: string | null;
};

/**
 * Kacheln: letzter Wert, darunter der Schnitt der letzten sieben Tage und
 * die Veränderung zum Schnitt der sieben Tage vier Wochen davor. Einzelne
 * Messungen schwanken (Wasser, Uhrzeit) – der Wochenschnitt ist ehrlicher.
 */
export function bodyMetricSummary(series: MetricSeries[]): BodyTile[] {
  const tiles: BodyTile[] = [];
  for (const metric of ORDER) {
    const points = series.find((s) => s.metric === metric)?.points ?? [];
    const last = points.at(-1);
    if (!last) continue;
    const { format } = BODY_METRICS[metric];
    const avg = (from: number, to: number) => {
      const window = points.filter((p) => p.t > from && p.t <= to);
      return window.length ? window.reduce((sum, p) => sum + p.value, 0) / window.length : null;
    };
    const recent = avg(last.t - WEEK, last.t);
    const before = avg(last.t - 5 * WEEK, last.t - 4 * WEEK);
    const average = recent !== null && points.length > 1 ? `Ø 7 Tage ${format(recent)}` : null;
    const diff = recent !== null && before !== null ? recent - before : null;
    const change = diff !== null ? `${diff >= 0 ? "+" : "−"}${format(Math.abs(diff))} in 4 Wochen` : null;
    tiles.push({ metric, value: format(last.value), average, change });
  }
  return tiles;
}
