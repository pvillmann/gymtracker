import "server-only";

import { z } from "zod";

import type { User } from "@/db/schema";
import { loadUnitOf } from "@/lib/describe";
import { getActiveWorkout, listEquipment } from "@/lib/queries";
import { ServiceError, isServiceError } from "@/lib/services/errors";
import { startWorkout } from "@/lib/services/workouts";

/**
 * Nimmt "2026-09-08T20:12", "2026-09-08 20:12" oder bloß "20:12" entgegen.
 * Die reine Uhrzeit bezieht sich auf den Tag, an dem das Training begann –
 * im Gespräch sagt niemand das Datum dazu, wenn es ohnehin klar ist.
 */
export function parseMoment(value: string, sameDayAs: number): number {
  const time = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (time) {
    const day = new Date(sameDayAs * 1000);
    day.setHours(Number(time[1]), Number(time[2]), 0, 0);
    return Math.floor(day.getTime() / 1000);
  }

  const parsed = new Date(value.trim().replace(" ", "T"));
  const seconds = Math.floor(parsed.getTime() / 1000);
  if (!Number.isFinite(seconds)) {
    throw new ServiceError(
      `„${value}" ist keine Zeitangabe. Erwartet wird "2026-09-08T20:12" oder "20:12".`,
    );
  }
  return seconds;
}

type ToolResult = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

const ok = (text: string): ToolResult => ({ content: [{ type: "text", text }] });
const err = (text: string): ToolResult => ({
  content: [{ type: "text", text }],
  isError: true,
});

/**
 * Führt einen Werkzeug-Aufruf aus und macht aus einem Service-Fehler eine
 * lesbare Antwort. Das Modell soll die Ursache erfahren ("Übung gibt es
 * nicht", "Training bereits beendet") und selbst nachfragen können, statt
 * einen nackten Stacktrace zu sehen.
 */
export async function run(handler: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await handler());
  } catch (error) {
    if (isServiceError(error)) return err(error.message);
    console.error("[mcp] Werkzeug fehlgeschlagen:", error);
    return err("Unerwarteter Fehler. Details stehen im Server-Log.");
  }
}

/** Das laufende Training, oder ein neues freies, falls keines offen ist. */
export async function ensureWorkout(user: User): Promise<{ id: string; started: boolean }> {
  const running = await getActiveWorkout(user.id);
  if (running) return { id: running.id, started: false };
  const created = await startWorkout(user, null);
  return { id: created.workoutId, started: true };
}

export const targetFields = {
  sets: z.number().int().min(1).max(20).optional().describe("Anzahl der Sätze"),
  reps_min: z.number().int().min(1).max(200).optional().describe("Wiederholungen von"),
  reps_max: z.number().int().min(1).max(200).optional().describe("Wiederholungen bis"),
  duration_seconds: z
    .number()
    .int()
    .min(1)
    .max(36_000)
    .optional()
    .describe("Zieldauer in Sekunden – nur für Übungen der Messart Zeit"),
  rest_seconds: z.number().int().min(0).max(900).optional().describe("Pause in Sekunden"),
  notes: z.string().max(300).optional().describe("Notiz zur Übung im Plan"),
};

export function readTargets(args: {
  sets?: number;
  reps_min?: number;
  reps_max?: number;
  duration_seconds?: number;
  rest_seconds?: number;
  notes?: string;
}) {
  return {
    targetSets: args.sets ?? 3,
    targetRepsMin: args.reps_min ?? 8,
    targetRepsMax: args.reps_max ?? 12,
    targetDurationSeconds: args.duration_seconds,
    restSeconds: args.rest_seconds ?? 90,
    notes: args.notes ?? null,
  };
}

export const machineSchema = z
  .string()
  .max(80)
  .optional()
  .describe(
    "Maschine, falls nicht die im Training gewählte bzw. zuletzt benutzte gemeint ist; " +
      "„ohne Gerät“ für die Variante ohne Maschine",
  );

/** Gewicht je Seite bzw. Stufen – von der Maschine einer Variante. */
export const unitOf = async (equipmentId: string | null) =>
  equipmentId ? loadUnitOf((await listEquipment()).find((e) => e.id === equipmentId)) : null;

