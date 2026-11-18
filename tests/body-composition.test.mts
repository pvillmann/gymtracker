import assert from "node:assert/strict";
import { test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

const { db, schema } = await setupDb();
const { eq } = await import("drizzle-orm");
const { estimateBodyFat } = await import("@/lib/body-composition");
const body = await import("@/lib/services/body-metrics");

test("Wu 2015: nachgerechnetes Beispiel", () => {
  // 80 kg, 180 cm, 500 Ω, 30 Jahre, Mann:
  // FFM = 13,055 + 0,204·80 + 0,394·180²/500 − 0,136·30 + 8,125 = 58,95 kg → Fett 21,05 kg = 26,3 %
  const at = new Date(Date.UTC(2026, 5, 1));
  const estimate = estimateBodyFat({ weightKg: 80, impedance: 500, at }, { heightCm: 180, birthYear: 1996, sex: "m" })!;
  assert.equal(estimate.fatFreeKg, 59);
  assert.equal(estimate.fatPercent, 26.3);
  assert.equal(estimate.spreadPercent, 4);
  assert.equal(estimate.outsideStudy, false);
  // Frau, sonst gleich: 8,125 kg weniger fettfreie Masse.
  const female = estimateBodyFat({ weightKg: 80, impedance: 500, at }, { heightCm: 180, birthYear: 1996, sex: "f" })!;
  assert.equal(female.fatPercent, 36.5);
});

test("Wu 2015: ohne Profil oder mit unsinnigen Werten keine Schätzung", () => {
  const at = new Date();
  const ok = { weightKg: 80, impedance: 500, at };
  assert.equal(estimateBodyFat(ok, { heightCm: null, birthYear: 1990, sex: "m" }), null);
  assert.equal(estimateBodyFat(ok, { heightCm: 180, birthYear: 1990, sex: null }), null);
  assert.equal(estimateBodyFat({ ...ok, impedance: 0 }, { heightCm: 180, birthYear: 1990, sex: "m" }), null);
  assert.equal(estimateBodyFat({ ...ok, impedance: 5000 }, { heightCm: 180, birthYear: 1990, sex: "m" }), null);
  // Außerhalb der Studie (über 75) wird gerechnet, aber markiert.
  const old = estimateBodyFat(ok, { heightCm: 180, birthYear: at.getFullYear() - 80, sex: "m" });
  assert.equal(old?.outsideStudy, true);
});

test("Waage: Messung landet im Verlauf, Schätzung folgt dem Profil", async () => {
  const user = await makeUser("Waage-Verlauf", { bodyweightKg: 90 });
  await body.recordScaleMeasurement(user, { weightKg: 105.3, impedance: 505 });
  // Widerstand 0 (nicht gemessen) wird nicht gespeichert.
  await assert.rejects(body.recordScaleMeasurement(user, { weightKg: 5, impedance: 505 }), /unplausibel/);

  const rows = await db.select().from(schema.bodyMetrics).where(eq(schema.bodyMetrics.userId, user.id));
  assert.deepEqual(rows.map((r) => r.metric).sort(), ["impedance", "weight"]);
  assert.ok(rows.every((r) => r.source === "Waage"));
  const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(stored.bodyweightKg, 105.3);

  // Ohne Profil keine Schätzung, mit Profil sofort – auch für alte Messungen.
  assert.deepEqual(await body.bodyFatEstimates(stored, 0), []);
  await db.update(schema.users).set({ heightCm: 185, birthYear: 1990, sex: "m" }).where(eq(schema.users.id, user.id));
  const [withProfile] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  const estimates = await body.bodyFatEstimates(withProfile, 0);
  assert.equal(estimates.length, 1);
  assert.ok(estimates[0].estimate.fatPercent > 20 && estimates[0].estimate.fatPercent < 50);
});
