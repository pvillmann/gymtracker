import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

// Lokaler Ersatz für die Anthropic-API – das SDK liest ANTHROPIC_BASE_URL.
const seen: Array<{ path: string; key: string; body: Record<string, unknown> | null }> = [];
let answer: Record<string, unknown> = { weight: 107.3, reps: [8, 8, 8], reason: "Gute Serie – weiter so." };
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    // SDK 1.x schickt den Schlüssel als Bearer-Token.
    const key = String(req.headers.authorization ?? "").replace(/^Bearer /, "");
    const raw = Buffer.concat(chunks).toString();
    seen.push({ path: req.url ?? "", key, body: raw ? JSON.parse(raw) : null });
    res.setHeader("content-type", "application/json");
    if (key !== "sk-ant-gut") {
      res.writeHead(401).end(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }));
      return;
    }
    if (req.url?.startsWith("/v1/models/")) {
      res.writeHead(200).end(JSON.stringify({ type: "model", id: "claude-haiku-5-5", display_name: "Haiku", created_at: "2026-01-01T00:00:00Z" }));
      return;
    }
    res.writeHead(200).end(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: "claude-haiku-5-5",
        content: [{ type: "text", text: JSON.stringify(answer) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
after(() => server.close());

const { db, schema } = await setupDb();
const { eq } = await import("drizzle-orm");
const ai = await import("@/lib/services/ai-suggestions");
const { createExercise } = await import("@/lib/services/exercises");
const { startWorkout } = await import("@/lib/services/workouts");

async function reload(id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

async function waitFor<T>(read: () => Promise<T | undefined>): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const value = await read();
    if (value !== undefined) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error("Zeitüberschreitung");
}

test("Schlüssel: abgelehnter wird nicht gespeichert, guter nur verschlüsselt", async () => {
  const user = await makeUser("Kai");
  await assert.rejects(ai.setAnthropicKey(user, "sk-ant-falsch"), /abgelehnt/);
  assert.equal((await reload(user.id)).anthropicKeyEnc, null);

  await ai.setAnthropicKey(user, "  sk-ant-gut ");
  const stored = await reload(user.id);
  assert.ok(stored.anthropicKeyEnc);
  assert.ok(!stored.anthropicKeyEnc.includes("sk-ant-gut"));
  assert.equal(stored.aiSuggestions, true);
  assert.equal(ai.keyHint(stored), "…-gut");
  assert.equal(ai.aiEnabled(stored), true);

  await ai.setAiSuggestions(stored, false);
  assert.equal(ai.aiEnabled(await reload(user.id)), false);

  await ai.setAnthropicKey(stored, null);
  const cleared = await reload(user.id);
  assert.equal(cleared.anthropicKeyEnc, null);
  await assert.rejects(ai.setAiSuggestions(cleared, true), /Erst einen API-Schlüssel/);
});

test("Vorschlag: wird einmal angefragt, geklammert und gespeichert", async () => {
  const user = await makeUser("Lea");
  await ai.setAnthropicKey(user, "sk-ant-gut");
  const keyed = await reload(user.id);
  const exerciseId = await createExercise(keyed, { name: "Kniebeuge KI", trackingMode: "weight_reps" } as never);
  const { workoutId } = await startWorkout(keyed, null);

  const request = {
    exerciseId,
    name: "Kniebeuge KI",
    mode: "weight_reps" as const,
    unit: "kg" as const,
    step: 2.5,
    target: { sets: 3, repsMin: 8, repsMax: 10 },
    notes: null,
    rule: { kind: "increase" as const, weight: 102.5, reps: [8, 8, 8], reason: "Regel" },
    previousWeight: 100,
  };
  const before = seen.length;
  ai.requestAiSuggestions(keyed, workoutId, [request]);
  ai.requestAiSuggestions(keyed, workoutId, [request]);
  const cached = await waitFor(async () => (await ai.cachedAiSuggestions(workoutId)).get(exerciseId));

  const calls = seen.slice(before).filter((s) => s.path === "/v1/messages");
  assert.equal(calls.length, 1, "doppelte Anfrage wird zusammengefasst");
  assert.equal(calls[0].body?.model, "claude-haiku-5-5");
  // 107,3 liegt über Regel + 1 Sprung: auf 105 begrenzt.
  assert.equal(cached.status, "ok");
  assert.equal(cached.weight, 105);
  assert.deepEqual(cached.reps, [8, 8, 8]);
  // Keine persönlichen Daten in der Anfrage.
  const sent = JSON.stringify(calls[0].body);
  assert.ok(!sent.includes(keyed.email));
  assert.ok(!sent.includes("Lea"));
});

test("Vorschlag: kaputte Antwort wird als fehlgeschlagen vermerkt", async () => {
  const user = await makeUser("Mo");
  await ai.setAnthropicKey(user, "sk-ant-gut");
  const keyed = await reload(user.id);
  const exerciseId = await createExercise(keyed, { name: "Rudern KI", trackingMode: "weight_reps" } as never);
  const { workoutId } = await startWorkout(keyed, null);
  answer = { gewicht: "viel" };
  ai.requestAiSuggestions(keyed, workoutId, [
    {
      exerciseId,
      name: "Rudern KI",
      mode: "weight_reps",
      unit: "kg",
      step: 5,
      target: null,
      notes: null,
      rule: { kind: "reps", weight: 50, reps: [10], reason: "Regel" },
      previousWeight: 50,
    },
  ]);
  const cached = await waitFor(async () => (await ai.cachedAiSuggestions(workoutId)).get(exerciseId));
  assert.equal(cached.status, "failed");
});
