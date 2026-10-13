import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { exerciseCount } from "@/lib/format";
import { readTargets, run, targetFields } from "@/lib/mcp/shared";
import { listPlanItems, listPlans } from "@/lib/queries";
import { ServiceError } from "@/lib/services/errors";
import {
  importSharedPlan,
  sharePlan,
  shareUrl,
  tokenFromLink,
  unsharePlan,
} from "@/lib/services/plan-sharing";
import {
  addPlanItem,
  createPlan,
  removePlanItem,
  reorderPlan,
  replacePlanItem,
  updatePlanItem,
} from "@/lib/services/plans";
import { resolveMovement, resolvePlan, resolvePlanItem } from "@/lib/services/resolve";

/** Pläne anlegen, bearbeiten, umbauen und teilen. */
export function registerPlansTools(server: McpServer, user: User): void {
  server.registerTool(
    "share_plan",
    {
      title: "Plan teilen",
      description:
        "Gibt den öffentlichen Link eines eigenen Plans aus (legt ihn bei Bedarf an). " +
        "Wer den Link hat, sieht den Plan auch ohne Konto und kann ihn als eigene Kopie " +
        "übernehmen. Geteilt werden Übungen, Zielwerte, Pausen und Eintrags-Notizen – " +
        "nicht Plan-Notiz, Studio oder Name. renew: neuer Link, der alte wird ungültig; " +
        "revoke: Teilen beenden. Gib den Link unverändert weiter.",
      inputSchema: {
        plan: z.string().describe("Name des Plans"),
        renew: z.boolean().optional(),
        revoke: z.boolean().optional(),
      },
    },
    async ({ plan, renew, revoke }) =>
      run(async () => {
        const found = await resolvePlan(user, plan);
        if (revoke) {
          const removed = await unsharePlan(user, found.id);
          return removed
            ? `Teilen von „${found.name}“ beendet – der Link funktioniert nicht mehr. Bereits übernommene Kopien bleiben.`
            : `„${found.name}“ war nicht geteilt.`;
        }
        const token = await sharePlan(user, found.id, { renew: renew ?? false });
        return `Link für „${found.name}“${renew ? " (neu, der alte gilt nicht mehr)" : ""}: ${shareUrl(token)}`;
      }),
  );

  server.registerTool(
    "import_shared_plan",
    {
      title: "Geteilten Plan übernehmen",
      description:
        "Übernimmt einen geteilten Plan (Link …/p/… oder nur der Token) als eigene Kopie. " +
        "Spätere Änderungen am Original kommen nicht an.",
      inputSchema: { link: z.string().describe("Der Teilen-Link") },
    },
    async ({ link }) =>
      run(async () => {
        const token = tokenFromLink(link);
        if (!token) throw new ServiceError("Das sieht nicht wie ein Teilen-Link aus (…/p/ und 64 Zeichen).");
        const copied = await importSharedPlan(user, token);
        const items = await listPlanItems(copied.planId);
        return `Plan „${copied.name}“ übernommen (${exerciseCount(items.length)}). Studio und bevorzugte Maschinen legt das Training fest.`;
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
