import assert from "node:assert/strict";
import { test } from "node:test";

import { calorieTarget, estimateExpenditure, proteinTarget, rateStatus, weeklyRate, weightTrend } from "@/lib/goals";

const DAY = 86_400;

test("Trend glättet Ausreißer, Rate aus der Steigung", () => {
  // 21 Tage, echte Abnahme 0,1 kg/Tag, dazu ±1 kg Wasserschwankung.
  const now = 1_800_000_000;
  const points = Array.from({ length: 21 }, (_, i) => ({
    t: now - (20 - i) * DAY,
    value: 105 - 0.1 * i + (i % 2 === 0 ? 1 : -1),
  }));
  const trend = weightTrend(points);
  // Der Trend schwankt deutlich weniger als die Messungen.
  const jumps = trend.slice(1).map((p, i) => Math.abs(p.value - trend[i].value));
  assert.ok(Math.max(...jumps) < 0.3);
  const rate = weeklyRate(trend, 14, now)!;
  // Der Trend läuft der Abnahme hinterher, kommt ihr aber nahe (−0,7 kg/Woche).
  assert.ok(rate.kgPerWeek < -0.4 && rate.kgPerWeek > -0.9, String(rate.kgPerWeek));
  // Zu wenige Punkte: keine Rate.
  assert.equal(weeklyRate(trend.slice(-2), 14, now), null);
});

test("Trend: mehrere Wiegungen eines Tages zählen als ein Mittelwert", () => {
  const morning = new Date(2026, 10, 10, 7, 0, 0).getTime() / 1000;
  const single = weightTrend([
    { t: morning - DAY, value: 100 },
    { t: morning, value: 102 },
  ]);
  const doubled = weightTrend([
    { t: morning - DAY, value: 100 },
    { t: morning, value: 101 },
    { t: morning + 30, value: 103 },
  ]);
  // Gleicher Tagesmittelwert (102) – gleicher Trend, auch bei zwei Wiegungen.
  assert.equal(doubled.length, 2);
  assert.equal(doubled.at(-1)!.value, single.at(-1)!.value);
  assert.equal(doubled.at(-1)!.t, morning + 30);
});

test("Tempo-Status gegen das Ziel", () => {
  assert.equal(rateStatus(-0.7, "lose-0.75"), "im-ziel");
  assert.equal(rateStatus(-1.4, "lose-0.75"), "zu-schnell");
  assert.equal(rateStatus(-0.2, "lose-0.75"), "zu-langsam");
  assert.equal(rateStatus(0.3, "lose-0.75"), "falsche-richtung");
  assert.equal(rateStatus(0.1, "maintain"), "im-ziel");
  assert.equal(rateStatus(0.6, "gain-0.25"), "zu-schnell");
});

test("Eiweiß: 1,6 g/kg, ab BMI 30 bezogen auf BMI 25", () => {
  assert.deepEqual(proteinTarget(80, 180), { grams: 128, upper: 160, referenceKg: 80, adjusted: false });
  // 105,3 kg bei 178 cm = BMI 33 → Bezug 79,2 kg (BMI 25).
  assert.deepEqual(proteinTarget(105.3, 178), { grams: 127, upper: 158, referenceKg: 79.2, adjusted: true });
  // Ohne Größe: tatsächliches Gewicht.
  assert.equal(proteinTarget(105.3, null).grams, 168);
});

test("Verbrauch erst mit genug Daten, dann Essen minus Trendänderung", () => {
  const days = (n: number, logged: number) =>
    Array.from({ length: n }, (_, i) => ({ kcal: i < logged ? 2200 : 0, meals: i < logged ? 3 : 0 }));
  assert.match(String((estimateExpenditure({ days: days(14, 14), trendStart: 105, trendEnd: 104 }) as { missing: string }).missing), /Tage/);
  assert.match(String((estimateExpenditure({ days: days(21, 10), trendStart: 105, trendEnd: 104 }) as { missing: string }).missing), /Einträgen/);
  // 21 Tage à 2.200 kcal, Trend −1,5 kg: 2.200 + 1,5·7.700/21 = 2.750 kcal.
  assert.deepEqual(estimateExpenditure({ days: days(21, 21), trendStart: 105, trendEnd: 103.5 }), { kcal: 2750, loggedDays: 21 });
});

test("Kalorienziel: Verbrauch minus Defizit fürs Wochenziel, mit Untergrenze", () => {
  // 0,75 % von 100 kg = 0,75 kg/Woche → 825 kcal/Tag Defizit.
  assert.equal(calorieTarget(2750, 100, "lose-0.75", "m"), 1930);
  assert.equal(calorieTarget(2750, 100, "maintain", "m"), 2750);
  assert.equal(calorieTarget(1700, 100, "lose-1", "m"), 1500);
  assert.equal(calorieTarget(1500, 60, "lose-1", "f"), 1200);
});

test("Überblick: aus 28 Tagen Wiegen und Essen werden Tempo, Verbrauch und Kalorienziel", async () => {
  const { makeUser, setupDb } = await import("./helpers/db");
  const { db, schema } = await setupDb();
  const { eq } = await import("drizzle-orm");
  const { goalsOverview } = await import("@/lib/services/goals");
  const { logMeal } = await import("@/lib/services/nutrition");

  const user = await makeUser("Ziele");
  await db.update(schema.users).set({ heightCm: 178, sex: "m", birthYear: 1993, goal: "lose-0.75" }).where(eq(schema.users.id, user.id));
  const now = new Date();
  const dayAgo = (days: number, hour: number) => {
    const d = new Date(now);
    d.setDate(d.getDate() - days);
    d.setHours(hour, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
  };
  // 28 Tage: täglich gewogen, −0,1 kg/Tag; täglich 2.400 kcal gegessen.
  for (let i = 28; i >= 0; i--) {
    await db.insert(schema.bodyMetrics).values({ userId: user.id, metric: "weight", measuredAt: dayAgo(i, 7), value: 108 - 0.1 * (28 - i), source: "Waage" });
    if (i > 0) await logMeal(user, { description: "Tag", kcal: 2400, proteinG: 120, eatenAt: dayAgo(i, 12) });
  }
  const [fresh] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  const overview = await goalsOverview(fresh, now);

  assert.equal(overview.goal, "lose-0.75");
  assert.ok(overview.rate && overview.rate.kgPerWeek < -0.4, JSON.stringify(overview.rate));
  // BMI über 30 → Eiweiß auf 79,2 kg bezogen.
  assert.equal(overview.protein.grams, 127);
  assert.ok("kcal" in overview.expenditure, JSON.stringify(overview.expenditure));
  // Verbrauch liegt über dem Essen, weil abgenommen wird.
  const expenditure = (overview.expenditure as { kcal: number }).kcal;
  assert.ok(expenditure > 2600 && expenditure < 3400, String(expenditure));
  assert.ok(overview.calorieTarget! < expenditure && overview.calorieTarget! >= 1500);
});
