import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { describeSets, effortLabel, lastEffort, trackingModeLabel } from "@/lib/describe";
import {
  formatDate,
  formatDuration,
  formatDurationLong,
  formatKg,
  formatRelativeDay,
  formatVolume,
  exerciseCount,
  sets as setsLabel,
} from "@/lib/format";
import { machineSchema, run, unitOf } from "@/lib/mcp/shared";
import {
  getActiveWorkout,
  getExerciseSessions,
  getPreviousPerformances,
  listEquipment,
  listGyms,
  listMachineLinkRows,
  listMovements,
  listPlanItems,
  listPlans,
  listWorkoutSummaries,
} from "@/lib/queries";
import { resolvePlan, resolveVariant } from "@/lib/services/resolve";
import { totals, weekStreak } from "@/lib/stats";

/** Lesen: Übungen, Pläne, Verlauf, Statistik. */
export function registerReadTools(server: McpServer, user: User): void {
  // ---------------------------------------------------------------- Lesen

  server.registerTool(
    "list_exercises",
    {
      title: "Übungen auflisten",
      description:
        "Alle Übungen des gemeinsamen Katalogs mit Muskelgruppe, Messart und " +
        "den Maschinen, an denen sie gehen. Eine Übung ist die Bewegung (z. B. " +
        "Seitheben); verglichen wird aber nur an derselben Maschine, deshalb " +
        "hat jede Maschine ihren eigenen Verlauf. Sätze nennen die Übung, die " +
        "Maschine nur, wenn sie nicht klar ist. Nutze das, um genaue Namen zu finden.",
      inputSchema: {
        muscle_group: z.string().optional().describe("Nur diese Muskelgruppe"),
        include_archived: z.boolean().optional().describe("Archivierte Übungen mit auflisten"),
      },
    },
    async ({ muscle_group, include_archived }) =>
      run(async () => {
        const [allMovements, equipment, links, gyms] = await Promise.all([
          listMovements(),
          listEquipment(),
          listMachineLinkRows(),
          listGyms(),
        ]);
        const movements = include_archived
          ? allMovements
          : allMovements.filter((m) => m.archivedAt === null);
        const filtered = muscle_group
          ? movements.filter(
              (m) => m.muscleGroup?.toLowerCase() === muscle_group.toLowerCase(),
            )
          : movements;
        if (filtered.length === 0) return "Keine Übungen gefunden.";

        const machineName = new Map(equipment.map((e) => [e.id, e.name]));
        const gymName = new Map(gyms.map((g) => [g.id, g.name]));
        const machineLine = (equipmentId: string) => {
          const where = links.gymLinks
            .filter((l) => l.equipmentId === equipmentId)
            .map((l) => gymName.get(l.gymId))
            .filter(Boolean);
          return `${machineName.get(equipmentId)}${where.length ? ` (steht in: ${where.join(", ")})` : ""}`;
        };
        return filtered
          .map((m) => {
            const machines = links.movementLinks
              .filter((l) => l.movementId === m.id)
              .map((l) => machineLine(l.equipmentId));
            return `- ${m.name}${m.archivedAt !== null ? " [archiviert]" : ""} (${m.muscleGroup ?? "ohne Muskelgruppe"}, ${trackingModeLabel(
              m.trackingMode,
            )}): ${machines.length ? machines.join("; ") : "keine Maschine zugeordnet"}`;
          })
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
              `- ${p.name}: ${exerciseCount(p.exerciseCount)}${
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
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        machine: machineSchema,
      },
    },
    async ({ exercise, machine }) =>
      run(async () => {
        const found = await resolveVariant(user, exercise, {
          machine,
          workout: await getActiveWorkout(user.id),
        });
        const previous = await getPreviousPerformances(user.id, [found.id]);
        const last = previous.get(found.id);
        if (!last) return `„${found.name}“ wurde noch nie trainiert.`;
        const effort = lastEffort(last.sets);

        return [
          `${found.name}, ${formatRelativeDay(last.performedAt)} (${formatDate(last.performedAt)}):`,
          describeSets(last.sets, found.trackingMode, await unitOf(found.equipmentId)),
          // Stufen sind keine kg – dann gibt es kein bewegtes Gewicht.
          ...(last.totalVolumeKg > 0 ? [`Bewegt: ${formatVolume(last.totalVolumeKg)}`] : []),
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
        machine: machineSchema,
        limit: z.number().int().min(1).max(30).optional().describe("Wie viele Trainings"),
      },
    },
    async ({ exercise, machine, limit }) =>
      run(async () => {
        const found = await resolveVariant(user, exercise, {
          machine,
          workout: await getActiveWorkout(user.id),
          includeArchived: true,
        });
        const sessions = await getExerciseSessions(user.id, found.id, limit ?? 10);
        if (sessions.length === 0) return `„${found.name}“ wurde noch nie trainiert.`;
        const unit = await unitOf(found.equipmentId);

        return `${found.name}:\n` + sessions
          .map(
            (s) =>
              `${formatDate(s.performedAt)}: ${describeSets(s.sets, found.trackingMode, unit)}${s.totalVolumeKg > 0 ? ` · ${formatVolume(s.totalVolumeKg)}` : ""}`,
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
}
