import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import {
  describeSet,
  describeSets,
  effortLabel,
  lastEffort,
  loadUnitOf,
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
  listGyms,
  listMachineLinkRows,
  listMovements,
  listPlanItems,
  listPlans,
  listWorkoutSets,
  listWorkoutSummaries,
} from "@/lib/queries";
import { ServiceError, isServiceError } from "@/lib/services/errors";
import {
  createEquipment,
  deleteEquipment,
  setEquipmentArchived,
  updateEquipment,
} from "@/lib/services/equipment";
import { findOrCreateGym } from "@/lib/services/gyms";
import { listChanges } from "@/lib/services/changelog";
import { mergeMovements } from "@/lib/services/merge";
import { UPLOAD_LINK_MINUTES, createPhotoUploadLink } from "@/lib/services/photo-upload";
import {
  createMovement,
  deleteMovement,
  linkGymEquipment,
  setMovementArchived,
  updateMovement,
  linkMovementEquipment,
  unlinkGymEquipment,
  unlinkMovementEquipment,
} from "@/lib/services/machines";
import { searchWger } from "@/lib/wger";
import {
  addPlanItem,
  createPlan,
  removePlanItem,
  reorderPlan,
  replacePlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import {
  resolveEquipment,
  resolveMovement,
  resolvePlan,
  resolvePlanItem,
  resolveVariant,
} from "@/lib/services/resolve";
import { totals, weekStreak } from "@/lib/stats";
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

const machineSchema = z
  .string()
  .max(80)
  .optional()
  .describe(
    "Maschine, falls nicht die im Training gewählte bzw. zuletzt benutzte gemeint ist; " +
      "„ohne Gerät“ für die Variante ohne Maschine",
  );

/** Registriert alle Werkzeuge für genau ein Konto. */
export function registerGymTools(server: McpServer, user: User): void {
  /** Gewicht je Seite bzw. Stufen – von der Maschine einer Variante. */
  const unitOf = async (equipmentId: string | null) =>
    equipmentId ? loadUnitOf((await listEquipment()).find((e) => e.id === equipmentId)) : null;

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

  // ------------------------------------------------------- Pläne bearbeiten

  server.registerTool(
    "create_exercise",
    {
      title: "Übung anlegen",
      description:
        "Legt eine Übung (Bewegung, z. B. Seitheben) im gemeinsamen Katalog an " +
        "und ordnet ihr optional Maschinen zu. Vorher mit list_exercises prüfen, " +
        "ob es sie schon gibt. Messarten: weight_reps (Gewicht × Wiederholungen, " +
        "der Normalfall), bodyweight_reps (Körpergewicht plus optionalem " +
        "Zusatzgewicht, z. B. Klimmzüge), assisted_reps (Gegengewicht, das die " +
        "Last verringert), time (Dauer, z. B. Plank).",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Name der Übung, z. B. Seitheben – ohne Maschine"),
        muscle_group: z.string().max(40).optional().describe("z. B. Rücken, Beine"),
        wger_id: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("ID aus search_wger; Lizenz und Urheber werden dann mitgespeichert"),
        tracking_mode: z
          .enum(["weight_reps", "bodyweight_reps", "assisted_reps", "time"])
          .optional()
          .describe("Messart, Standard ist weight_reps"),
        machines: z
          .array(z.string().max(80))
          .max(20)
          .optional()
          .describe("Namen bestehender Maschinen, an denen die Übung geht"),
      },
    },
    async (args) =>
      run(async () => {
        const machines = await Promise.all(
          (args.machines ?? []).map((m) => resolveEquipment(user, m)),
        );
        const id = await createMovement(
          user,
          {
            name: args.name,
            muscleGroup: args.muscle_group ?? null,
            trackingMode: args.tracking_mode ?? "weight_reps",
          },
          args.wger_id ?? null,
        );
        for (const machine of machines) await linkMovementEquipment(user, id, machine.id);
        return `Übung „${args.name}“ angelegt${
          machines.length ? ` – Maschinen: ${machines.map((m) => m.name).join(", ")}` : ""
        }.`;
      }),
  );

  server.registerTool(
    "assign_machine",
    {
      title: "Maschine zuordnen",
      description:
        "Ordnet eine Maschine einer Übung zu (sie geht an ihr) und/oder trägt " +
        "sie in einem Studio ein (sie steht dort). Danach schlägt das Training " +
        "im Studio genau diese Maschine für die Übung vor. Mit remove: true " +
        "wird eine falsche Zuordnung wieder entfernt.",
      inputSchema: {
        machine: z.string().describe("Name der Maschine"),
        exercise: z.string().optional().describe("Übung, die an der Maschine geht"),
        gym: z.string().max(60).optional().describe("Studio, in dem die Maschine steht"),
        remove: z.boolean().optional().describe("Zuordnung entfernen statt anlegen"),
      },
    },
    async (args) =>
      run(async () => {
        if (!args.exercise && !args.gym) {
          throw new ServiceError("Bitte eine Übung, ein Studio oder beides angeben.");
        }
        const machine = await resolveEquipment(user, args.machine);
        const lines: string[] = [];
        if (args.exercise) {
          const movement = await resolveMovement(args.exercise);
          if (args.remove) {
            await unlinkMovementEquipment(user, movement.id, machine.id);
            lines.push(`„${machine.name}“ gehört nicht mehr zu „${movement.name}“.`);
          } else {
            await linkMovementEquipment(user, movement.id, machine.id);
            lines.push(`„${machine.name}“ passt jetzt zu „${movement.name}“.`);
          }
        }
        if (args.gym) {
          const gymId = await findOrCreateGym(user, args.gym);
          if (args.remove) {
            await unlinkGymEquipment(user, gymId, machine.id);
            lines.push(`„${machine.name}“ steht nicht mehr im Studio „${args.gym}“.`);
          } else {
            await linkGymEquipment(user, gymId, machine.id);
            lines.push(`„${machine.name}“ steht im Studio „${args.gym}“.`);
          }
        }
        return lines.join("\n");
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
        "Hängt eine Übung mit Zielvorgaben ans Ende eines Plans. Im Plan steht " +
        "nur die Übung – die Maschine wird im Training je nach Studio gewählt. " +
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
        const movement = await resolveMovement(args.exercise);
        await addPlanItem(user, plan.id, movement.id, readTargets(args));
        return `„${movement.name}“ zum Plan „${plan.name}“ hinzugefügt.`;
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
        if (items.length === 0) throw new ServiceError(`Der Plan „${plan.name}“ ist leer.`);
        const item = resolvePlanItem(args.exercise, items);

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
        return `Zielwerte für „${item.exerciseName}“ im Plan „${plan.name}“ geändert.`;
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
        if (items.length === 0) throw new ServiceError(`Der Plan „${found.name}“ ist leer.`);
        const item = resolvePlanItem(exercise, items);

        await removePlanItem(user, item.id);
        return `„${item.exerciseName}“ aus dem Plan „${found.name}“ entfernt.`;
      }),
  );

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

  server.registerTool(
    "search_wger",
    {
      title: "Bewegung in wger suchen",
      description:
        "Sucht in der offenen Übungsdatenbank wger nach einer Bewegung (deutsche " +
        "Namen bevorzugt) und liefert Name, abgeleitete Muskelgruppe und Lizenz. " +
        "Für eine neue Übung die ID als wger_id an create_exercise geben. " +
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

  /**
   * Maschinen als Text – gemeinsam für search_equipment und list_equipment:
   * Daten, Foto-Status, Übungen, Studios und ein Hinweis auf mögliche
   * Dubletten (gleicher Hersteller und gleiches Modell).
   */
  async function describeEquipment(filter: {
    query?: string;
    gym?: string;
    exercise?: string;
    includeArchived?: boolean;
  }): Promise<string> {
    const [everything, movements, links, gyms] = await Promise.all([
      listEquipment(),
      listMovements(),
      listMachineLinkRows(),
      listGyms(),
    ]);
    const movementName = new Map(movements.map((m) => [m.id, m.name]));
    const gymName = new Map(gyms.map((g) => [g.id, g.name]));
    let hits = filter.includeArchived ? everything : everything.filter((e) => e.archivedAt === null);

    const needle = (filter.query ?? "").toLowerCase().trim();
    if (needle) {
      // Auch die Notiz, damit „Nr. 24“ oder „hinten links“ gefunden wird.
      hits = hits.filter((e) =>
        [e.name, e.manufacturer, e.model, e.notes]
          .filter(Boolean)
          .some((v) => v!.toLowerCase().includes(needle)),
      );
    }
    if (filter.gym) {
      const gym = gyms.find((g) => g.name.toLowerCase() === filter.gym!.toLowerCase().trim());
      if (!gym) throw new ServiceError(`Kein Studio namens „${filter.gym}“. Vorhanden: ${gyms.map((g) => g.name).join(", ")}.`);
      const here = new Set(links.gymLinks.filter((l) => l.gymId === gym.id).map((l) => l.equipmentId));
      hits = hits.filter((e) => here.has(e.id));
    }
    if (filter.exercise) {
      const movement = await resolveMovement(filter.exercise);
      const fits = new Set(
        links.movementLinks.filter((l) => l.movementId === movement.id).map((l) => l.equipmentId),
      );
      hits = hits.filter((e) => fits.has(e.id));
    }
    if (hits.length === 0) return "Keine passenden Geräte.";

    const modelKey = (e: (typeof everything)[number]) =>
      e.manufacturer && e.model ? `${e.manufacturer}|${e.model}`.toLowerCase() : null;
    const withoutPhoto = hits.filter((e) => !e.imageId).length;
    const lines = hits.map((e) => {
      const used = links.movementLinks
        .filter((l) => l.equipmentId === e.id)
        .map((l) => movementName.get(l.movementId))
        .filter(Boolean);
      const where = links.gymLinks
        .filter((l) => l.equipmentId === e.id)
        .map((l) => gymName.get(l.gymId))
        .filter(Boolean);
      const twins = everything.filter(
        (o) => o.id !== e.id && modelKey(e) !== null && modelKey(o) === modelKey(e),
      );
      const meta = [
        [e.manufacturer, e.model].filter(Boolean).join(" "),
        e.loadFactor !== 1 ? `Übersetzung ${Math.round(1 / e.loadFactor)}:1` : null,
        e.baseLoadKg > 0 ? `Eigengewicht ${formatKg(e.baseLoadKg)} kg` : null,
        e.perSide ? "Gewicht je Seite" : null,
        e.loadUnit === "level" ? "Stufen statt kg" : null,
        e.imageId ? "mit Foto" : "OHNE Foto",
        e.archivedAt !== null ? "archiviert" : null,
      ]
        .filter(Boolean)
        .join(", ");
      return [
        `- ${e.name} (${meta})`,
        used.length ? ` – Übungen: ${used.join(", ")}` : " – keiner Übung zugeordnet",
        where.length ? ` – Studios: ${where.join(", ")}` : "",
        e.notes ? ` – Notiz: ${e.notes}` : "",
        twins.length ? ` – mögliche Dublette von: ${twins.map((t) => t.name).join(", ")}` : "",
      ].join("");
    });
    return [
      `${hits.length} Geräte${withoutPhoto ? `, ${withoutPhoto} ohne Foto` : ""}:`,
      ...lines,
    ].join("\n");
  }

  server.registerTool(
    "search_equipment",
    {
      title: "Geräte suchen",
      description:
        "Durchsucht die Geräte (Maschinen) nach Name, Hersteller, Modell und " +
        "Notiz (z. B. „Nr. 24“). Vor create_equipment aufrufen, damit nichts " +
        "doppelt angelegt wird – etwa nachdem du ein Gerät auf einem Foto erkannt hast.",
      inputSchema: {
        query: z.string().optional().describe("Suchbegriff; leer listet alle"),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ query, include_archived }) =>
      run(() => describeEquipment({ query, includeArchived: include_archived })),
  );

  server.registerTool(
    "list_equipment",
    {
      title: "Geräte auflisten",
      description:
        "Listet Geräte mit Zuordnungen (Übungen, Studios), Foto-Status und " +
        "Hinweis auf mögliche Dubletten – optional nur die eines Studios oder " +
        "einer Übung. Gut, um Lücken zu finden: Geräte ohne Foto oder ohne Übung.",
      inputSchema: {
        gym: z.string().optional().describe("Nur Geräte, die in diesem Studio stehen"),
        exercise: z.string().optional().describe("Nur Geräte, die zu dieser Übung passen"),
        include_archived: z.boolean().optional(),
      },
    },
    async ({ gym, exercise, include_archived }) =>
      run(() => describeEquipment({ gym, exercise, includeArchived: include_archived })),
  );

  server.registerTool(
    "create_equipment",
    {
      title: "Gerät anlegen",
      description:
        "Legt ein Gerät (eine Maschine; auch freie Gewichte wie Kurzhanteln) an. " +
        "Typischer Ablauf: der Nutzer schickt ein Foto, du erkennst Hersteller " +
        "und Modell (am besten am Typenschild), prüfst mit search_equipment auf " +
        "Dubletten und darfst online nach Daten suchen (Datenblatt, " +
        "Übersetzung, Eigengewicht). Recherchierte Werte sind Vorschläge: " +
        "nenne sie dem Nutzer mit Quelle und rufe das Werkzeug ERST NACH SEINER " +
        "BESTÄTIGUNG auf – geraten wird nicht. Optional ordnet das Werkzeug das " +
        "Gerät gleich einer Übung zu und trägt es im Studio ein. Das Foto kann " +
        "nicht per MCP übertragen werden: die Antwort enthält einen Einmal-Link " +
        "(30 Minuten, ein Foto), den du dem Nutzer gibst – dort wählt er sein " +
        "Foto aus. Lade niemals Bilder aus dem Netz hoch (Urheberrecht); nur " +
        "eigene Fotos des Nutzers.",
      inputSchema: {
        name: z.string().min(1).max(80).describe("Name, z. B. Matrix Ultra Lateral Raise"),
        manufacturer: z.string().max(80).optional(),
        model: z.string().max(80).optional(),
        kind: kindSchema,
        ratio: ratioSchema,
        base_load_kg: z.number().min(0).max(500).optional().describe("Eigengewicht, z. B. Schlitten"),
        per_side: z
          .boolean()
          .optional()
          .describe("Getrennte Arme mit eigenen Scheiben: eingetragen wird das Gewicht je Seite, bewegt wird das Doppelte"),
        load_unit: z
          .enum(["kg", "level"])
          .optional()
          .describe("level: Steckgewicht mit Stufen (z. B. 1–12) statt kg – zählt nicht als bewegtes Gewicht"),
        notes: z.string().max(1000).optional(),
        exercise: z.string().max(80).optional().describe("Übung, die an dem Gerät geht"),
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
          perSide: args.per_side ?? false,
          loadUnit: args.load_unit ?? "kg",
          notes: args.notes ?? null,
        });

        const lines = [`Gerät „${args.name}“ angelegt.`];
        if (args.exercise) {
          const movement = await resolveMovement(args.exercise);
          await linkMovementEquipment(user, movement.id, equipmentId);
          lines.push(`Passt zur Übung „${movement.name}“.`);
        }
        if (args.gym) {
          const gymId = await findOrCreateGym(user, args.gym);
          await linkGymEquipment(user, gymId, equipmentId);
          lines.push(`Steht im Studio „${args.gym}“.`);
        }
        const link = await createPhotoUploadLink(user, equipmentId);
        lines.push(
          `Foto hochladen (Einmal-Link, ${UPLOAD_LINK_MINUTES} Minuten gültig, ein Foto; abgelaufen lässt er sich auf der Seite erneuern): ${link.url}`,
        );
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
        "Eine geänderte Übersetzung, ein geändertes Eigengewicht, per_side " +
        "oder load_unit rechnet das bewegte Gewicht bisheriger Sätze an diesem " +
        "Gerät neu.",
      inputSchema: {
        equipment: z.string().describe("Name des Geräts"),
        name: z.string().min(1).max(80).optional(),
        manufacturer: z.string().max(80).optional(),
        model: z.string().max(80).optional(),
        kind: kindSchema,
        ratio: ratioSchema,
        base_load_kg: z.number().min(0).max(500).optional(),
        per_side: z
          .boolean()
          .optional()
          .describe("Getrennte Arme mit eigenen Scheiben: eingetragen wird das Gewicht je Seite, bewegt wird das Doppelte"),
        load_unit: z
          .enum(["kg", "level"])
          .optional()
          .describe("level: Steckgewicht mit Stufen (z. B. 1–12) statt kg – zählt nicht als bewegtes Gewicht"),
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
          perSide: args.per_side ?? found.perSide,
          loadUnit: args.load_unit ?? found.loadUnit,
          notes: args.notes ?? found.notes,
        });
        return `Gerät „${args.name ?? found.name}“ gespeichert. Fotos: ${equipmentUrl(found.id)}`;
      }),
  );

  server.registerTool(
    "photo_upload_link",
    {
      title: "Link für ein Maschinenfoto",
      description:
        "Gibt einen Einmal-Link aus, über den der Nutzer ein Foto für eine " +
        "bestehende Maschine hochlädt – ohne Anmeldung, 30 Minuten gültig, " +
        "für genau ein Foto; ein abgelaufener Link lässt sich auf der Seite " +
        "selbst erneuern. Gib den Link unverändert weiter (nicht kürzen, nicht " +
        "formatieren). Nutze das, wenn der Nutzer ein Foto nachreichen " +
        "will; Fotos selbst kann MCP nicht übertragen.",
      inputSchema: { equipment: z.string().describe("Name der Maschine") },
    },
    async ({ equipment }) =>
      run(async () => {
        const found = await resolveEquipment(user, equipment);
        const link = await createPhotoUploadLink(user, found.id);
        return `Foto für „${found.name}“ hochladen (${UPLOAD_LINK_MINUTES} Minuten gültig, ein Foto; abgelaufen lässt er sich auf der Seite erneuern): ${link.url}`;
      }),
  );

  // ------------------------------------------------------- Katalog pflegen

  const trackingModeSchema = z
    .enum(["weight_reps", "bodyweight_reps", "assisted_reps", "time"])
    .optional();

  server.registerTool(
    "update_exercise",
    {
      title: "Übung bearbeiten",
      description:
        "Ändert Name, Muskelgruppe oder Messart einer Übung – für alle Nutzer. " +
        "Hängen schon Sätze daran, geht als Messart-Wechsel nur Gewicht × " +
        "Wiederholungen ↔ Körpergewicht + Zusatz (z. B. Hackenschmidt mit " +
        "Scheiben); das bewegte Gewicht bisheriger Sätze wird dann neu " +
        "berechnet. Nicht genannte Felder bleiben unverändert.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        name: z.string().min(1).max(80).optional(),
        muscle_group: z.string().max(40).optional(),
        tracking_mode: trackingModeSchema,
      },
    },
    async (args) =>
      run(async () => {
        const movement = await resolveMovement(args.exercise);
        await updateMovement(user, movement.id, {
          name: args.name ?? movement.name,
          muscleGroup: args.muscle_group ?? movement.muscleGroup,
          trackingMode: args.tracking_mode ?? movement.trackingMode,
        });
        const changes = [
          args.name && args.name !== movement.name ? `Name „${args.name}“` : null,
          args.muscle_group ? `Muskelgruppe ${args.muscle_group}` : null,
          args.tracking_mode && args.tracking_mode !== movement.trackingMode
            ? `Messart ${trackingModeLabel(args.tracking_mode)} (bisherige Sätze neu berechnet)`
            : null,
        ].filter(Boolean);
        return `„${movement.name}“ gespeichert${changes.length ? `: ${changes.join(", ")}` : ""}.`;
      }),
  );

  server.registerTool(
    "archive_exercise",
    {
      title: "Übung archivieren",
      description:
        "Blendet eine Übung aus Auswahllisten aus (z. B. eine Dublette mit " +
        "Verlauf). Verlauf und Planeinträge bleiben. restore: true holt sie zurück.",
      inputSchema: {
        exercise: z.string().describe("Name der Übung"),
        restore: z.boolean().optional(),
      },
    },
    async ({ exercise, restore }) =>
      run(async () => {
        const movement = await resolveMovement(exercise);
        await setMovementArchived(user, movement.id, !restore);
        return restore ? `„${movement.name}“ ist wieder aktiv.` : `„${movement.name}“ archiviert.`;
      }),
  );

  server.registerTool(
    "delete_exercise",
    {
      title: "Übung löschen",
      description:
        "Löscht eine Übung endgültig – nur, wenn bei niemandem Sätze daran " +
        "hängen, und nur durch den, der sie angelegt hat, oder einen Admin. " +
        "Sie verschwindet auch aus den Plänen aller Nutzer. Mit Verlauf: " +
        "archive_exercise verwenden.",
      inputSchema: { exercise: z.string().describe("Name der Übung") },
    },
    async ({ exercise }) =>
      run(async () => {
        const movement = await resolveMovement(exercise);
        const { removedFromPlans } = await deleteMovement(user, movement.id);
        return `„${movement.name}“ gelöscht${
          removedFromPlans ? ` – aus ${removedFromPlans} Plan-Einträgen entfernt` : ""
        }.`;
      }),
  );

  server.registerTool(
    "merge_exercises",
    {
      title: "Übungen zusammenführen",
      description:
        "Führt eine doppelte Übung (source) in eine andere (target) zusammen: " +
        "Sätze, Planeinträge aller Nutzer, Maschinen-Zuordnungen und die Wahl " +
        "in laufenden Trainings wandern zu target, source wird gelöscht. Hat " +
        "ein Nutzer an derselben Maschine schon eine Variante von target, " +
        "landen die Sätze dort. Nicht umkehrbar – vorher mit dem Nutzer " +
        "klären, welcher Name bleibt. Nur durch den, der source angelegt hat, " +
        "oder einen Admin. Unterschiedliche Messarten nur, wenn umrechenbar " +
        "(Gewicht ↔ Körpergewicht + Zusatz).",
      inputSchema: {
        source: z.string().describe("Übung, die aufgeht und danach nicht mehr existiert"),
        target: z.string().describe("Übung, die bleibt"),
      },
    },
    async (args) =>
      run(async () => {
        const source = await resolveMovement(args.source);
        const target = await resolveMovement(args.target);
        const r = await mergeMovements(user, source.id, target.id);
        return [
          `„${source.name}“ ist in „${target.name}“ aufgegangen.`,
          `Varianten umgezogen: ${r.movedVariants}, mit vorhandenen zusammengelegt: ${r.mergedVariants} (${r.movedSets} Sätze verschoben).`,
          `Planeinträge umgehängt: ${r.movedPlanItems}${r.droppedPlanItems ? `, entfallen (target stand schon im Plan): ${r.droppedPlanItems}` : ""}.`,
          `Neue Maschinen-Zuordnungen: ${r.movedMachines}.`,
        ].join("\n");
      }),
  );

  server.registerTool(
    "catalog_history",
    {
      title: "Änderungen im Katalog",
      description:
        "Wer hat eine Übung, ein Gerät oder ein Studio wann geändert – mit den " +
        "alten Werten. Der Katalog ist gemeinsam und jeder darf bearbeiten; " +
        "nutze das, um ungewollte Änderungen zu finden und mit update_exercise " +
        "bzw. update_equipment zurückzudrehen.",
      inputSchema: {
        kind: z.enum(["exercise", "equipment", "gym"]).describe("Art des Eintrags"),
        name: z.string().describe("Name der Übung, des Geräts bzw. Studios"),
        limit: z.number().int().min(1).max(50).optional(),
      },
    },
    async ({ kind, name, limit }) =>
      run(async () => {
        let id: string;
        let label: string;
        if (kind === "exercise") {
          const m = await resolveMovement(name);
          [id, label] = [m.id, m.name];
        } else if (kind === "equipment") {
          const e = await resolveEquipment(user, name);
          [id, label] = [e.id, e.name];
        } else {
          const gym = (await listGyms()).find((g) => g.name.toLowerCase() === name.toLowerCase().trim());
          if (!gym) throw new ServiceError(`Kein Studio namens „${name}“.`);
          [id, label] = [gym.id, gym.name];
        }
        const entries = await listChanges(kind === "exercise" ? "movement" : kind, id, limit ?? 20);
        if (entries.length === 0) return `Für „${label}“ ist keine Änderung protokolliert.`;
        return [
          `Änderungen an „${label}“ (neueste zuerst):`,
          ...entries.map(
            (e) => `- ${formatDateTime(e.createdAt)} · ${e.userName ?? "gelöschtes Konto"}: ${e.text}`,
          ),
        ].join("\n");
      }),
  );

  server.registerTool(
    "archive_equipment",
    {
      title: "Gerät archivieren",
      description:
        "Blendet ein Gerät aus Auswahllisten und Vorschlägen im Training aus " +
        "(z. B. eine Dublette oder ein abgebautes Gerät). Verlauf, Fotos und " +
        "Zuordnungen bleiben. restore: true holt es zurück.",
      inputSchema: {
        equipment: z.string().describe("Name des Geräts"),
        restore: z.boolean().optional(),
      },
    },
    async ({ equipment, restore }) =>
      run(async () => {
        const found = await resolveEquipment(user, equipment);
        await setEquipmentArchived(user, found.id, !restore);
        return restore ? `„${found.name}“ ist wieder aktiv.` : `„${found.name}“ archiviert.`;
      }),
  );

  server.registerTool(
    "delete_equipment",
    {
      title: "Gerät löschen",
      description:
        "Löscht ein Gerät samt Fotos und Zuordnungen – nur, wenn noch niemand " +
        "daran trainiert hat, und nur durch den, der es angelegt hat, oder " +
        "einen Admin. Mit Verlauf: archive_equipment verwenden.",
      inputSchema: { equipment: z.string().describe("Name des Geräts") },
    },
    async ({ equipment }) =>
      run(async () => {
        const found = await resolveEquipment(user, equipment);
        await deleteEquipment(user, found.id);
        return `Gerät „${found.name}“ gelöscht.`;
      }),
  );

  // ------------------------------------------------------- Pläne umbauen

  /** Ein Plan per Name, oder mit "*" alle aktiven Pläne. */
  async function plansFor(plan: string) {
    if (plan.trim() === "*") {
      const all = (await listPlans(user.id)).filter((p) => p.archivedAt === null);
      if (all.length === 0) throw new ServiceError("Es gibt keine aktiven Pläne.");
      return all;
    }
    return [await resolvePlan(user, plan)];
  }

  server.registerTool(
    "reorder_plan",
    {
      title: "Plan umsortieren",
      description:
        "Stellt die genannten Übungen in dieser Reihenfolge an den Anfang des " +
        "Plans; alle übrigen folgen in ihrer bisherigen Reihenfolge. Zielwerte " +
        "und Notizen bleiben. Beispiel: exercises [\"Crosstrainer\"] setzt den " +
        "Crosstrainer an Position 1. plan \"*\" wendet das auf alle aktiven " +
        "Pläne an (Pläne ohne die Übung werden übersprungen).",
      inputSchema: {
        plan: z.string().describe("Name des Plans oder * für alle"),
        exercises: z.array(z.string()).min(1).max(50).describe("Übungen in der gewünschten Reihenfolge"),
      },
    },
    async ({ plan, exercises }) =>
      run(async () => {
        const lines: string[] = [];
        for (const target of await plansFor(plan)) {
          const items = await listPlanItems(target.id);
          const picked: typeof items = [];
          const missing: string[] = [];
          for (const name of exercises) {
            try {
              picked.push(resolvePlanItem(name, items));
            } catch {
              missing.push(name);
            }
          }
          if (plan.trim() !== "*" && missing.length) {
            throw new ServiceError(`Nicht im Plan „${target.name}“: ${missing.join(", ")}.`);
          }
          if (picked.length === 0) continue;
          await reorderPlan(user, target.id, picked.map((i) => i.id));
          const order = (await listPlanItems(target.id)).map((i) => i.exerciseName);
          lines.push(`${target.name}: ${order.join(" → ")}`);
        }
        return lines.length ? lines.join("\n") : "In keinem Plan gefunden – nichts geändert.";
      }),
  );

  server.registerTool(
    "replace_plan_exercise",
    {
      title: "Übung im Plan ersetzen",
      description:
        "Tauscht eine Übung im Plan gegen eine andere – an derselben Stelle, " +
        "mit denselben Sätzen, Wiederholungen, Pause und Notiz. plan \"*\" " +
        "tauscht in allen aktiven Plänen, in denen die alte Übung steht.",
      inputSchema: {
        plan: z.string().describe("Name des Plans oder * für alle"),
        old: z.string().describe("Übung, die ersetzt wird"),
        new: z.string().describe("Übung, die an ihre Stelle tritt"),
      },
    },
    async (args) =>
      run(async () => {
        const replacement = await resolveMovement(args.new);
        const lines: string[] = [];
        for (const target of await plansFor(args.plan)) {
          const items = await listPlanItems(target.id);
          let item: (typeof items)[number];
          try {
            item = resolvePlanItem(args.old, items);
          } catch (error) {
            if (args.plan.trim() === "*") continue;
            throw error;
          }
          await replacePlanItem(user, item.id, replacement.id);
          lines.push(`${target.name}: „${item.exerciseName}“ → „${replacement.name}“ (Position ${item.position + 1})`);
        }
        return lines.length ? lines.join("\n") : "In keinem Plan gefunden – nichts geändert.";
      }),
  );
}
