import assert from "node:assert/strict";
import { test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

await setupDb();
const scale = await import("@/lib/services/scale");

test("Waagen-Mitschnitt: anlegen, fortschreiben, nur das eigene Konto", async () => {
  const anna = await makeUser("Waage-Anna");
  const ben = await makeUser("Waage-Ben");
  const first = [{ t: 0, type: "start" }, { t: 120, type: "notify", c: "0000fff1", hex: "10 0b 15 1f" }];
  const id = await scale.saveScaleCapture(anna, { id: null, deviceName: "QN-Scale", client: "Bluefy", events: first });
  const again = await scale.saveScaleCapture(anna, {
    id,
    deviceName: "QN-Scale",
    client: "Bluefy",
    events: [...first, { t: 300, type: "stop" }],
  });
  assert.equal(again, id);
  const [capture] = await scale.listScaleCaptures(anna.id);
  assert.equal(capture.events.length, 3);
  assert.equal(capture.events[1].hex, "10 0b 15 1f");

  // Fremde ID: Ben überschreibt nichts, sondern bekommt einen eigenen Mitschnitt.
  const own = await scale.saveScaleCapture(ben, { id, deviceName: null, client: null, events: first });
  assert.notEqual(own, id);
  assert.equal((await scale.listScaleCaptures(anna.id))[0].events.length, 3);
});

test("Waagen-Mitschnitt: Form und Größe werden geprüft", async () => {
  const user = await makeUser("Waage-Grenzen");
  await assert.rejects(scale.saveScaleCapture(user, { events: "kaputt" }), /ungültige/i);
  await assert.rejects(scale.saveScaleCapture(user, { events: [{ type: "x" }] }), /ohne Zeit/);
  await assert.rejects(
    scale.saveScaleCapture(user, { events: Array.from({ length: 3001 }, (_, t) => ({ t, type: "notify" })) }),
    /Zu viele/,
  );
  // Fremde Felder und Objekte werden verworfen, lange Texte gekürzt.
  await scale.saveScaleCapture(user, {
    events: [{ t: 1, type: "notify", hex: "a".repeat(5000), nested: { evil: true } }],
  });
  const [capture] = await scale.listScaleCaptures(user.id);
  assert.equal((capture.events[0].hex as string).length, 600);
  assert.equal("nested" in capture.events[0], false);
});
