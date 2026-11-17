import assert from "node:assert/strict";
import { test } from "node:test";

import { describeSet, describeWeight } from "@/lib/describe";
import { formatDuration, formatKg, parseDurationInput } from "@/lib/format";
import { safeNextPath } from "@/lib/formdata";
import { FailureLimiter } from "@/lib/rate-limit";
import { effectiveLoad, setVolume } from "@/lib/training";

test("Volumen: Gewicht × Wiederholungen", () => {
  assert.equal(setVolume("weight_reps", 40, 10, 80), 400);
});

test("Volumen: Körpergewicht zählt mit, Gegengewicht wird abgezogen", () => {
  assert.equal(setVolume("bodyweight_reps", 10, 5, 80), 450);
  assert.equal(setVolume("assisted_reps", 30, 5, 80), 250);
  // Mehr Hilfe als Körpergewicht: null, nicht negativ.
  assert.equal(effectiveLoad("assisted_reps", 100, 80), 0);
});

test("Volumen: Zeit-Übungen und Stufen zählen nicht", () => {
  assert.equal(setVolume("time", 0, 600, 80), 0);
  assert.equal(setVolume("weight_reps", 8, 12, 80, { loadFactor: 1, baseLoadKg: 0, level: true }), 0);
});

test("Volumen: Übersetzung, Eigengewicht und Gewicht je Seite", () => {
  // 2:1-Kabelzug: halbe Last.
  assert.equal(setVolume("weight_reps", 40, 10, 80, { loadFactor: 0.5, baseLoadKg: 0 }), 200);
  // Beinpresse mit Schlitten.
  assert.equal(setVolume("weight_reps", 100, 10, 80, { loadFactor: 1, baseLoadKg: 40 }), 1400);
  // Getrennte Arme: das Doppelte.
  assert.equal(setVolume("weight_reps", 40, 10, 80, { loadFactor: 1, baseLoadKg: 0, perSide: true }), 800);
  // Übersetzung gilt nicht für Körpergewichts-Übungen.
  assert.equal(setVolume("bodyweight_reps", 0, 10, 80, { loadFactor: 0.5, baseLoadKg: 20 }), 800);
});

test("Anzeige: Stufen und je Seite", () => {
  assert.equal(describeWeight(40, { perSide: true }), "40 kg/Seite");
  assert.equal(describeWeight(8, { level: true }), "Stufe 8");
  assert.equal(describeWeight(42.5, null), "42,5 kg");
  assert.match(describeSet({ weightKg: 40, reps: 10 } as never, "weight_reps", { perSide: true }), /40 kg\/Seite/);
});

test("Format: kg und Dauer", () => {
  assert.equal(formatKg(42.5), "42,5");
  // Sprünge von 1,25 kg dürfen nicht auf 41,3 gerundet werden – das Feld
  // wird damit vorbelegt und so gespeichert.
  assert.equal(formatKg(41.25), "41,25");
  assert.equal(formatKg(42.504), "42,5");
  assert.equal(formatDuration(630), "10:30");
  assert.equal(formatDuration(3725), "1:02:05");
  assert.equal(parseDurationInput("10:30"), 630);
  assert.equal(parseDurationInput("45"), 45);
  assert.equal(parseDurationInput("quatsch"), 0);
});

test("Login-Ziel: nur Pfade dieser Instanz", () => {
  assert.equal(safeNextPath("/p/abc"), "/p/abc");
  for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "", null, "/a b", "/\nx"]) {
    assert.equal(safeNextPath(bad), null, String(bad));
  }
});

test("Fehlversuche: sperrt nach dem Limit, gibt nach dem Fenster frei", () => {
  const limiter = new FailureLimiter(3, 1000);
  for (let i = 0; i < 3; i++) limiter.fail("a", 100 * i);
  assert.ok(limiter.retryAfter("a", 250) > 0);
  assert.equal(limiter.retryAfter("b", 250), 0);
  assert.equal(limiter.retryAfter("a", 1001), 0);
  limiter.fail("c", 0);
  limiter.reset("c");
  assert.equal(limiter.retryAfter("c", 1), 0);
});

import { weeklySetsByMuscle } from "@/lib/stats";

test("Arbeitssätze pro Muskelgruppe: diese Woche und Schnitt der vier Wochen davor", () => {
  const now = new Date(2026, 10, 18, 12); // Mittwoch
  const at = (daysAgo: number) => Math.floor(now.getTime() / 1000) - daysAgo * 86_400;
  const rows = [
    { muscleGroup: "Brust", completedAt: at(0) },
    { muscleGroup: "Brust", completedAt: at(1) },
    { muscleGroup: "Brust", completedAt: at(8) },
    { muscleGroup: "Brust", completedAt: at(15) },
    { muscleGroup: "Rücken", completedAt: at(9) },
    { muscleGroup: null, completedAt: at(0) },
    { muscleGroup: "Beine", completedAt: at(60) }, // zu alt
  ];
  const result = weeklySetsByMuscle(rows, now);
  assert.deepEqual(result.find((m) => m.group === "Brust"), { group: "Brust", thisWeek: 2, average: 0.5 });
  assert.deepEqual(result.find((m) => m.group === "Rücken"), { group: "Rücken", thisWeek: 0, average: 0.25 });
  assert.equal(result.find((m) => m.group === "Ohne Muskelgruppe")?.thisWeek, 1);
  assert.equal(result.some((m) => m.group === "Beine"), false);
});
