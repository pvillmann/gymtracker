import "server-only";

import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import type { User } from "@/db/schema";
import { formatKg } from "@/lib/format";
import { run } from "@/lib/mcp/shared";
import { listEquipment, listGyms, listMachineLinkRows, listMovements } from "@/lib/queries";
import { createEquipment, updateEquipment } from "@/lib/services/equipment";
import { ServiceError } from "@/lib/services/errors";
import { findOrCreateGym } from "@/lib/services/gyms";
import { linkGymEquipment, linkMovementEquipment } from "@/lib/services/machines";
import { UPLOAD_LINK_MINUTES, createPhotoUploadLink } from "@/lib/services/photo-upload";
import { resolveEquipment, resolveMovement } from "@/lib/services/resolve";

/** Geräte: finden, anlegen, ändern, Fotos. */
export function registerEquipmentTools(server: McpServer, user: User): void {
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
}
