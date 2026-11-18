import assert from "node:assert/strict";
import { test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

await setupDb();
const nutrition = await import("@/lib/services/nutrition");

const at = (daysAgo: number, hour: number) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
};

test("Mahlzeiten: eintragen, Tagessummen, Schnitt ohne den laufenden Tag", async () => {
  const user = await makeUser("Esser");
  await nutrition.logMeal(user, { description: "Haferflocken", kcal: 400, proteinG: 20, eatenAt: at(2, 8) });
  await nutrition.logMeal(user, { description: "Pasta", kcal: 800, proteinG: 30, eatenAt: at(2, 13) });
  await nutrition.logMeal(user, { description: "Skyr", kcal: 200, proteinG: 25, eatenAt: at(1, 9) });
  await nutrition.logMeal(user, { description: "Pizza", kcal: 1000, proteinG: 40, eatenAt: at(0, 0) + 60 });

  const totals = await nutrition.dailyTotals(user.id, 4);
  assert.deepEqual(
    totals.map((t) => [t.kcal, t.proteinG, t.meals]),
    [[0, 0, 0], [1200, 50, 2], [200, 25, 1], [1000, 40, 1]],
  );
  // Leerer Tag und heute zählen nicht: (1200 + 200) / 2.
  assert.deepEqual(nutrition.averageOfLogged(totals), { kcal: 700, proteinG: 38, days: 2 });
});

test("Mahlzeiten: Plausibilität und nur das eigene Konto", async () => {
  const anna = await makeUser("Mahl-Anna");
  const ben = await makeUser("Mahl-Ben");
  await assert.rejects(nutrition.logMeal(anna, { description: " ", kcal: 100 }), /beschreiben/);
  await assert.rejects(nutrition.logMeal(anna, { description: "x", kcal: 20000 }), /unplausibel/);
  await assert.rejects(nutrition.logMeal(anna, { description: "x", kcal: 100, proteinG: -5 }), /Eiweiß/);
  await assert.rejects(
    nutrition.logMeal(anna, { description: "x", kcal: 100, eatenAt: Math.floor(Date.now() / 1000) + 86_400 }),
    /Zeitpunkt/,
  );
  const id = await nutrition.logMeal(anna, { description: "Apfel", kcal: 80 });
  await assert.rejects(nutrition.deleteMeal(ben, id), /gibt es nicht/);
  await nutrition.deleteMeal(anna, id);
  assert.equal((await nutrition.dailyTotals(anna.id, 1))[0].meals, 0);
});
