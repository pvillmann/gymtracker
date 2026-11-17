import assert from "node:assert/strict";
import { test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

const { db, schema } = await setupDb();
const { eq } = await import("drizzle-orm");
const { parseHealthDate, parseHealthExport } = await import("@/lib/health-import");
const body = await import("@/lib/services/body-metrics");
const { bodyMetricSummary } = await import("@/lib/body-metrics-view");

// Format laut Doku von Health Auto Export (data.metrics, qty/date/source).
const exportOf = (...metrics: unknown[]) => ({ data: { metrics, workouts: [] } });

test("Datum: Format der App und ISO", () => {
  assert.equal(parseHealthDate("2024-02-06 14:30:00 -0800"), Date.parse("2024-02-06T22:30:00Z") / 1000);
  assert.equal(parseHealthDate("2024-02-06T14:30:00+01:00"), Date.parse("2024-02-06T13:30:00Z") / 1000);
  assert.equal(parseHealthDate("gestern"), null);
  assert.equal(parseHealthDate(42), null);
});

test("Parser: Einheiten umrechnen, Unbekanntes melden, Unplausibles verwerfen", () => {
  const result = parseHealthExport(
    exportOf(
      { name: "weight_body_mass", units: "lb", data: [{ qty: 180, date: "2026-11-01 07:00:00 +0100", source: "Waage" }] },
      { name: "body_fat_percentage", units: "%", data: [{ qty: 0.18, date: "2026-11-01 07:00:00 +0100" }] },
      { name: "resting_heart_rate", units: "count/min", data: [{ qty: 52, date: "2026-11-01 00:00:00 +0100" }, { qty: 900, date: "2026-11-02 00:00:00 +0100" }] },
      { name: "active_energy", units: "kJ", data: [{ qty: 4184, date: "2026-11-01 00:00:00 +0100" }] },
      { name: "sleep_analysis", units: "hr", data: [{ totalSleep: 7.5, sleepEnd: "2026-11-01 06:45:00 +0100", source: "Watch" }] },
      { name: "lean_body_mass", units: "oz", data: [{ qty: 1, date: "2026-11-01 07:00:00 +0100" }] },
      { name: "dietary_water", units: "mL", data: [{ qty: 1, date: "2026-11-01 07:00:00 +0100" }] },
      { name: "step_count", units: "count", data: [{ qty: 100, date: "kaputt" }] },
    ),
  );
  const by = Object.fromEntries(result.points.map((p) => [p.metric, p]));
  assert.equal(by.weight.value, 81.65);
  assert.equal(by.weight.source, "Waage");
  assert.equal(by.body_fat.value, 18);
  assert.equal(by.resting_hr.value, 52);
  assert.equal(by.active_energy.value, 1000);
  assert.equal(by.sleep.value, 7.5);
  assert.deepEqual(result.ignored, ["dietary_water"]);
  assert.deepEqual(result.badUnits, ["lean_body_mass (oz)"]);
  // Ruhepuls 900 und das kaputte Datum.
  assert.equal(result.rejected, 2);
  assert.deepEqual(parseHealthExport("Unsinn").points, []);
});

test("Import: Schlüssel nur für das eigene Konto, wiederholter Export doppelt nichts", async () => {
  const user = await makeUser("Nia", { bodyweightKg: 80 });
  assert.equal(await body.authenticateHealthToken("gymh_falsch"), null);
  const token = await body.createHealthToken(user);
  assert.match(token, /^gymh_/);
  assert.equal((await body.authenticateHealthToken(token))?.id, user.id);
  // Der MCP-Schlüssel-Präfix kommt hier nicht rein.
  assert.equal(await body.authenticateHealthToken(token.replace("gymh_", "gym_")), null);

  const payload = exportOf(
    { name: "weight_body_mass", units: "kg", data: [
      { qty: 79.4, date: "2026-11-10 07:00:00 +0100" },
      { qty: 78.9, date: "2026-11-12 07:00:00 +0100" },
    ] },
    { name: "step_count", units: "count", data: [
      { qty: 4000, date: "2026-11-12 09:00:00 +0100" },
      { qty: 3000, date: "2026-11-12 18:00:00 +0100" },
    ] },
  );
  const first = await body.importHealthExport(user, payload);
  assert.equal(first.imported, 4);
  assert.equal(first.bodyweightKg, 78.9);
  await body.importHealthExport(user, payload);

  const rows = await db.select().from(schema.bodyMetrics).where(eq(schema.bodyMetrics.userId, user.id));
  assert.equal(rows.length, 4);
  const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(stored.bodyweightKg, 78.9);
  assert.ok(stored.healthImportedAt);

  // Schritte als Tagessumme.
  const series = await body.bodyMetricSeries(user.id, 0);
  const steps = series.find((s) => s.metric === "steps")!;
  assert.equal(steps.points.length, 1);
  assert.equal(steps.points[0].value, 7000);
  const tiles = bodyMetricSummary(series);
  assert.equal(tiles[0].metric, "weight");
  assert.equal(tiles[0].value, "78,9 kg");

  // Widerrufen sperrt den Schlüssel.
  await body.revokeHealthToken(stored);
  assert.equal(await body.authenticateHealthToken(token), null);
});

test("Import: ohne Gewicht im Export bleibt das Körpergewicht", async () => {
  const user = await makeUser("Ole", { bodyweightKg: 90 });
  const summary = await body.importHealthExport(user, exportOf({ name: "hrv", units: "ms", data: [] }));
  assert.equal(summary.bodyweightKg, null);
  const [stored] = await db.select().from(schema.users).where(eq(schema.users.id, user.id));
  assert.equal(stored.bodyweightKg, 90);
});
