import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { catalogChanges, users } from "@/db/schema";
import { newId } from "@/lib/ids";

export type CatalogEntity = "movement" | "equipment" | "gym";

export type CatalogAction =
  | "create"
  | "update"
  | "archive"
  | "restore"
  | "delete"
  | "merge"
  | "link"
  | "unlink";

/** Feld → [alt, neu]; bei Zuordnungen ein freier Hinweis unter "note". */
export type ChangeDetails = Record<string, [unknown, unknown]> | { note: string };

/**
 * Hält eine Änderung am gemeinsamen Katalog fest. Fehler beim Protokollieren
 * dürfen die eigentliche Änderung nicht kippen – sie landen nur im Log.
 */
export async function logChange(
  user: { id: string } | null,
  entity: CatalogEntity,
  entityId: string,
  entityName: string,
  action: CatalogAction,
  details?: ChangeDetails,
): Promise<void> {
  try {
    await db.insert(catalogChanges).values({
      id: newId(),
      entity,
      entityId,
      entityName,
      userId: user?.id ?? null,
      action,
      details: details ? JSON.stringify(details) : null,
    });
  } catch (error) {
    console.error("[changelog] Protokollieren fehlgeschlagen:", error);
  }
}

/** Nur die Felder, die sich wirklich geändert haben – mit lesbaren Namen. */
export function diffFields<T extends Record<string, unknown>>(
  before: T,
  after: Partial<T>,
  labels: Partial<Record<keyof T, string>>,
): Record<string, [unknown, unknown]> {
  const changes: Record<string, [unknown, unknown]> = {};
  for (const [key, label] of Object.entries(labels) as Array<[keyof T, string]>) {
    if (!(key in after)) continue;
    const old = before[key] ?? null;
    const next = after[key] ?? null;
    if (old !== next) changes[label] = [old, next];
  }
  return changes;
}

export type ChangeEntry = {
  id: string;
  action: CatalogAction;
  userName: string | null;
  createdAt: number;
  text: string;
};

const ACTION_TEXT: Record<CatalogAction, string> = {
  create: "angelegt",
  update: "geändert",
  archive: "archiviert",
  restore: "wiederhergestellt",
  delete: "gelöscht",
  merge: "zusammengeführt",
  link: "zugeordnet",
  unlink: "Zuordnung entfernt",
};

function show(value: unknown): string {
  if (value === null || value === undefined || value === "") return "–";
  if (typeof value === "boolean") return value ? "ja" : "nein";
  if (typeof value === "number") return value.toLocaleString("de-DE", { maximumFractionDigits: 3 });
  return String(value);
}

/** Eine Zeile Text zu einem Protokolleintrag. */
export function describeChange(action: CatalogAction, details: string | null): string {
  if (!details) return ACTION_TEXT[action] ?? action;
  const parsed = JSON.parse(details) as ChangeDetails;
  if ("note" in parsed && typeof parsed.note === "string") {
    return `${ACTION_TEXT[action] ?? action}: ${parsed.note}`;
  }
  const parts = Object.entries(parsed as Record<string, [unknown, unknown]>).map(
    ([field, [old, next]]) => `${field}: ${show(old)} → ${show(next)}`,
  );
  return parts.length ? parts.join(", ") : (ACTION_TEXT[action] ?? action);
}

export async function listChanges(
  entity: CatalogEntity,
  entityId: string,
  limit = 20,
): Promise<ChangeEntry[]> {
  const rows = await db
    .select({
      id: catalogChanges.id,
      action: catalogChanges.action,
      details: catalogChanges.details,
      createdAt: catalogChanges.createdAt,
      userName: users.name,
    })
    .from(catalogChanges)
    .leftJoin(users, eq(users.id, catalogChanges.userId))
    .where(and(eq(catalogChanges.entity, entity), eq(catalogChanges.entityId, entityId)))
    .orderBy(desc(catalogChanges.createdAt), desc(catalogChanges.id))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    action: r.action as CatalogAction,
    userName: r.userName,
    createdAt: r.createdAt,
    text: describeChange(r.action as CatalogAction, r.details),
  }));
}
