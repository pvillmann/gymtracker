import "server-only";

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import { users, workoutAiSuggestions, type TrackingMode, type User } from "@/db/schema";
import { clampAiSuggestion, type Suggestion } from "@/lib/progression";
import { getExerciseSessions } from "@/lib/queries";
import { open, seal } from "@/lib/secret-box";
import { ServiceError } from "@/lib/services/errors";

/**
 * Optionale Progressionsvorschläge von Claude Haiku. Jedes Konto bringt
 * seinen eigenen API-Schlüssel mit; ohne Schlüssel oder bei einem Fehler
 * gilt still die Regel aus lib/progression.ts.
 *
 * Datenschutz: Eingeschaltet gehen Name der Übung, Zielbereich, die
 * letzten drei Trainings an der Maschine und das letzte Training der Übung
 * an einer anderen Maschine an die Anthropic-API – sonst nichts.
 */

export const AI_MODEL = "claude-haiku-5-5";

function client(apiKey: string): Anthropic {
  // Kurze Wartezeit, wenig Wiederholungen: lieber die Regel als ein hängender Vorschlag.
  return new Anthropic({ apiKey, timeout: 20_000, maxRetries: 1 });
}

/** Speichert (verschlüsselt) oder löscht den Schlüssel; prüft ihn vorher. */
export async function setAnthropicKey(user: User, rawKey: string | null): Promise<void> {
  const key = rawKey?.trim() ?? "";
  if (!key) {
    await db.update(users).set({ anthropicKeyEnc: null, aiSuggestions: false }).where(eq(users.id, user.id));
    return;
  }
  try {
    await client(key).models.retrieve(AI_MODEL);
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
      throw new ServiceError("Der Schlüssel wurde abgelehnt. Bitte prüfen.");
    }
    if (error instanceof Anthropic.APIConnectionError) {
      throw new ServiceError("Die Anthropic-API ist von diesem Server aus nicht erreichbar.");
    }
    throw new ServiceError("Der Schlüssel ließ sich nicht prüfen. Später noch einmal versuchen.");
  }
  await db.update(users).set({ anthropicKeyEnc: seal(key), aiSuggestions: true }).where(eq(users.id, user.id));
}

export async function setAiSuggestions(user: User, enabled: boolean): Promise<void> {
  if (enabled && !user.anthropicKeyEnc) throw new ServiceError("Erst einen API-Schlüssel hinterlegen.");
  await db.update(users).set({ aiSuggestions: enabled }).where(eq(users.id, user.id));
}

/** Die letzten vier Zeichen – zum Wiedererkennen, nie der ganze Schlüssel. */
export function keyHint(user: User): string | null {
  if (!user.anthropicKeyEnc) return null;
  const key = open(user.anthropicKeyEnc);
  return key ? `…${key.slice(-4)}` : "nicht lesbar – bitte neu eintragen";
}

/** Anthropic-Client mit dem Schlüssel des Kontos – null ohne (lesbaren) Schlüssel. */
export function anthropicFor(user: User): Anthropic | null {
  const key = user.anthropicKeyEnc ? open(user.anthropicKeyEnc) : null;
  return key ? client(key) : null;
}

export function aiEnabled(user: User): boolean {
  return user.aiSuggestions && Boolean(user.anthropicKeyEnc);
}

/** Gespeicherte Vorschläge eines Trainings, je Variante. */
export async function cachedAiSuggestions(
  workoutId: string,
): Promise<Map<string, { status: "ok" | "failed"; weight: number | null; reps: number[]; reason: string | null }>> {
  const rows = await db.select().from(workoutAiSuggestions).where(eq(workoutAiSuggestions.workoutId, workoutId));
  return new Map(
    rows.map((r) => [
      r.exerciseId,
      { status: r.status, weight: r.weight, reps: r.reps ? (JSON.parse(r.reps) as number[]) : [], reason: r.reason },
    ]),
  );
}

export type AiRequest = {
  exerciseId: string;
  name: string;
  mode: TrackingMode;
  unit: "kg" | "kg je Seite" | "Stufen";
  step: number;
  target: { sets: number; repsMin: number; repsMax: number } | null;
  notes: string | null;
  rule: Suggestion;
  previousWeight: number;
  /**
   * Das letzte Training der Übung an einer anderen Maschine, falls jünger
   * als das letzte hier – zeigt, dass keine Pause war (#68). Die Kilos sind
   * dort andere und taugen nicht als Vergleich.
   */
  elsewhere: { machine: string; performedAt: number; sets: Array<{ weightKg: number; reps: number }> } | null;
};

const AiAnswer = z.object({
  weight: z.number().describe("Gewicht für alle Arbeitssätze heute, in der Einheit der Maschine"),
  reps: z.array(z.number().int()).describe("Ziel-Wiederholungen je Arbeitssatz"),
  reason: z.string().describe("Ein kurzer deutscher Satz, warum – höchstens 140 Zeichen"),
});

const SYSTEM = [
  "Du bist ein nüchterner Krafttrainer und schlägst für EINE Übung das heutige Arbeitsgewicht vor.",
  "Grundlage ist doppelte Progression: erst Wiederholungen bis zum oberen Ende des Zielbereichs, dann ein Gewichtssprung.",
  "Der Regelvorschlag ist ein solider Ausgangspunkt. Weiche nur ab, wenn der Verlauf es nahelegt:",
  "Stillstand über mehrere Trainings (dann Deload um 1–2 Sprünge), lange Pause in der Übung,",
  "Einschätzung „am Limit“ oder eine Notiz (z. B. Schmerzen).",
  "Eine Pause zählt nur, wenn die Übung insgesamt lange nicht trainiert wurde: Steht unter",
  "„zuletzt_an_anderer_maschine“ ein jüngeres Training, war keine Pause – nur die Maschine war eine andere.",
  "Deren Kilos sind nicht vergleichbar; das Gewicht kommt allein aus dem Verlauf dieser Maschine.",
  "Gewichte nur in ganzen Sprüngen der angegebenen Größe. Bei Gegengewicht ist WENIGER Gewicht die Steigerung.",
  "Antworte ausschließlich im vorgegebenen Format.",
].join(" ");

/** Laufende Anfragen, damit derselbe Vorschlag nicht doppelt angefragt wird. */
const inflight = new Set<string>();

/**
 * Fragt fehlende Vorschläge im Hintergrund an und speichert sie. Wird nicht
 * abgewartet – die Seite zeigt solange den Regelvorschlag.
 */
export function requestAiSuggestions(user: User, workoutId: string, requests: AiRequest[]): void {
  const key = user.anthropicKeyEnc ? open(user.anthropicKeyEnc) : null;
  if (!key) return;
  for (const request of requests) {
    const id = `${workoutId}:${request.exerciseId}`;
    if (inflight.has(id)) continue;
    inflight.add(id);
    void generate(user, key, workoutId, request).finally(() => inflight.delete(id));
  }
}

async function generate(user: User, apiKey: string, workoutId: string, request: AiRequest): Promise<void> {
  const sessions = (await getExerciseSessions(user.id, request.exerciseId, 4))
    .filter((s) => s.workoutId !== workoutId)
    .slice(0, 3)
    .map((s) => ({
      datum: new Date(s.performedAt * 1000).toISOString().slice(0, 10),
      saetze: s.sets
        .filter((set) => !set.isWarmup)
        .map((set) => ({ gewicht: set.weightKg, wdh: set.reps, einschaetzung: set.effort })),
    }));

  const input = {
    heute: new Date().toISOString().slice(0, 10),
    uebung: request.name,
    messart: request.mode,
    einheit: request.unit,
    sprung: request.step,
    ziel: request.target,
    notiz: request.notes,
    letzte_trainings: sessions,
    zuletzt_an_anderer_maschine: request.elsewhere
      ? {
          maschine: request.elsewhere.machine,
          datum: new Date(request.elsewhere.performedAt * 1000).toISOString().slice(0, 10),
          saetze: request.elsewhere.sets.map((set) => ({ gewicht: set.weightKg, wdh: set.reps })),
          hinweis: "andere Maschine – Kilos nicht vergleichbar, zeigt nur, dass trainiert wurde",
        }
      : null,
    regelvorschlag: { gewicht: request.rule.weight, wdh: request.rule.reps, grund: request.rule.reason },
  };

  let row: typeof workoutAiSuggestions.$inferInsert = { workoutId, exerciseId: request.exerciseId, status: "failed" };
  try {
    const response = await client(apiKey).messages.parse({
      model: AI_MODEL,
      // Haiku denkt adaptiv mit; das zählt auf max_tokens.
      max_tokens: 2048,
      // Einfache, kurze Aufgabe – niedriger Aufwand hält Zeit und Kosten klein.
      output_config: { effort: "low", format: zodOutputFormat(AiAnswer) },
      system: SYSTEM,
      messages: [{ role: "user", content: JSON.stringify(input) }],
    });
    if (response.stop_reason !== "refusal" && response.parsed_output) {
      const clamped = clampAiSuggestion(
        response.parsed_output,
        request.rule,
        request.previousWeight,
        request.step,
        request.mode,
      );
      row = {
        ...row,
        status: "ok",
        weight: clamped.weight,
        reps: JSON.stringify(clamped.reps),
        reason: clamped.reason,
      };
    }
  } catch (error) {
    if (error instanceof Anthropic.APIError) {
      console.error(`[ai] Vorschlag fehlgeschlagen (${error.status ?? "Verbindung"}): ${error.message}`);
    } else {
      console.error("[ai] Vorschlag fehlgeschlagen:", error);
    }
  }
  await db
    .insert(workoutAiSuggestions)
    .values(row)
    .onConflictDoNothing({ target: [workoutAiSuggestions.workoutId, workoutAiSuggestions.exerciseId] });
}
