import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import Database from "better-sqlite3";

import { makeUser, setupDb } from "./helpers/db";

const { db, schema } = await setupDb();
const { eq } = await import("drizzle-orm");
const scale = await import("@/lib/services/scale");
const body = await import("@/lib/services/body-metrics");

/** Migration 0027 noch einmal von Hand ausführen – wie beim Deploy. */
function runBackfill() {
  const sqlite = new Database(process.env.DATABASE_PATH!);
  for (const statement of readFileSync("drizzle/0027_backfill_scale_measurements.sql", "utf8").split("--> statement-breakpoint")) {
    sqlite.exec(statement);
  }
  sqlite.close();
}

test("Nachtragen: Messung aus dem Mitschnitt landet einmal im Verlauf", async () => {
  const user = await makeUser("Nachtrag");
  // Mitschnitt wie am 18.11.: Messung 12,9 s nach Beginn, 105,3 kg, 505 Ω.
  await scale.saveScaleCapture(user, {
    deviceName: "QN-Scale",
    events: [
      { t: 0, type: "start" },
      { t: 12893, type: "measurement", kg: 105.3, r1: 505, r2: 505 },
    ],
  });
  runBackfill();
  runBackfill();
  const rows = await db.select().from(schema.bodyMetrics).where(eq(schema.bodyMetrics.userId, user.id));
  assert.deepEqual(rows.map((r) => [r.metric, r.value, r.source]).sort(), [
    ["impedance", 505, "Waage"],
    ["weight", 105.3, "Waage"],
  ]);
  assert.equal(rows[0].measuredAt, rows[1].measuredAt);
});

test("Nachtragen: schon gespeicherte Messungen werden nicht verdoppelt", async () => {
  const user = await makeUser("Schon-da");
  await body.recordScaleMeasurement(user, { weightKg: 99.9, impedance: 480 });
  await scale.saveScaleCapture(user, {
    events: [{ t: 0, type: "start" }, { t: 9000, type: "measurement", kg: 99.9, r1: 480, r2: 480 }],
  });
  runBackfill();
  const rows = await db.select().from(schema.bodyMetrics).where(eq(schema.bodyMetrics.userId, user.id));
  assert.equal(rows.length, 2);
});
