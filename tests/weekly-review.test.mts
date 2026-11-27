import assert from "node:assert/strict";
import { test } from "node:test";

import { hasSubstance, isStalled, weeklyHints, type WeeklyFacts } from "@/lib/weekly-review";

const base = (): WeeklyFacts => ({
  weekStart: 0,
  training: { sessions: 3, sessionsBefore: 3, workingSets: 45, volumeKg: 20000, volumeBeforeKg: 19000, stalled: [] },
  nutrition: { loggedDays: 7, avgKcal: 2200, avgProteinG: 140, proteinTargetG: 127, daysBelowProtein: 1, calorieTarget: 2100 },
  body: {
    trendStartKg: 105,
    trendEndKg: 104.2,
    kgPerWeek: -0.8,
    pctPerWeek: -0.77,
    rateStatus: "im-ziel",
    goal: "lose-0.75",
    fatPercentNow: 38,
    fatPercentBefore: 38.4,
  },
});

test("Gute Woche: keine Hinweise", () => {
  assert.deepEqual(weeklyHints(base()), []);
});

test("Zu schnell abgenommen: Hinweis mit kcal-Korrektur", () => {
  const facts = base();
  facts.body = { ...facts.body, kgPerWeek: -1.6, pctPerWeek: -1.54, rateStatus: "zu-schnell" };
  const [hint] = weeklyHints(facts);
  // Ziel 0,75 % von 104,2 kg = 0,78 kg; 0,82 kg zu viel · 7.700 / 7 ≈ 900 kcal.
  assert.equal(hint.kind, "body");
  assert.match(hint.text, /1,5 % pro Woche/);
  assert.match(hint.text, /900 kcal am Tag mehr/);
});

test("Zu langsam: weniger essen", () => {
  const facts = base();
  facts.body = { ...facts.body, kgPerWeek: -0.2, pctPerWeek: -0.19, rateStatus: "zu-langsam" };
  assert.match(weeklyHints(facts)[0].text, /kcal am Tag weniger/);
});

test("Eiweiß, Datenlage, Stillstand und ausgefallenes Training", () => {
  const facts = base();
  facts.nutrition = { ...facts.nutrition, loggedDays: 3, daysBelowProtein: 3, avgProteinG: 90, proteinTargetG: 158, proteinMinimumG: 127 };
  facts.training = { ...facts.training, sessions: 0, stalled: ["Kniebeuge", "Bankdrücken"] };
  const texts = weeklyHints(facts).map((h) => h.text);
  assert.match(texts[0], /Nur an 3 von 7 Tagen/);
  assert.ok(texts.some((t) => /Eiweiß an 3 von 3 Tagen unter dem Minimum von 127\sg \(Ø 90\sg, Ziel 158\sg\)/.test(t)));
  assert.ok(texts.some((t) => /Kniebeuge, Bankdrücken/.test(t)));
  // Ohne Abnehmziel ist das Ziel das Minimum – dann nicht doppelt nennen (#74).
  const same = weeklyHints({ ...facts, nutrition: { ...facts.nutrition, proteinTargetG: 127, proteinMinimumG: 127 } }).map((h) => h.text);
  assert.ok(same.some((t) => /unter dem Minimum von 127\sg \(Ø 90\sg\)\./.test(t)));
  assert.ok(texts.includes("Die ganze Woche kein Training."));
});

test("Stillstand braucht vier Einheiten, kleiner Zuwachs zählt nicht", () => {
  assert.equal(isStalled([100, 102, 101]), false);
  assert.equal(isStalled([100, 104, 103, 104, 104.2]), true);
  assert.equal(isStalled([100, 104, 103, 104, 106]), false);
});

test("Leere Woche hat nichts zu sagen", () => {
  const facts = base();
  facts.training.sessions = 0;
  facts.nutrition.loggedDays = 0;
  facts.body.trendEndKg = null;
  assert.equal(hasSubstance(facts), false);
});
