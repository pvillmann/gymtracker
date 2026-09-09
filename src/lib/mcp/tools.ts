import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { describeSet, describeSets, trackingModeLabel } from "@/lib/describe";
import {
  formatDate,
  formatDuration,
  formatDurationLong,
  formatKg,
  formatRelativeDay,
  formatVolume,
  sets as setsLabel,
} from "@/lib/format";
import {
  getActiveWorkout,
  getExerciseSessions,
  getPreviousPerformances,
  listExercises,
  listPlanItems,
  listPlans,
  listWorkoutSets,
  listWorkoutSummaries,
} from "@/lib/queries";
import { ServiceError, isServiceError } from "@/lib/services/errors";
import { createExercise } from "@/lib/services/exercises";
import {
  addPlanItem,
  createPlan,
  removePlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import { resolveExercise, resolvePlan } from "@/lib/services/resolve";
import { totals, weekStreak } from "@/lib/stats";
import {
  deleteLastSet,
  finishWorkout,
  logSet,
  startWorkout,
} from "@/lib/services/workouts";

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
async function run(handler: () => Promise<string>): Promise<ToolResult> {
  try {
    return ok(await handler());
  } catch (error) {
    if (isServiceError(error)) return err(error.message);
    console.error("[mcp] Werkzeug fehlgeschlagen:", error);
    return err("Unerwarteter Fehler. Details stehen im Server-Log.");
  }
}

/** Das laufende Training, oder ein neues freies, falls keines offen ist. */
async function ensureWorkout(user: User): Promise<{ id: string; started: boolean }> {
  const running = await getActiveWorkout(user.id);
  if (running) return { id: running.id, started: false };
  const created = await startWorkout(user, null);
  return { id: created.workoutId, started: true };
}

const targetFields = {
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

function readTargets(args: {
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

/** Registriert alle Werkzeuge für genau ein Konto. */
export function registerGymTools(server: McpServer, user: User): void {
  // ---------------------------------------------------------------- Lesen

  server.registerTool(
    "list_exercises",
    {
      title: "Übungen auflisten",
      description:
        "Alle angelegten Übungen des Kontos mit Muskelgruppe und Messart. " +
        "Nutze das, um den genauen Namen einer Übung zu finden.",
      inputSchema: {
        muscle_group: z.string().optional().describe("Nur diese Muskelgruppe"),
      },
    },
    async ({ muscle_group }) =>
      run(async () => {
        const all = await listExercises(user.id);
        const filtered = muscle_group
          ? all.filter(
              (e) => e.muscleGroup?.toLowerCase() === muscle_group.toLowerCase(),
            )
          : all;

        if (filtered.length === 0) return "Keine Übungen gefunden.";
        return filtered
          .map(
            (e) =>
              `- ${e.name} (${e.muscleGroup ?? "ohne Muskelgruppe"}, ${trackingModeLabel(
                e.trackingMode,
              )}, Stufe ${formatKg(e.weightStepKg)} kg)`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "list_plans",
    {
      title: "Trainingspläne auflisten",
      description: "Alle Trainingspläne mit der Anzahl ihrer Übungen.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const all = await listPlans(user.id);
        if (all.length === 0) return "Noch keine Trainingspläne angelegt.";
        return all
          .map(
            (p) =>
              `- ${p.name}: ${p.exerciseCount} Übungen${
                p.archivedAt ? " (archiviert)" : ""
              }${p.notes ? ` – ${p.notes}` : ""}`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "get_plan",
    {
      title: "Trainingsplan anzeigen",
      description: "Die Übungen eines Plans in ihrer Reihenfolge, mit Zielvorgaben.",
      inputSchema: { plan: z.string().describe("Name des Plans") },
    },
    async ({ plan }) =>
      run(async () => {
        const found = await resolvePlan(user, plan);
        const items = await listPlanItems(found.id);
        if (items.length === 0) return `Der Plan „${found.name}“ ist noch leer.`;

        const lines = items.map((item, index) => {
          const target =
            item.trackingMode === "time"
              ? `${item.targetSets} × ${formatDuration(item.targetDurationSeconds ?? 0)}`
              : `${item.targetSets} × ${
                  item.targetRepsMin === item.targetRepsMax
                    ? item.targetRepsMin
                    : `${item.targetRepsMin}–${item.targetRepsMax}`
                } Wdh.`;
          return `${index + 1}. ${item.exerciseName} – ${target}, ${item.restSeconds}s Pause${
            item.notes ? ` (${item.notes})` : ""
          }`;
        });
        return `Plan „${found.name}“:\n${lines.join("\n")}`;
      }),
  );

  server.registerTool(
    "last_performance",
    {
      title: "Letzte Leistung an einer Übung",
      description:
        "Was beim letzten Training an dieser Übung stand – Sätze, Gewicht, " +
        "Wiederholungen und wann das war. Die wichtigste Frage vor einem Satz.",
      inputSchema: { exercise: z.string().describe("Name der Übung") },
    },
    async ({ exercise }) =>
      run(async () => {
        const found = await resolveExercise(user, exercise);
        const previous = await getPreviousPerformances(user.id, [found.id]);
        const last = previous.get(found.id);
        if (!last) return `„${found.name}“ wurde noch nie trainiert.`;

        return [
          `${found.name}, ${formatRelativeDay(last.performedAt)} (${formatDate(last.performedAt)}):`,
          describeSets(last.sets, found.trackingMode),
          `Bewegt: ${formatVolume(last.totalVolumeKg)}`,
        ].join("\n");
      }),
  );

  server.registerTool(
    "exercise_history",
    {
      title: "Verlauf einer Übung",
      description: "Die letzten Trainings an einer Übung, neueste zuerst.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        limit: z.number().int().min(1).max(30).optional().describe("Wie viele Trainings"),
      },
    },
    async ({ exercise, limit }) =>
      run(async () => {
        const found = await resolveExercise(user, exercise, { includeArchived: true });
        const sessions = await getExerciseSessions(user.id, found.id, limit ?? 10);
        if (sessions.length === 0) return `„${found.name}“ wurde noch nie trainiert.`;

        return sessions
          .map(
            (s) =>
              `${formatDate(s.performedAt)}: ${describeSets(s.sets, found.trackingMode)} · ${formatVolume(s.totalVolumeKg)}`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "recent_workouts",
    {
      title: "Letzte Trainings",
      description: "Die zuletzt abgeschlossenen Trainings mit Kennzahlen.",
      inputSchema: {
        limit: z.number().int().min(1).max(30).optional().describe("Wie viele Trainings"),
      },
    },
    async ({ limit }) =>
      run(async () => {
        const summaries = await listWorkoutSummaries(user.id);
        if (summaries.length === 0) return "Noch kein abgeschlossenes Training.";

        return summaries
          .slice(0, limit ?? 10)
          .map(
            (w) =>
              `${formatDate(w.startedAt)} – ${w.name}: ${setsLabel(w.setCount)}, ${formatVolume(
                w.volumeKg,
              )}${w.finishedAt ? `, ${formatDurationLong(w.finishedAt - w.startedAt)}` : ""}`,
          )
          .join("\n");
      }),
  );

  server.registerTool(
    "training_stats",
    {
      title: "Statistik",
      description: "Gesamtzahlen und aktuelle Trainingsserie.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const summaries = await listWorkoutSummaries(user.id);
        if (summaries.length === 0) return "Noch keine Trainingsdaten.";

        const total = totals(summaries);
        const streak = weekStreak(summaries);
        return [
          `Trainings: ${total.workouts}`,
          `Sätze: ${total.sets}, Wiederholungen: ${total.reps}`,
          `Bewegt insgesamt: ${formatVolume(total.volumeKg)}`,
          `Schnitt pro Training: ${formatVolume(total.averageVolumeKg)}`,
          `Serie: ${streak.current} Wochen (beste: ${streak.longest})`,
          `Körpergewicht laut Profil: ${formatKg(user.bodyweightKg)} kg`,
        ].join("\n");
      }),
  );

  // ------------------------------------------------------- Pläne bearbeiten

  server.registerTool(
    "create_exercise",
    {
      title: "Übung anlegen",
      description:
        "Legt eine neue Übung oder Maschine an. Messarten: weight_reps " +
        "(Gewicht × Wiederholungen, der Normalfall), bodyweight_reps " +
        "(Körpergewicht plus optionalem Zusatzgewicht, z. B. Klimmzüge), " +
        "assisted_reps (Maschine mit Gegengewicht, das die Last verringert, " +
        "z. B. assistierte Klimmzugmaschine), time (Dauer, z. B. Plank).",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Name der Übung"),
        muscle_group: z.string().max(40).optional().describe("z. B. Rücken, Beine"),
        tracking_mode: z
          .enum(["weight_reps", "bodyweight_reps", "assisted_reps", "time"])
          .optional()
          .describe("Messart, Standard ist weight_reps"),
        weight_step_kg: z
          .number()
          .positive()
          .max(50)
          .optional()
          .describe("Kleinste Gewichtsstufe der Maschine, Standard 2.5"),
        machine_setup: z
          .string()
          .max(500)
          .optional()
          .describe("Einstellungen wie Sitzhöhe oder Griff"),
      },
    },
    async (args) =>
      run(async () => {
        await createExercise(user, {
          name: args.name,
          muscleGroup: args.muscle_group ?? null,
          machineSetup: args.machine_setup ?? null,
          trackingMode: args.tracking_mode ?? "weight_reps",
          weightStepKg: args.weight_step_kg ?? 2.5,
        });
        return `Übung „${args.name}“ angelegt.`;
      }),
  );

  server.registerTool(
    "create_plan",
    {
      title: "Trainingsplan anlegen",
      description:
        "Legt einen leeren Trainingsplan an. Übungen kommen danach mit " +
        "add_exercise_to_plan dazu.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Name des Plans"),
        notes: z.string().max(1000).optional().describe("Notiz zum Plan"),
      },
    },
    async ({ name, notes }) =>
      run(async () => {
        await createPlan(user, { name, notes: notes ?? null });
        return `Plan „${name}“ angelegt.`;
      }),
  );

  server.registerTool(
    "add_exercise_to_plan",
    {
      title: "Übung zum Plan hinzufügen",
      description:
        "Hängt eine bestehende Übung mit Zielvorgaben ans Ende eines Plans. " +
        "Bei Übungen der Messart Zeit wird duration_seconds statt reps gebraucht.",
      inputSchema: {
        plan: z.string().describe("Name des Plans"),
        exercise: z.string().describe("Name der Übung"),
        ...targetFields,
      },
    },
    async (args) =>
      run(async () => {
        const plan = await resolvePlan(user, args.plan);
        const exercise = await resolveExercise(user, args.exercise);
        await addPlanItem(user, plan.id, exercise.id, readTargets(args));
        return `„${exercise.name}“ zum Plan „${plan.name}“ hinzugefügt.`;
      }),
  );

  server.registerTool(
    "update_plan_exercise",
    {
      title: "Zielwerte im Plan ändern",
      description: "Ändert Sätze, Wiederholungen, Pause oder Notiz einer Plan-Übung.",
      inputSchema: {
        plan: z.string().describe("Name des Plans"),
        exercise: z.string().describe("Name der Übung im Plan"),
        ...targetFields,
      },
    },
    async (args) =>
      run(async () => {
        const plan = await resolvePlan(user, args.plan);
        const items = await listPlanItems(plan.id);
        const exercise = await resolveExercise(user, args.exercise);
        const item = items.find((i) => i.exerciseId === exercise.id);
        if (!item) {
          throw new ServiceError(
            `„${exercise.name}“ steht nicht im Plan „${plan.name}“.`,
          );
        }

        // Nicht angegebene Werte behalten, statt sie auf Standards zu setzen.
        await updatePlanItem(user, item.id, {
          targetSets: args.sets ?? item.targetSets,
          targetRepsMin: args.reps_min ?? item.targetRepsMin,
          targetRepsMax: args.reps_max ?? item.targetRepsMax,
          targetDurationSeconds:
            args.duration_seconds ?? item.targetDurationSeconds ?? undefined,
          restSeconds: args.rest_seconds ?? item.restSeconds,
          notes: args.notes ?? item.notes,
        });
        return `Zielwerte für „${exercise.name}“ im Plan „${plan.name}“ geändert.`;
      }),
  );

  server.registerTool(
    "remove_exercise_from_plan",
    {
      title: "Übung aus dem Plan entfernen",
      description:
        "Nimmt eine Übung aus einem Plan. Die Übung selbst und ihre Historie " +
        "bleiben erhalten.",
      inputSchema: {
        plan: z.string().describe("Name des Plans"),
        exercise: z.string().describe("Name der Übung"),
      },
    },
    async ({ plan, exercise }) =>
      run(async () => {
        const found = await resolvePlan(user, plan);
        const items = await listPlanItems(found.id);
        const target = await resolveExercise(user, exercise);
        const item = items.find((i) => i.exerciseId === target.id);
        if (!item) {
          throw new ServiceError(`„${target.name}“ steht nicht im Plan „${found.name}“.`);
        }

        await removePlanItem(user, item.id);
        return `„${target.name}“ aus dem Plan „${found.name}“ entfernt.`;
      }),
  );

  // ---------------------------------------------------------- Training

  server.registerTool(
    "start_workout",
    {
      title: "Training starten",
      description:
        "Startet ein Training, optional nach einem Plan. Läuft bereits eines, " +
        "wird dieses zurückgegeben statt ein zweites zu starten.",
      inputSchema: {
        plan: z.string().optional().describe("Name des Plans, sonst freies Training"),
      },
    },
    async ({ plan }) =>
      run(async () => {
        const planId = plan ? (await resolvePlan(user, plan)).id : null;
        const started = await startWorkout(user, planId);
        return started.resumed
          ? `Es läuft bereits ein Training: „${started.name}“.`
          : `Training „${started.name}“ gestartet.`;
      }),
  );

  server.registerTool(
    "current_workout",
    {
      title: "Laufendes Training",
      description: "Zeigt das offene Training mit allen bisher gespeicherten Sätzen.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const active = await getActiveWorkout(user.id);
        if (!active) return "Es läuft gerade kein Training.";

        const logged = await listWorkoutSets(active.id);
        if (logged.length === 0) {
          return `Training „${active.name}“ läuft, noch kein Satz gespeichert.`;
        }

        const all = await listExercises(user.id, { includeArchived: true });
        const byId = new Map(all.map((e) => [e.id, e]));
        const grouped = new Map<string, typeof logged>();
        for (const set of logged) {
          grouped.set(set.exerciseId, [...(grouped.get(set.exerciseId) ?? []), set]);
        }

        const lines = [...grouped.entries()].map(([exerciseId, entries]) => {
          const exercise = byId.get(exerciseId);
          const mode = exercise?.trackingMode ?? "weight_reps";
          return `${exercise?.name ?? "Unbekannt"}: ${entries
            .map((s) => describeSet(s, mode))
            .join(", ")}`;
        });

        const volume = logged.reduce((sum, s) => sum + s.volumeKg, 0);
        return [
          `Training „${active.name}“, ${setsLabel(logged.length)}, ${formatVolume(volume)}:`,
          ...lines,
        ].join("\n");
      }),
  );

  server.registerTool(
    "log_set",
    {
      title: "Satz protokollieren",
      description:
        "Trägt einen Satz ins laufende Training ein. Läuft noch kein Training, " +
        "wird automatisch ein freies gestartet. Bei Übungen der Messart Zeit " +
        "wird duration_seconds gebraucht, sonst reps. weight_kg meint bei " +
        "assistierten Maschinen das eingestellte Gegengewicht.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        weight_kg: z.number().min(0).max(1000).optional().describe("Gewicht in kg"),
        reps: z.number().int().min(1).max(500).optional().describe("Wiederholungen"),
        duration_seconds: z
          .number()
          .int()
          .min(1)
          .max(36_000)
          .optional()
          .describe("Dauer in Sekunden, nur bei Messart Zeit"),
        is_warmup: z.boolean().optional().describe("Aufwärmsatz, zählt nicht als Arbeitssatz"),
      },
    },
    async (args) =>
      run(async () => {
        const exercise = await resolveExercise(user, args.exercise);
        const workout = await ensureWorkout(user);

        const result = await logSet(user, workout.id, exercise.id, {
          weightKg: args.weight_kg ?? 0,
          reps: args.reps ?? 0,
          durationSeconds: args.duration_seconds,
          isWarmup: args.is_warmup,
        });

        const prefix = workout.started ? "Freies Training gestartet. " : "";
        return `${prefix}Satz ${result.setNumber} bei „${result.exerciseName}“ gespeichert (${formatVolume(
          result.volumeKg,
        )} bewegt).`;
      }),
  );

  server.registerTool(
    "undo_last_set",
    {
      title: "Letzten Satz zurücknehmen",
      description: "Löscht den zuletzt gespeicherten Satz einer Übung im laufenden Training.",
      inputSchema: { exercise: z.string().describe("Name der Übung") },
    },
    async ({ exercise }) =>
      run(async () => {
        const active = await getActiveWorkout(user.id);
        if (!active) throw new ServiceError("Es läuft gerade kein Training.");

        const found = await resolveExercise(user, exercise);
        const { setNumber } = await deleteLastSet(user, active.id, found.id);
        return `Satz ${setNumber} bei „${found.name}“ wurde zurückgenommen.`;
      }),
  );

  server.registerTool(
    "finish_workout",
    {
      title: "Training beenden",
      description:
        "Schließt das laufende Training ab. Ein Training ohne einen einzigen " +
        "Satz wird verworfen statt gespeichert.",
      inputSchema: {},
    },
    async () =>
      run(async () => {
        const active = await getActiveWorkout(user.id);
        if (!active) throw new ServiceError("Es läuft gerade kein Training.");

        const logged = await listWorkoutSets(active.id);
        const volume = logged.reduce((sum, s) => sum + s.volumeKg, 0);
        const { discarded } = await finishWorkout(user, active.id);

        return discarded
          ? "Training war leer und wurde verworfen."
          : `Training „${active.name}“ beendet: ${setsLabel(logged.length)}, ${formatVolume(volume)} bewegt.`;
      }),
  );
}
