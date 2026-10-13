import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { describeSet, loadUnitOf } from "@/lib/describe";
import {
  formatDate,
  formatDateTime,
  formatDurationLong,
  formatVolume,
  sets as setsLabel,
} from "@/lib/format";
import { ensureWorkout, machineSchema, parseMoment, run } from "@/lib/mcp/shared";
import {
  getActiveWorkout,
  getPlan,
  listEquipment,
  listExercises,
  listWorkoutSets,
} from "@/lib/queries";
import { ServiceError } from "@/lib/services/errors";
import { findOrCreateGym } from "@/lib/services/gyms";
import { resolvePlan, resolveVariant } from "@/lib/services/resolve";
import {
  chooseVariant,
  deleteLastSet,
  discardWorkout,
  finishWorkout,
  logSet,
  resolveWorkoutByDate,
  setWorkoutTimes,
  startWorkout,
} from "@/lib/services/workouts";

/** Training führen und korrigieren. */
export function registerWorkoutTools(server: McpServer, user: User): void {
  // ---------------------------------------------------------- Training

  server.registerTool(
    "start_workout",
    {
      title: "Training starten",
      description:
        "Startet ein Training, optional nach einem Plan und in einem Studio. " +
        "Das Studio bestimmt, welche Maschine für eine Übung vorgeschlagen " +
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

        const [all, devices] = await Promise.all([
          listExercises(user.id, { includeArchived: true }),
          listEquipment(),
        ]);
        const byId = new Map(all.map((e) => [e.id, e]));
        const deviceById = new Map(devices.map((d) => [d.id, d]));
        const grouped = new Map<string, typeof logged>();
        for (const set of logged) {
          grouped.set(set.exerciseId, [...(grouped.get(set.exerciseId) ?? []), set]);
        }

        const lines = [...grouped.entries()].map(([exerciseId, entries]) => {
          const exercise = byId.get(exerciseId);
          const mode = exercise?.trackingMode ?? "weight_reps";
          const unit = loadUnitOf(exercise?.equipmentId ? deviceById.get(exercise.equipmentId) : null);
          return `${exercise?.name ?? "Unbekannt"}: ${entries
            .map((s) => `${s.isWarmup ? "Aufwärmen " : ""}${describeSet(s, mode, unit)}`)
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
        "assistierten Maschinen das eingestellte Gegengewicht. Die Maschine " +
        "ergibt sich aus der Wahl im Training bzw. dem Studio; ist sie nicht " +
        "eindeutig, nennt die Fehlermeldung die Auswahl – dann mit machine angeben.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        machine: machineSchema,
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
        const workout = await ensureWorkout(user);
        const active = await getActiveWorkout(user.id);
        const exercise = await resolveVariant(user, args.exercise, {
          machine: args.machine,
          workout: active,
          create: true,
        });
        // Die Wahl gilt für den Rest des Trainings – auch in der App.
        if (exercise.movementId) await chooseVariant(user, workout.id, exercise.id);

        const result = await logSet(user, workout.id, exercise.id, {
          weightKg: args.weight_kg ?? 0,
          reps: args.reps ?? 0,
          durationSeconds: args.duration_seconds,
          isWarmup: args.is_warmup,
          effort: args.effort,
        });

        const prefix = workout.started ? "Freies Training gestartet. " : "";
        // Ohne bewegtes Gewicht (Zeit, Stufen) keine „0 kg“ melden.
        const moved = result.volumeKg > 0 ? ` (${formatVolume(result.volumeKg)} bewegt)` : "";
        return `${prefix}${result.isWarmup ? "Aufwärmsatz" : "Satz"} ${result.ordinal} bei „${result.exerciseName}“ gespeichert${moved}.`;
      }),
  );

  server.registerTool(
    "undo_last_set",
    {
      title: "Letzten Satz zurücknehmen",
      description: "Löscht den zuletzt gespeicherten Satz einer Übung im laufenden Training.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        machine: machineSchema,
      },
    },
    async ({ exercise, machine }) =>
      run(async () => {
        const active = await getActiveWorkout(user.id);
        if (!active) throw new ServiceError("Es läuft gerade kein Training.");

        const found = await resolveVariant(user, exercise, { machine, workout: active });
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
}
