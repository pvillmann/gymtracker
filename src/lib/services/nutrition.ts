import "server-only";

import { and, asc, eq, gte, lt } from "drizzle-orm";

import { db } from "@/db";
import { meals, type MealConfidence, type User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";

/**
 * Mahlzeiten und Tagessummen. Rechnet nur – Ziele (Eiweiß, Defizit) und
 * Rückmeldungen kommen in späteren Etappen (Issue #60).
 */

export type MealInput = {
  description: string;
  kcal: number;
  proteinG?: number | null;
  carbsG?: number | null;
  fatG?: number | null;
  confidence?: MealConfidence;
  /** Unix-Sekunden; ohne Angabe jetzt. */
  eatenAt?: number;
  source?: "chat" | "manuell";
};

const CONFIDENCE: readonly MealConfidence[] = ["grob", "mittel", "gut"];

function grams(value: number | null | undefined, label: string): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0 || value > 1000) throw new ServiceError(`${label} wirkt unplausibel.`);
  return Math.round(value * 10) / 10;
}

export async function logMeal(user: User, input: MealInput): Promise<string> {
  const description = input.description.trim().slice(0, 300);
  if (!description) throw new ServiceError("Bitte beschreiben, was gegessen wurde.");
  if (!Number.isFinite(input.kcal) || input.kcal < 0 || input.kcal > 10_000) {
    throw new ServiceError("Die Kalorien wirken unplausibel (0–10.000 kcal).");
  }
  const now = Math.floor(Date.now() / 1000);
  const eatenAt = input.eatenAt ?? now;
  // Nicht in der Zukunft, nicht älter als ein Jahr – Tippfehler beim Datum abfangen.
  if (eatenAt > now + 3600 || eatenAt < now - 366 * 86_400) {
    throw new ServiceError("Der Zeitpunkt wirkt unplausibel.");
  }
  const confidence = input.confidence ?? "mittel";
  if (!CONFIDENCE.includes(confidence)) throw new ServiceError("Sicherheit: grob, mittel oder gut.");

  const id = newId();
  await db.insert(meals).values({
    id,
    userId: user.id,
    eatenAt,
    description,
    kcal: Math.round(input.kcal),
    proteinG: grams(input.proteinG, "Eiweiß"),
    carbsG: grams(input.carbsG, "Kohlenhydrate"),
    fatG: grams(input.fatG, "Fett"),
    confidence,
    source: input.source ?? "chat",
  });
  return id;
}

export async function deleteMeal(user: User, mealId: string): Promise<void> {
  const deleted = await db
    .delete(meals)
    .where(and(eq(meals.id, mealId), eq(meals.userId, user.id)))
    .returning({ id: meals.id });
  if (deleted.length === 0) throw new ServiceError("Diese Mahlzeit gibt es nicht.");
}

/** Beginn des Kalendertags (Zeitzone des Servers, wie überall in der App). */
export function startOfDay(at: Date): number {
  const day = new Date(at);
  day.setHours(0, 0, 0, 0);
  return Math.floor(day.getTime() / 1000);
}

export async function listMeals(userId: string, from: number, to: number) {
  return db
    .select()
    .from(meals)
    .where(and(eq(meals.userId, userId), gte(meals.eatenAt, from), lt(meals.eatenAt, to)))
    .orderBy(asc(meals.eatenAt));
}

export type DayTotal = { day: number; kcal: number; proteinG: number; carbsG: number; fatG: number; meals: number };

export function sumDay(day: number, rows: Array<{ kcal: number; proteinG: number | null; carbsG: number | null; fatG: number | null }>): DayTotal {
  return rows.reduce<DayTotal>(
    (sum, row) => ({
      day,
      kcal: sum.kcal + row.kcal,
      proteinG: sum.proteinG + (row.proteinG ?? 0),
      carbsG: sum.carbsG + (row.carbsG ?? 0),
      fatG: sum.fatG + (row.fatG ?? 0),
      meals: sum.meals + 1,
    }),
    { day, kcal: 0, proteinG: 0, carbsG: 0, fatG: 0, meals: 0 },
  );
}

/**
 * Tagessummen der letzten `days` Tage (heute eingeschlossen), älteste zuerst.
 * Tage ohne Eintrag bleiben drin (meals = 0) – „nichts eingetragen“ ist nicht
 * „nichts gegessen“, deshalb zählen sie im Schnitt nicht mit.
 */
export async function dailyTotals(userId: string, days: number, now = new Date()): Promise<DayTotal[]> {
  const starts: number[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    starts.push(startOfDay(d));
  }
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const rows = await listMeals(userId, starts[0], startOfDay(tomorrow));
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? startOfDay(tomorrow);
    return sumDay(
      start,
      rows.filter((r) => r.eatenAt >= start && r.eatenAt < end),
    );
  });
}

/** Schnitt über die Tage mit Einträgen – ohne den laufenden Tag, der ist noch nicht vorbei. */
export function averageOfLogged(totals: DayTotal[]): { kcal: number; proteinG: number; days: number } | null {
  const done = totals.slice(0, -1).filter((t) => t.meals > 0);
  if (done.length === 0) return null;
  return {
    kcal: Math.round(done.reduce((s, t) => s + t.kcal, 0) / done.length),
    proteinG: Math.round(done.reduce((s, t) => s + t.proteinG, 0) / done.length),
    days: done.length,
  };
}
