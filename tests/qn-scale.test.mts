import assert from "node:assert/strict";
import { test } from "node:test";

import { checksum, configFrame, fromHex, parseFrame, timeFrameFfe4, timeSyncFrame, toHex } from "@/lib/qn-scale";

test("QN: echter Info-Frame der Feelfit-Waage (Mitschnitt 17.11.)", () => {
  const frame = fromHex("12 0f 15 0c 77 c7 38 c1 a4 38 01 38 00 00 8e");
  assert.equal(checksum(frame, 14), 0x8e);
  assert.deepEqual(parseFrame(frame), { kind: "info", protocol: 0x15, divisor: 100 });
  // Byte 13 zählt hoch, die Prüfsumme mit.
  assert.equal(parseFrame(fromHex("12 0f 15 0c 77 c7 38 c1 a4 38 01 38 00 02 90")).kind, "info");
  assert.equal(parseFrame(fromHex("12 0f 15 0c 77 c7 38 c1 a4 38 01 38 00 02 91")).kind, "invalid");
});

test("QN: Antworten an die Waage", () => {
  // Beispiel aus der Protokollbeschreibung (Protokoll 0xff, kg).
  assert.equal(toHex(configFrame(0xff)), "13 09 ff 01 10 00 00 00 2c");
  assert.equal(toHex(configFrame(0x15)), "13 09 15 01 10 00 00 00 42");
  // 2000-01-01 00:00:10 UTC → 10 Sekunden, little endian.
  const t = new Date(Date.UTC(2000, 0, 1, 0, 0, 10));
  assert.equal(toHex(timeFrameFfe4(t)), "02 0a 00 00 00");
  assert.equal(toHex(timeSyncFrame(0x15, t)), "20 08 15 0a 00 00 00 47");
});

test("QN: Gewichtsframe – live und stabil", () => {
  // 0x1f2c = 7980 → 79,80 kg, Byte 5 = stabil.
  const live = [0x10, 0x0b, 0x15, 0x1f, 0x2c, 0x00, 0x01, 0xf4, 0x02, 0x58];
  const frame = (bytes: number[]) => Uint8Array.from([...bytes, checksum(bytes)]);
  assert.deepEqual(parseFrame(frame(live)), { kind: "weight", kg: 79.8, stable: false, resistance1: 500, resistance2: 600 });
  const stable = [...live];
  stable[5] = 1;
  assert.equal((parseFrame(frame(stable)) as { stable: boolean }).stable, true);
});
