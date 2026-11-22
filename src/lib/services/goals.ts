import "server-only";

import type { User } from "@/db/schema";
import {
  GOALS,
  calorieTarget,
  estimateExpenditure,
  isGoal,
  proteinTarget,
  rateStatus,
  weeklyRate,
  weightTrend,
  type GoalKey,
  type RateStatus,
} from "@/lib/goals";
import { bodyMetricSeries } from "@/lib/services/body-metrics";
import { dailyTotals } from "@/lib/services/nutrition";

const DAY = 86_400;

export type GoalsOverview = {
  goal: GoalKey | null;
  /** Geglättetes Gewicht heute (oder letzte Messung), null ohne Wiegung. */
  trendKg: number | null;
  trend: Array<{ t: number; value: number }>;
  rate: { kgPerWeek: number; pctPerWeek: number; status: RateStatus | null } | null;
  protein: ReturnType<typeof proteinTarget>;
  expenditure: { kcal: number; loggedDays: number } | { missing: string };
  calorieTarget: number | null;
};

/**
 * Alles, was Ziele und Rückmeldung brauchen – gerechnet, nicht geschätzt.
 * Grundlage: Gewicht der letzten 90 Tage, Essen der letzten 28 vollen Tage.
 */
export async function goalsOverview(user: User, now = new Date()): Promise<GoalsOverview> {
  const nowSec = Math.floor(now.getTime() / 1000);
  const [series, totals] = await Promise.all([
    bodyMetricSeries(user.id, nowSec - 90 * DAY),
    dailyTotals(user.id, 29, now),
  ]);
  const weights = series.find((s) => s.metric === "weight")?.points ?? [];
  const trend = weightTrend(weights);
  const trendKg = trend.at(-1)?.value ?? null;
  const goal = isGoal(user.goal) ? user.goal : null;

  const weekly = weeklyRate(trend, 14, nowSec);
  const rate =
    weekly && trendKg
      ? {
          kgPerWeek: weekly.kgPerWeek,
          pctPerWeek: Math.round((weekly.kgPerWeek / trendKg) * 10000) / 100,
          status: goal ? rateStatus((weekly.kgPerWeek / trendKg) * 100, goal) : null,
        }
      : null;

  // Verbrauch über die vollen Tage (ohne heute); Trend am Anfang und Ende
  // des Zeitraums, jeweils höchstens drei Tage daneben.
  const days = totals.slice(0, -1);
  const near = (t: number) => {
    const point = trend.reduce<(typeof trend)[number] | null>(
      (best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best),
      null,
    );
    return point && Math.abs(point.t - t) <= 3 * DAY ? point.value : null;
  };
  // Nur Tage, an denen es schon einen Trend gibt – sonst fehlt der Anfangswert.
  const window = days.filter((d) => d.day >= (trend[0]?.t ?? Infinity) - DAY);
  const expenditure = estimateExpenditure({
    days: window,
    trendStart: window.length ? near(window[0].day) : null,
    trendEnd: near(nowSec),
  });

  const weightKg = trendKg ?? user.bodyweightKg;
  return {
    goal,
    trendKg,
    trend,
    rate,
    protein: proteinTarget(weightKg, user.heightCm, goal),
    expenditure,
    calorieTarget: "kcal" in expenditure && goal ? calorieTarget(expenditure.kcal, weightKg, goal, user.sex) : null,
  };
}

export const goalLabel = (goal: GoalKey | null) => (goal ? GOALS[goal].label : "kein Ziel gesetzt");

export const RATE_TEXT: Record<RateStatus, string> = {
  "im-ziel": "im Ziel",
  "zu-schnell": "schneller als geplant",
  "zu-langsam": "langsamer als geplant",
  "falsche-richtung": "gegen das Ziel",
};
