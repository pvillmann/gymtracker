import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { trackingModeLabel } from "@/lib/describe";
import { formatDateTime } from "@/lib/format";
import { run } from "@/lib/mcp/shared";
import { listGyms } from "@/lib/queries";
import { listChanges } from "@/lib/services/changelog";
import { deleteEquipment, setEquipmentArchived } from "@/lib/services/equipment";
import { ServiceError } from "@/lib/services/errors";
import { findOrCreateGym } from "@/lib/services/gyms";
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
import { mergeMovements } from "@/lib/services/merge";
import { resolveEquipment, resolveMovement } from "@/lib/services/resolve";
import { searchWger } from "@/lib/wger";

/** Katalog pflegen: Übungen anlegen, zuordnen, ändern, zusammenführen. */
export function registerCatalogTools(server: McpServer, user: User): void {
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
}
