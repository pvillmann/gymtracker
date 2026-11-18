import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { and, asc, eq, gte, lt } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { exercises, weeklyReviews, workoutSets, workouts, type User } from "@/db/schema";
import { rateStatus } from "@/lib/goals";
import { listWorkoutSummaries } from "@/lib/queries";
import { AI_MODEL, aiEnabled, anthropicFor } from "@/lib/services/ai-suggestions";
import { bodyFatEstimates } from "@/lib/services/body-metrics";
import { goalsOverview } from "@/lib/services/goals";
import { listMeals, startOfDay, sumDay } from "@/lib/services/nutrition";
import { startOfWeek } from "@/lib/stats";
import { effectiveLoad, estimateOneRepMax } from "@/lib/training";
import { hasSubstance, isStalled, weeklyHints, type Hint, type WeeklyFacts } from "@/lib/weekly-review";

/**
 * Wochenrückblick (Issue #60, Etappe 3): einmal je Kalenderwoche – für die
 * zuletzt abgeschlossene. Fakten und Hinweise rechnet GymTracker, Claude Haiku
 * schreibt (mit Schlüssel) Rückmeldung und höchstens zwei Korrekturen dazu.
 */

const DAY = 86_400;

export type WeeklyReview = {
  weekStart: number;
  facts: WeeklyFacts;
  hints: Hint[];
  status: "empty" | "rules" | "pending" | "ok" | "failed";
  feedback: string | null;
  actions: string[];
};

/** Montag 00:00 der zuletzt abgeschlossenen Woche. */
export function lastWeekStart(now = new Date()): number {
  const monday = startOfWeek(now);
  monday.setDate(monday.getDate() - 7);
  return Math.floor(monday.getTime() / 1000);
}

/** Bestwert je Einheit und Übung der letzten Wochen – für „ohne Fortschritt“. */
async function stalledExercises(user: User, weekStart: number, weekEnd: number): Promise<string[]> {
  const rows = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      name: exercises.name,
      mode: exercises.trackingMode,
      workoutId: workouts.id,
      startedAt: workouts.startedAt,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workouts.userId, user.id),
        eq(workoutSets.isWarmup, false),
        gte(workouts.startedAt, weekStart - 6 * 7 * DAY),
        lt(workouts.startedAt, weekEnd),
      ),
    )
    .orderBy(asc(workouts.startedAt));

  const byExercise = new Map<string, { name: string; lastAt: number; bests: Map<string, number> }>();
  for (const row of rows) {
    if (row.mode === "time") continue;
    const entry = byExercise.get(row.exerciseId) ?? { name: row.name, lastAt: 0, bests: new Map() };
    const score = estimateOneRepMax(effectiveLoad(row.mode, row.weightKg, user.bodyweightKg), row.reps);
    entry.bests.set(row.workoutId, Math.max(entry.bests.get(row.workoutId) ?? 0, score));
    entry.lastAt = Math.max(entry.lastAt, row.startedAt);
    byExercise.set(row.exerciseId, entry);
  }
  return [...byExercise.values()]
    // Nur Übungen, die in der Woche trainiert wurden.
    .filter((e) => e.lastAt >= weekStart && isStalled([...e.bests.values()]))
    .map((e) => e.name);
}

export async function computeWeeklyFacts(user: User, weekStart: number, now = new Date()): Promise<WeeklyFacts> {
  const weekEnd = weekStart + 7 * DAY;
  const [summaries, meals, goals, fat, stalled] = await Promise.all([
    listWorkoutSummaries(user.id),
    listMeals(user.id, weekStart, weekEnd),
    goalsOverview(user, now),
    bodyFatEstimates(user, weekStart - 7 * DAY),
    stalledExercises(user, weekStart, weekEnd),
  ]);

  const done = summaries.filter((s) => s.finishedAt !== null);
  const inWeek = done.filter((s) => s.startedAt >= weekStart && s.startedAt < weekEnd);
  const before = done.filter((s) => s.startedAt >= weekStart - 7 * DAY && s.startedAt < weekStart);

  // Essen je Tag der Woche.
  const days = new Map<number, typeof meals>();
  for (const meal of meals) {
    const day = startOfDay(new Date(meal.eatenAt * 1000));
    days.set(day, [...(days.get(day) ?? []), meal]);
  }
  const dayTotals = [...days.entries()].map(([day, rows]) => sumDay(day, rows));
  const logged = dayTotals.length;

  // Trend am Wochenanfang und -ende (nächster Punkt, höchstens drei Tage daneben).
  const near = (t: number) => {
    const point = goals.trend.reduce<(typeof goals.trend)[number] | null>(
      (best, p) => (!best || Math.abs(p.t - t) < Math.abs(best.t - t) ? p : best),
      null,
    );
    return point && Math.abs(point.t - t) <= 3 * DAY ? point.value : null;
  };
  const trendStartKg = near(weekStart);
  const trendEndKg = near(weekEnd - DAY);
  const kgPerWeek = trendStartKg !== null && trendEndKg !== null ? Math.round((trendEndKg - trendStartKg) * 100) / 100 : null;
  const pctPerWeek = kgPerWeek !== null && trendStartKg ? Math.round((kgPerWeek / trendStartKg) * 10000) / 100 : null;

  const fatIn = fat.filter((f) => f.t >= weekStart && f.t < weekEnd).at(-1)?.estimate.fatPercent ?? null;
  const fatBefore = fat.filter((f) => f.t < weekStart).at(-1)?.estimate.fatPercent ?? null;

  return {
    weekStart,
    training: {
      sessions: inWeek.length,
      sessionsBefore: before.length,
      workingSets: inWeek.reduce((s, w) => s + w.workingSetCount, 0),
      volumeKg: Math.round(inWeek.reduce((s, w) => s + w.volumeKg, 0)),
      volumeBeforeKg: Math.round(before.reduce((s, w) => s + w.volumeKg, 0)),
      stalled,
    },
    nutrition: {
      loggedDays: logged,
      avgKcal: logged ? Math.round(dayTotals.reduce((s, d) => s + d.kcal, 0) / logged) : null,
      avgProteinG: logged ? Math.round(dayTotals.reduce((s, d) => s + d.proteinG, 0) / logged) : null,
      proteinTargetG: goals.protein.grams,
      daysBelowProtein: dayTotals.filter((d) => d.proteinG < goals.protein.grams * 0.9).length,
      calorieTarget: goals.calorieTarget,
    },
    body: {
      trendStartKg,
      trendEndKg,
      kgPerWeek,
      pctPerWeek,
      rateStatus: pctPerWeek !== null && goals.goal ? rateStatus(pctPerWeek, goals.goal) : null,
      goal: goals.goal,
      fatPercentNow: fatIn,
      fatPercentBefore: fatBefore,
    },
  };
}

function toReview(row: typeof weeklyReviews.$inferSelect): WeeklyReview {
  return {
    weekStart: row.weekStart,
    facts: JSON.parse(row.facts) as WeeklyFacts,
    hints: JSON.parse(row.hints) as Hint[],
    // Abgerissener Hintergrundaufruf (z. B. Neustart): nach zwei Minuten gilt er als gescheitert.
    status: row.status === "pending" && row.createdAt < Date.now() / 1000 - 120 ? "failed" : row.status,
    feedback: row.feedback,
    actions: row.actions ? (JSON.parse(row.actions) as string[]) : [],
  };
}

/**
 * Rückblick der letzten Woche – beim ersten Aufruf berechnet und gespeichert.
 * Mit Schlüssel läuft Haiku im Hintergrund (status „pending“), die Seite lädt nach.
 */
export async function ensureWeeklyReview(user: User, now = new Date()): Promise<WeeklyReview> {
  const weekStart = lastWeekStart(now);
  const [existing] = await db
    .select()
    .from(weeklyReviews)
    .where(and(eq(weeklyReviews.userId, user.id), eq(weeklyReviews.weekStart, weekStart)));
  if (existing) return toReview(existing);

  const facts = await computeWeeklyFacts(user, weekStart, now);
  const hints = weeklyHints(facts);
  const status = !hasSubstance(facts) ? "empty" : aiEnabled(user) ? "pending" : "rules";
  const inserted = await db
    .insert(weeklyReviews)
    .values({ userId: user.id, weekStart, facts: JSON.stringify(facts), hints: JSON.stringify(hints), status })
    .onConflictDoNothing()
    .returning();
  // Zwei Aufrufe gleichzeitig: nur der erste fragt Haiku.
  if (inserted.length && status === "pending") void generateFeedback(user, weekStart, facts, hints);
  const [row] = inserted.length
    ? inserted
    : await db.select().from(weeklyReviews).where(and(eq(weeklyReviews.userId, user.id), eq(weeklyReviews.weekStart, weekStart)));
  return toReview(row);
}

const Answer = z.object({
  feedback: z.string().describe("3–5 Sätze Rückmeldung auf Deutsch, du-Form, nüchtern und motivierend"),
  actions: z.array(z.string()).describe("Höchstens zwei konkrete Korrekturen für nächste Woche, je ein Satz"),
});

const SYSTEM = [
  "Du bist ein nüchterner Coach für Krafttraining und Ernährung und schreibst einen kurzen Wochenrückblick auf Deutsch (du-Form).",
  "Du bekommst Fakten und feste Hinweise, die bereits berechnet sind. Nutze ausschließlich diese Zahlen – erfinde keine Ziele, Werte oder Diagnosen.",
  "Verbinde Training, Ernährung und Körper: Was lief gut, was passt nicht zusammen? Höchstens zwei konkrete Korrekturen, die zu den Hinweisen passen.",
  "Körperfett ist eine grobe Schätzung – keine Aussagen auf die Nachkommastelle. Keine medizinischen Ratschläge; bei Beschwerden auf Ärztin/Arzt verweisen.",
  "Wenig Daten heißt: das ehrlich sagen statt zu raten.",
].join(" ");

async function generateFeedback(user: User, weekStart: number, facts: WeeklyFacts, hints: Hint[]): Promise<void> {
  const client = anthropicFor(user);
  let update: Partial<typeof weeklyReviews.$inferInsert> = { status: "failed" };
  try {
    if (!client) throw new Error("kein Schlüssel");
    const response = await client.messages.parse({
      model: AI_MODEL,
      max_tokens: 2048,
      output_config: { effort: "low", format: zodOutputFormat(Answer) },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify({ fakten: facts, hinweise: hints.map((h) => h.text) }) }],
    });
    const parsed = response.stop_reason !== "refusal" ? response.parsed_output : null;
    if (parsed && parsed.feedback.trim()) {
      update = {
        status: "ok",
        feedback: parsed.feedback.trim().slice(0, 900),
        actions: JSON.stringify(parsed.actions.map((a) => a.trim().slice(0, 200)).filter(Boolean).slice(0, 2)),
      };
    }
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[ai] Wochenrückblick fehlgeschlagen (${error.status ?? "Verbindung"}): ${error.message}`);
    } else {
      console.error("[ai] Wochenrückblick fehlgeschlagen:", error);
    }
  }
  await db
    .update(weeklyReviews)
    .set(update)
    .where(and(eq(weeklyReviews.userId, user.id), eq(weeklyReviews.weekStart, weekStart)));
}
