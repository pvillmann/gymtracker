import assert from "node:assert/strict";
import { createServer } from "node:http";
import { after, test } from "node:test";

import { makeUser, setupDb } from "./helpers/db";

// Lokaler Ersatz für die Anthropic-API – das SDK liest ANTHROPIC_BASE_URL.
const calls: Array<Record<string, unknown>> = [];
const server = createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on("data", (c) => chunks.push(c));
  req.on("end", () => {
    const raw = Buffer.concat(chunks).toString();
    res.setHeader("content-type", "application/json");
    if (req.url?.startsWith("/v1/models/")) {
      res.writeHead(200).end(JSON.stringify({ type: "model", id: "claude-haiku-5-5", display_name: "Haiku", created_at: "2026-01-01T00:00:00Z" }));
      return;
    }
    calls.push(JSON.parse(raw));
    const answer = {
      feedback: "Solide Woche beim Essen, Eiweiß bleibt aber knapp.",
      actions: ["Zu jeder Mahlzeit eine Eiweißquelle.", "Zweite Regel.", "Dritte wird abgeschnitten."],
    };
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
const { logMeal } = await import("@/lib/services/nutrition");
const review = await import("@/lib/services/weekly-review");

const DAY = 86_400;

async function reload(id: string) {
  const [user] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  return user;
}

async function eatLastWeek(user: Awaited<ReturnType<typeof makeUser>>) {
  const start = review.lastWeekStart();
  for (let i = 0; i < 4; i++) {
    await logMeal(user, { description: `Tag ${i}`, kcal: 2200, proteinG: 80, eatenAt: start + i * DAY + 12 * 3600 });
  }
}

test("Ohne Daten: leerer Rückblick, kein Aufruf", async () => {
  const user = await makeUser("Ole");
  const result = await review.ensureWeeklyReview(user);
  assert.equal(result.status, "empty");
});

test("Ohne Schlüssel: Regeln, gespeichert und beim zweiten Mal gleich", async () => {
  const user = await makeUser("Pia");
  await eatLastWeek(user);
  const first = await review.ensureWeeklyReview(user);
  assert.equal(first.status, "rules");
  assert.equal(first.facts.nutrition.loggedDays, 4);
  assert.equal(first.facts.nutrition.avgKcal, 2200);
  assert.equal(first.facts.nutrition.avgProteinG, 80);
  assert.equal(first.facts.nutrition.daysBelowProtein, 4, "80 g liegt unter dem Eiweißziel");
  assert.ok(first.hints.some((h) => h.kind === "nutrition"));
  // Neue Mahlzeit ändert den gespeicherten Rückblick nicht mehr.
  await logMeal(user, { description: "spät", kcal: 500, eatenAt: review.lastWeekStart() + 5 * DAY });
  const second = await review.ensureWeeklyReview(user);
  assert.deepEqual(second.facts, first.facts);
});

test("Mit Schlüssel: Haiku einmal gefragt, höchstens zwei Korrekturen, keine persönlichen Daten", async () => {
  const user = await makeUser("Quirin");
  await ai.setAnthropicKey(user, "sk-ant-test");
  const keyed = await reload(user.id);
  await eatLastWeek(keyed);
  const before = calls.length;

  const [a, b] = await Promise.all([review.ensureWeeklyReview(keyed), review.ensureWeeklyReview(keyed)]);
  assert.ok([a.status, b.status].includes("pending"));

  let done = a;
  for (let i = 0; i < 100 && done.status !== "ok"; i++) {
    await new Promise((r) => setTimeout(r, 20));
    done = await review.ensureWeeklyReview(keyed);
  }
  assert.equal(done.status, "ok");
  assert.match(done.feedback ?? "", /Eiweiß/);
  assert.equal(done.actions.length, 2);
  assert.equal(calls.length - before, 1, "nur ein Aufruf trotz zwei gleichzeitiger Seitenaufrufe");

  const sent = JSON.stringify(calls.at(-1));
  assert.ok(!sent.includes("Quirin"));
  assert.ok(!sent.includes(keyed.email));
});
