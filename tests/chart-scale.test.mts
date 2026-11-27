import assert from "node:assert/strict";
import { test } from "node:test";

import { niceScale } from "@/lib/chart-scale";

test("Achse: runde Schritte statt krummer Hälften (#74)", () => {
  // Volumen: vorher 0 / 2053 / 4105.
  assert.deepEqual(niceScale(4105), { max: 6000, ticks: [0, 2000, 4000, 6000] });
  assert.deepEqual(niceScale(3800), { max: 4000, ticks: [0, 2000, 4000] });
  // Zählwerte: vorher 0 / 1 / 1 – jetzt keine halben Schritte und keine doppelte Beschriftung.
  assert.deepEqual(niceScale(1, { integer: true }), { max: 1, ticks: [0, 1] });
  assert.deepEqual(niceScale(4, { integer: true }), { max: 4, ticks: [0, 2, 4] });
  // Leere Daten: trotzdem eine gültige Achse.
  assert.deepEqual(niceScale(0, { integer: true }), { max: 1, ticks: [0, 1] });
  for (const value of [7, 95, 250, 1234, 18300]) {
    const { max, ticks } = niceScale(value);
    assert.ok(max >= value && ticks.length <= 5 && new Set(ticks).size === ticks.length, String(value));
  }
});
