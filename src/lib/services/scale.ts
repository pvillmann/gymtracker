import "server-only";

import { and, desc, eq } from "drizzle-orm";

import { db } from "@/db";
import { scaleCaptures, type User } from "@/db/schema";
import { newId } from "@/lib/ids";
import { ServiceError } from "@/lib/services/errors";

/**
 * Mitschnitte der Testseite /wiegen. Die Ereignisse kommen ungeprüft aus dem
 * Browser – deshalb nur Form und Größe prüfen, Inhalt bleibt roh.
 */

export type ScaleEvent = { t: number; type: string } & Record<string, unknown>;

const MAX_EVENTS = 3000;
const MAX_JSON = 512 * 1024;

function clean(events: unknown): ScaleEvent[] {
  if (!Array.isArray(events) || events.length > MAX_EVENTS) {
    throw new ServiceError("Zu viele oder ungültige Ereignisse.");
  }
  return events.map((event) => {
    if (!event || typeof event !== "object") throw new ServiceError("Ungültiges Ereignis.");
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(event as Record<string, unknown>).slice(0, 12)) {
      if (key.length > 24) continue;
      if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
      else if (typeof value === "boolean") out[key] = value;
      else if (typeof value === "string") out[key] = value.slice(0, 600);
      else if (Array.isArray(value)) out[key] = value.filter((v) => typeof v === "string").slice(0, 12).map((v) => String(v).slice(0, 40));
    }
    if (typeof out.t !== "number" || typeof out.type !== "string") throw new ServiceError("Ereignis ohne Zeit oder Art.");
    return out as ScaleEvent;
  });
}

/** Legt einen Mitschnitt an oder ersetzt die Ereignisse eines eigenen. */
export async function saveScaleCapture(
  user: User,
  input: { id?: string | null; deviceName?: string | null; client?: string | null; events: unknown },
): Promise<string> {
  const events = JSON.stringify(clean(input.events));
  if (events.length > MAX_JSON) throw new ServiceError("Mitschnitt zu groß.");
  const deviceName = input.deviceName?.slice(0, 80) ?? null;
  const client = input.client?.slice(0, 300) ?? null;
  const now = Math.floor(Date.now() / 1000);

  if (input.id) {
    const updated = await db
      .update(scaleCaptures)
      .set({ events, deviceName, updatedAt: now })
      .where(and(eq(scaleCaptures.id, input.id), eq(scaleCaptures.userId, user.id)))
      .returning({ id: scaleCaptures.id });
    if (updated.length) return input.id;
  }
  const id = newId();
  await db.insert(scaleCaptures).values({ id, userId: user.id, deviceName, client, events });
  return id;
}

export async function listScaleCaptures(userId: string, limit = 10) {
  const rows = await db
    .select()
    .from(scaleCaptures)
    .where(eq(scaleCaptures.userId, userId))
    .orderBy(desc(scaleCaptures.createdAt))
    .limit(limit);
  return rows.map((row) => ({ ...row, events: JSON.parse(row.events) as ScaleEvent[] }));
}
