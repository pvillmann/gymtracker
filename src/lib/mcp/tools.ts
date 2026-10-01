import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import {
  describeSet,
  describeSets,
  effortLabel,
  lastEffort,
  trackingModeLabel,
} from "@/lib/describe";
import {
  formatDate,
  formatDateTime,
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
  getPlan,
  getPreviousPerformances,
  listEquipment,
  listExercises,
  listMovements,
  listPlanItems,
  listPlans,
  listWorkoutSets,
  listWorkoutSummaries,
} from "@/lib/queries";
import { ServiceError, isServiceError } from "@/lib/services/errors";
import { createExercise } from "@/lib/services/exercises";
import { createEquipment, updateEquipment } from "@/lib/services/equipment";
import { findOrCreateGym, markExerciseInGym } from "@/lib/services/gyms";
import { searchWger } from "@/lib/wger";
import {
  addPlanItem,
  createPlan,
  removePlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import { resolveEquipment, resolveExercise, resolvePlan } from "@/lib/services/resolve";
import { totals, weekStreak } from "@/lib/stats";
import {
  deleteLastSet,
  discardWorkout,
  finishWorkout,
  logSet,
  resolveWorkoutByDate,
  setWorkoutTimes,
  startWorkout,
} from "@/lib/services/workouts";

/**
 * Nimmt "2026-09-08T20:12", "2026-09-08 20:12" oder bloß "20:12" entgegen.
 * Die reine Uhrzeit bezieht sich auf den Tag, an dem das Training begann –
 * im Gespräch sagt niemand das Datum dazu, wenn es ohnehin klar ist.
 */
function parseMoment(value: string, sameDayAs: number): number {
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
        "Alle angelegten Übungen des Kontos, gruppiert nach Bewegung, mit " +
        "Muskelgruppe und Messart. Eine Bewegung (z. B. Seitheben) kann mehrere " +
        "Geräte haben (Maschine, Kabelturm) – jedes ist eine eigene Übung mit " +
        "eigenem Verlauf. Sätze werden immer auf eine Übung gebucht. Nutze das, " +
        "um den genauen Namen zu finden.",
      inputSchema: {
        muscle_group: z.string().optional().describe("Nur diese Muskelgruppe"),
      },
    },
    async ({ muscle_group }) =>
      run(async () => {
        const [all, movements] = await Promise.all([
          listExercises(user.id),
          listMovements(),
        ]);
        const filtered = muscle_group
          ? all.filter(
              (e) => e.muscleGroup?.toLowerCase() === muscle_group.toLowerCase(),
            )
          : all;

        if (filtered.length === 0) return "Keine Übungen gefunden.";
        const describe = (e: (typeof all)[number]) =>
          `${e.name} (${e.muscleGroup ?? "ohne Muskelgruppe"}, ${trackingModeLabel(
            e.trackingMode,
          )}, Stufe ${formatKg(e.weightStepKg)} kg)`;

        const byMovement = new Map<string, typeof all>();
        for (const e of filtered) {
          const key = e.movementId ?? e.id;
          byMovement.set(key, [...(byMovement.get(key) ?? []), e]);
        }
        const names = new Map(movements.map((m) => [m.id, m.name]));
        return [...byMovement.entries()]
          .map(([movementId, variants]) =>
            variants.length === 1
              ? `- ${describe(variants[0])}`
              : [
                  `- Bewegung ${names.get(movementId) ?? variants[0].name}:`,
                  ...variants.map((e) => `  - ${describe(e)}`),
                ].join("\n"),
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
        const effort = lastEffort(last.sets);

        return [
          `${found.name}, ${formatRelativeDay(last.performedAt)} (${formatDate(last.performedAt)}):`,
          describeSets(last.sets, found.trackingMode),
          `Bewegt: ${formatVolume(last.totalVolumeKg)}`,
          ...(effort ? [`Letzter Satz: ${effortLabel(effort)}`] : []),
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
        name: z.string().min(1).max(80).describe("Name der Übung bzw. des Geräts, z. B. Seitheben Kabelturm"),
        movement: z
          .string()
          .max(80)
          .optional()
          .describe(
            "Bewegung, zu der das Gerät gehört, z. B. Seitheben. Gibt es sie schon, " +
              "wird die Übung ein weiteres Gerät dafür; sonst wird sie angelegt. " +
              "Ohne Angabe ist die Übung ihre eigene Bewegung.",
          ),
        muscle_group: z
          .string()
          .max(40)
          .optional()
          .describe("z. B. Rücken, Beine – gilt für die ganze Bewegung"),
        wger_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe(
            "ID aus search_wger, wenn eine neue Bewegung aus wger übernommen wird; " +
              "Lizenz und Urheber werden dann mitgespeichert",
          ),
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
          movementName: args.movement ?? null,
          muscleGroup: args.muscle_group ?? null,
          wgerId: args.wger_id ?? null,
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
        "Startet ein Training, optional nach einem Plan und in einem Studio. " +
        "Das Studio bestimmt, welches Gerät für eine Bewegung vorausgewählt " +
        "wird. Ohne Angabe gilt das am Plan gemerkte Studio. Läuft bereits " +
        "eines, wird dieses zurückgegeben statt ein zweites zu starten.",
      inputSchema: {
        plan: z.string().optional().describe("Name des Plans, sonst freies Training"),
        gym: z
          .string()
          .max(60)
          .optional()
          .describe("Name des Studios; ein unbekannter Name legt es an"),
      },
    },
    async ({ plan, gym }) =>
      run(async () => {
        const found = plan ? await resolvePlan(user, plan) : null;
        const planRow = found ? await getPlan(user.id, found.id) : null;
        const gymId = gym
          ? await findOrCreateGym(user, gym)
          : planRow?.rememberGym
            ? planRow.defaultGymId
            : null;
        const started = await startWorkout(user, found?.id ?? null, gymId);
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
            .map((s) => `${s.isWarmup ? "Aufwärmen " : ""}${describeSet(s, mode)}`)
            .join(", ")}`;
        });

        const volume = logged.reduce((sum, s) => sum + s.volumeKg, 0);
        const working = logged.filter((s) => !s.isWarmup).length;
        return [
          `Training „${active.name}“, ${setsLabel(working)}, ${formatVolume(volume)}:`,
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
        effort: z
          .enum(["max", "ok", "easy"])
          .optional()
          .describe(
            "Nur beim letzten Arbeitssatz einer Übung: wie er sich angefühlt hat. " +
              "max = am Limit (0–1 Wdh. übrig), ok = 2–3 übrig, easy = leicht (4+ übrig)",
          ),
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
          effort: args.effort,
        });

        const prefix = workout.started ? "Freies Training gestartet. " : "";
        return `${prefix}${result.isWarmup ? "Aufwärmsatz" : "Satz"} ${result.ordinal} bei „${result.exerciseName}“ gespeichert (${formatVolume(
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
        const { ordinal, isWarmup } = await deleteLastSet(user, active.id, found.id);
        return `${isWarmup ? "Aufwärmsatz" : "Satz"} ${ordinal} bei „${found.name}“ wurde zurückgenommen.`;
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

  server.registerTool(
    "edit_workout",
    {
      title: "Zeiten eines Trainings korrigieren",
      description:
        "Setzt Beginn oder Ende eines gespeicherten Trainings neu. Gedacht " +
        "für den Fall, dass das Beenden vergessen wurde und die Dauer " +
        "dadurch unrealistisch ist. Ohne Datum ist das zuletzt beendete " +
        "Training gemeint.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Tag des Trainings als 2026-09-08; ohne Angabe das letzte"),
        started_at: z
          .string()
          .optional()
          .describe("Neuer Beginn, „2026-09-08T18:30“ oder nur „18:30“"),
        finished_at: z
          .string()
          .optional()
          .describe("Neues Ende, „2026-09-08T20:12“ oder nur „20:12“"),
      },
    },
    async ({ date, started_at, finished_at }) =>
      run(async () => {
        if (!started_at && !finished_at) {
          throw new ServiceError("Bitte einen neuen Beginn oder ein neues Ende angeben.");
        }

        const workout = await resolveWorkoutByDate(user.id, date);
        const times = {
          startedAt: started_at ? parseMoment(started_at, workout.startedAt) : undefined,
          finishedAt: finished_at ? parseMoment(finished_at, workout.startedAt) : undefined,
        };

        const saved = await setWorkoutTimes(user, workout.id, times);
        const duration =
          saved.finishedAt === null
            ? "läuft noch"
            : formatDurationLong(saved.finishedAt - saved.startedAt);

        return (
          `Training „${workout.name}“ vom ${formatDate(saved.startedAt)}: ` +
          `${formatDateTime(saved.startedAt)} bis ` +
          `${saved.finishedAt === null ? "offen" : formatDateTime(saved.finishedAt)} (${duration}).`
        );
      }),
  );

  server.registerTool(
    "delete_workout",
    {
      title: "Training löschen",
      description:
        "Löscht ein gespeichertes Training samt seiner Sätze — etwa einen " +
        "Doppeleintrag. Das lässt sich nicht rückgängig machen, deshalb vor " +
        "dem Aufruf beim Nutzer rückfragen.",
      inputSchema: {
        date: z
          .string()
          .optional()
          .describe("Tag des Trainings als 2026-09-08; ohne Angabe das letzte"),
      },
    },
    async ({ date }) =>
      run(async () => {
        const workout = await resolveWorkoutByDate(user.id, date);
        await discardWorkout(user, workout.id);

        return `Training „${workout.name}“ vom ${formatDate(workout.startedAt)} gelöscht.`;
      }),
  );

  server.registerTool(
    "search_wger",
    {
      title: "Bewegung in wger suchen",
      description:
        "Sucht in der offenen Übungsdatenbank wger nach einer Bewegung (deutsche " +
        "Namen bevorzugt) und liefert Name, abgeleitete Muskelgruppe und Lizenz. " +
        "Für eine neue Bewegung die ID als wger_id an create_exercise geben. " +
        "Braucht Internetzugang der Instanz.",
      inputSchema: { query: z.string().min(2).max(80).describe("Suchbegriff, z. B. Seitheben") },
    },
    async ({ query }) =>
      run(async () => {
        const results = await searchWger(query);
        if (results.length === 0) return `Nichts in wger zu „${query}“.`;
        return results
          .map(
            (r) =>
              `- ${r.name} (wger_id ${r.id}${r.muscleGroup ? `, ${r.muscleGroup}` : ""}; ` +
              `${[r.licenseAuthor, r.licenseName].filter(Boolean).join(", ") || "Lizenz unbekannt"})`,
          )
          .join("\n");
      }),
  );

  // ---------------------------------------------------------------- Geräte

  /** Fotos lassen sich nicht per MCP übertragen – hochgeladen wird im Browser. */
  const equipmentUrl = (id: string) =>
    `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/equipment/${id}`;

  const ratioSchema = z
    .enum(["1:1", "2:1", "3:1", "4:1"])
    .optional()
    .describe("Übersetzung wie am Gerät angegeben; 2:1 heißt: halbe Last kommt an");
  const factorOf = (ratio: string | undefined) =>
    ratio ? 1 / Number(ratio.split(":")[0]) : undefined;
  const kindSchema = z
    .enum(["stack", "plates", "cable", "free", "bodyweight", "other"])
    .optional()
    .describe(
      "stack = Steckgewicht, plates = Scheiben, cable = Kabelzug, free = Hanteln, " +
        "bodyweight = Station für Körpergewicht, other = sonstiges",
    );

  server.registerTool(
    "search_equipment",
    {
      title: "Geräte suchen",
      description:
        "Durchsucht die angelegten Geräte (Maschinen) nach Name, Hersteller " +
        "und Modell. Vor create_equipment aufrufen, damit nichts doppelt " +
        "angelegt wird – etwa nachdem du ein Gerät auf einem Foto erkannt hast.",
      inputSchema: {
        query: z.string().optional().describe("Suchbegriff; leer listet alle"),
      },
    },
    async ({ query }) =>
      run(async () => {
        const [all, exercises] = await Promise.all([
          listEquipment(),
          listExercises(user.id),
        ]);
        const needle = (query ?? "").toLowerCase().trim();
        const hits = all.filter((e) =>
          [e.name, e.manufacturer, e.model]
            .filter(Boolean)
            .some((v) => v!.toLowerCase().includes(needle)),
        );
        if (hits.length === 0) {
          return needle ? `Kein Gerät passt zu „${query}“.` : "Noch keine Geräte angelegt.";
        }
        return hits
          .map((e) => {
            const used = exercises.filter((x) => x.equipmentId === e.id).map((x) => x.name);
            const meta = [
              [e.manufacturer, e.model].filter(Boolean).join(" "),
              e.loadFactor !== 1 ? `Übersetzung ${Math.round(1 / e.loadFactor)}:1` : null,
              e.baseLoadKg > 0 ? `Eigengewicht ${formatKg(e.baseLoadKg)} kg` : null,
              e.imageId ? "mit Foto" : "ohne Foto",
            ]
              .filter(Boolean)
              .join(", ");
            return `- ${e.name} (${meta})${used.length ? ` – Übungen: ${used.join(", ")}` : ""}`;
          })
          .join("\n");
      }),
  );

  server.registerTool(
    "create_equipment",
    {
      title: "Gerät anlegen",
      description:
        "Legt ein Gerät (eine Maschine) an. Typischer Ablauf: der Nutzer " +
        "schickt ein Foto, du erkennst Hersteller und Modell (am besten am " +
        "Typenschild), prüfst mit search_equipment auf Dubletten und fragst " +
        "den Nutzer, ob deine Erkennung stimmt. ERST NACH SEINER BESTÄTIGUNG " +
        "aufrufen – geraten wird nicht. Übersetzung und Eigengewicht nur " +
        "angeben, wenn sie am Gerät stehen oder der Nutzer sie nennt. " +
        "Optional legt das Werkzeug gleich die Übung an diesem Gerät an " +
        "(movement = Bewegung, z. B. Seitheben) und vermerkt sie im Studio. " +
        "Das Foto selbst kann nicht per MCP übertragen werden: gib dem Nutzer " +
        "den zurückgegebenen Link, dort lädt er es hoch.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Name, z. B. Matrix Ultra Lateral Raise"),
        manufacturer: z.string().max(80).optional(),
        model: z.string().max(80).optional(),
        kind: kindSchema,
        ratio: ratioSchema,
        base_load_kg: z.number().min(0).max(500).optional().describe("Eigengewicht, z. B. Schlitten"),
        notes: z.string().max(1000).optional(),
        movement: z
          .string()
          .max(80)
          .optional()
          .describe("Bewegung, für die das Gerät gleich als Übung angelegt wird"),
        exercise_name: z
          .string()
          .max(80)
          .optional()
          .describe("Name dieser Übung; Standard: Bewegung + Gerätename"),
        weight_step_kg: z.number().positive().max(50).optional(),
        gym: z.string().max(60).optional().describe("Studio, in dem das Gerät steht"),
      },
    },
    async (args) =>
      run(async () => {
        const equipmentId = await createEquipment(user, {
          name: args.name,
          manufacturer: args.manufacturer ?? null,
          model: args.model ?? null,
          kind: args.kind ?? "other",
          loadFactor: factorOf(args.ratio) ?? 1,
          baseLoadKg: args.base_load_kg ?? 0,
          notes: args.notes ?? null,
        });

        const lines = [`Gerät „${args.name}“ angelegt.`];
        if (args.movement) {
          const exerciseName = args.exercise_name ?? `${args.movement} ${args.name}`;
          const exerciseId = await createExercise(user, {
            name: exerciseName,
            movementName: args.movement,
            equipmentId,
            trackingMode: "weight_reps",
            weightStepKg: args.weight_step_kg ?? 2.5,
          });
          lines.push(`Übung „${exerciseName}“ für die Bewegung „${args.movement}“ angelegt.`);
          if (args.gym) {
            const gymId = await findOrCreateGym(user, args.gym);
            await markExerciseInGym(gymId, exerciseId);
            lines.push(`Im Studio „${args.gym}“ vermerkt.`);
          }
        }
        lines.push(`Foto hochladen: ${equipmentUrl(equipmentId)}`);
        return lines.join("\n");
      }),
  );

  server.registerTool(
    "update_equipment",
    {
      title: "Gerät ändern",
      description:
        "Ändert Angaben eines Geräts, z. B. die Übersetzung, sobald sie am " +
        "Gerät abgelesen wurde. Nicht genannte Felder bleiben unverändert. " +
        "Eine geänderte Übersetzung oder ein geändertes Eigengewicht rechnet " +
        "das bewegte Gewicht bisheriger Sätze an diesem Gerät neu.",
      inputSchema: {
        equipment: z.string().describe("Name des Geräts"),
        name: z.string().min(1).max(80).optional(),
        manufacturer: z.string().max(80).optional(),
        model: z.string().max(80).optional(),
        kind: kindSchema,
        ratio: ratioSchema,
        base_load_kg: z.number().min(0).max(500).optional(),
        notes: z.string().max(1000).optional(),
      },
    },
    async (args) =>
      run(async () => {
        const found = await resolveEquipment(user, args.equipment);
        await updateEquipment(user, found.id, {
          name: args.name ?? found.name,
          manufacturer: args.manufacturer ?? found.manufacturer,
          model: args.model ?? found.model,
          kind: args.kind ?? found.kind,
          loadFactor: factorOf(args.ratio) ?? found.loadFactor,
          baseLoadKg: args.base_load_kg ?? found.baseLoadKg,
          notes: args.notes ?? found.notes,
        });
        return `Gerät „${args.name ?? found.name}“ gespeichert. Fotos: ${equipmentUrl(found.id)}`;
      }),
  );
}
