import assert from "node:assert/strict";
import { test } from "node:test";

import { defaultStep, suggestNext } from "@/lib/progression";

const target = { repsMin: 8, repsMax: 12 };
const sets = (weight: number, ...reps: number[]) => reps.map((r) => ({ weightKg: weight, reps: r }));

test("Alle Sätze am oberen Ende: Gewicht hoch, Wiederholungen unten", () => {
  const s = suggestNext({ mode: "weight_reps", previous: sets(60, 12, 12, 12), lastEffort: "ok", target, step: 2.5 });
  assert.equal(s?.kind, "increase");
  assert.equal(s?.weight, 62.5);
  assert.deepEqual(s?.reps, [8, 8, 8]);
});

test("Noch nicht oben: gleiches Gewicht, +1 Wiederholung bis zum Maximum", () => {
  const s = suggestNext({ mode: "weight_reps", previous: sets(60, 12, 11, 9), lastEffort: "ok", target, step: 2.5 });
  assert.equal(s?.kind, "reps");
  assert.equal(s?.weight, 60);
  assert.deepEqual(s?.reps, [12, 12, 10]);
});

test("Am Limit: nichts steigern", () => {
  const s = suggestNext({ mode: "weight_reps", previous: sets(60, 12, 12, 12), lastEffort: "max", target, step: 2.5 });
  assert.equal(s?.kind, "hold");
  assert.equal(s?.weight, 60);
});

test("Leicht: auch knapp unter dem Ziel steigern", () => {
  const s = suggestNext({ mode: "weight_reps", previous: sets(60, 12, 11, 11), lastEffort: "easy", target, step: 2.5 });
  assert.equal(s?.kind, "increase");
  assert.equal(s?.weight, 62.5);
});

test("Großer Sprung (> 10 %): erst zwei Wiederholungen über das Ziel", () => {
  const first = suggestNext({ mode: "weight_reps", previous: sets(30, 12, 12), lastEffort: "ok", target, step: 5 });
  assert.equal(first?.kind, "reps");
  assert.deepEqual(first?.reps, [13, 13]);
  const then = suggestNext({ mode: "weight_reps", previous: sets(30, 14, 14), lastEffort: "ok", target, step: 5 });
  assert.equal(then?.kind, "increase");
  assert.equal(then?.weight, 35);
});

test("Gegengewicht: Steigerung heißt weniger Hilfe, nie unter 0", () => {
  const s = suggestNext({ mode: "assisted_reps", previous: sets(20, 10, 10), lastEffort: "ok", target: { repsMin: 6, repsMax: 10 }, step: 5 });
  assert.equal(s?.kind, "increase");
  assert.equal(s?.weight, 15);
  const floor = suggestNext({ mode: "assisted_reps", previous: sets(2.5, 10, 10), lastEffort: "ok", target: { repsMin: 6, repsMax: 10 }, step: 5 });
  assert.equal(floor?.weight, 0);
});

test("Körpergewicht ohne Zusatz: nur Wiederholungen", () => {
  const s = suggestNext({ mode: "bodyweight_reps", previous: sets(0, 12, 12), lastEffort: "easy", target, step: 2.5 });
  assert.equal(s?.kind, "reps");
});

test("Ohne Plan und ohne Einschätzung: kein Vorschlag; Zeit-Übungen nie", () => {
  assert.equal(suggestNext({ mode: "weight_reps", previous: sets(60, 10), lastEffort: "ok", target: null, step: 2.5 }), null);
  assert.equal(suggestNext({ mode: "time", previous: sets(0, 1), lastEffort: "easy", target, step: 1 }), null);
  assert.equal(suggestNext({ mode: "weight_reps", previous: [], lastEffort: null, target, step: 2.5 }), null);
});

test("Stufen: Sprung 1 und passender Text", () => {
  const s = suggestNext({ mode: "weight_reps", previous: sets(8, 12, 12), lastEffort: "ok", target, step: 1, level: true });
  assert.equal(s?.weight, 9);
  assert.match(s?.reason ?? "", /1 Stufe/);
});

test("Standard-Sprung nach Geräteart", () => {
  assert.equal(defaultStep({ kind: "plates", perSide: true }), 1.25);
  assert.equal(defaultStep({ kind: "plates" }), 2.5);
  assert.equal(defaultStep({ kind: "stack" }), 5);
  assert.equal(defaultStep({ kind: "stack", loadUnit: "level" }), 1);
  assert.equal(defaultStep({ kind: "free" }), 2);
  assert.equal(defaultStep({ kind: "stack", progressionStep: 2.5 }), 2.5);
  assert.equal(defaultStep(null), 2.5);
});
