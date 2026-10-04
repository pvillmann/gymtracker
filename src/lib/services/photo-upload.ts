import "server-only";

import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "@/db";
import { equipment, photoUploadTokens, type User } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { newId } from "@/lib/ids";
import { addEquipmentImage, requireEquipment } from "@/lib/services/equipment";
import { ServiceError } from "@/lib/services/errors";

/**
 * Einmal-Link für ein Maschinenfoto – das Muster einer vorab signierten
 * Upload-URL. Ein Sprachmodell sieht ein Foto im Chat, kann die Datei aber
 * nicht an ein MCP-Werkzeug weiterreichen; also bekommt der Nutzer einen
 * Link, über den er genau ein Foto hochlädt, ohne sich anmelden zu müssen.
 *
 * Der Link steht im Chatverlauf. Deshalb gilt er kurz, nur einmal und nur
 * für diese eine Maschine; gespeichert wird nur sein Hash.
 */

export const UPLOAD_LINK_MINUTES = 30;
/**
 * Ein abgelaufener, unbenutzter Link lässt sich auf der Upload-Seite selbst
 * erneuern – aber nur bis so lange nach dem ersten Ausstellen. Der neue Link
 * erbt diesen Zeitpunkt, eine Kette von Erneuerungen endet also spätestens
 * hier.
 */
export const UPLOAD_LINK_RENEW_HOURS = 24;

const now = () => Math.floor(Date.now() / 1000);

export function uploadUrl(token: string): string {
  return `${(process.env.APP_URL ?? "").replace(/\/$/, "")}/upload/${token}`;
}

/**
 * Nur Hex-Zeichen: base64url enthält „_“ und „-“, und Chats mit Markdown
 * lesen „_…_“ in einer URL gern als Kursivschrift und zerlegen den Link.
 */
function newToken(): string {
  return randomBytes(32).toString("hex");
}

async function issue(
  userId: string,
  equipmentId: string,
  createdAt = now(),
): Promise<{ url: string; expiresAt: number }> {
  // Alte Links räumen, damit die Tabelle nicht wächst.
  await db
    .delete(photoUploadTokens)
    .where(lt(photoUploadTokens.expiresAt, now() - UPLOAD_LINK_RENEW_HOURS * 3600 - 86_400));

  const token = newToken();
  const expiresAt = now() + UPLOAD_LINK_MINUTES * 60;
  await db.insert(photoUploadTokens).values({
    id: newId(),
    tokenHash: sha256Hex(token),
    equipmentId,
    userId,
    expiresAt,
    createdAt,
  });
  return { url: uploadUrl(token), expiresAt };
}

export async function createPhotoUploadLink(
  user: User,
  equipmentId: string,
): Promise<{ url: string; expiresAt: number }> {
  await requireEquipment(equipmentId);
  return issue(user.id, equipmentId);
}

/**
 * Ersetzt einen abgelaufenen, unbenutzten Link durch einen neuen – direkt von
 * der Upload-Seite aus, ohne Umweg über den Chat. Der alte Link wird dabei
 * ungültig.
 */
export async function renewPhotoUploadLink(token: string): Promise<{ url: string }> {
  const [row] = await db
    .select()
    .from(photoUploadTokens)
    .where(eq(photoUploadTokens.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) throw new ServiceError("Diesen Link gibt es nicht.");
  if (row.usedAt !== null) throw new ServiceError("Über diesen Link wurde schon ein Foto hochgeladen.");
  if (row.expiresAt > now()) throw new ServiceError("Dieser Link ist noch gültig.");
  if (row.createdAt < now() - UPLOAD_LINK_RENEW_HOURS * 3600) {
    throw new ServiceError("Der Link ist zu alt, um ihn zu erneuern. Lass dir im Chat einen neuen geben.");
  }

  // Den alten Link entfernen (nicht als benutzt markieren – sonst meldete seine
  // Seite „Foto gespeichert“). Zwei gleichzeitige Klicks erneuern nur einmal.
  const [claimed] = await db
    .delete(photoUploadTokens)
    .where(and(eq(photoUploadTokens.id, row.id), isNull(photoUploadTokens.usedAt)))
    .returning({ id: photoUploadTokens.id });
  if (!claimed) throw new ServiceError("Dieser Link wurde gerade schon erneuert.");

  const { url } = await issue(row.userId, row.equipmentId, row.createdAt);
  return { url };
}

export type UploadLinkState =
  | { status: "ok"; equipmentId: string; equipmentName: string; expiresAt: number }
  | { status: "used"; equipmentId: string; equipmentName: string }
  | { status: "expired"; renewable: boolean }
  | { status: "unknown" };

/** Was hinter einem Link steckt – für die Upload-Seite. */
export async function inspectPhotoUploadLink(token: string): Promise<UploadLinkState> {
  const [row] = await db
    .select({
      equipmentId: photoUploadTokens.equipmentId,
      equipmentName: equipment.name,
      expiresAt: photoUploadTokens.expiresAt,
      usedAt: photoUploadTokens.usedAt,
      createdAt: photoUploadTokens.createdAt,
    })
    .from(photoUploadTokens)
    .innerJoin(equipment, eq(equipment.id, photoUploadTokens.equipmentId))
    .where(eq(photoUploadTokens.tokenHash, sha256Hex(token)))
    .limit(1);
  if (!row) return { status: "unknown" };
  if (row.usedAt !== null) {
    return { status: "used", equipmentId: row.equipmentId, equipmentName: row.equipmentName };
  }
  if (row.expiresAt <= now()) {
    return {
      status: "expired",
      renewable: row.createdAt >= now() - UPLOAD_LINK_RENEW_HOURS * 3600,
    };
  }
  return {
    status: "ok",
    equipmentId: row.equipmentId,
    equipmentName: row.equipmentName,
    expiresAt: row.expiresAt,
  };
}

/**
 * Lädt das Foto über den Link hoch. Der Link wird vorher atomar belegt, damit
 * zwei gleichzeitige Uploads nicht beide durchgehen; scheitert das Foto
 * (unlesbar, zu groß), wird er wieder frei – ein Tippfehler bei der Auswahl
 * soll den Link nicht kosten.
 */
export async function uploadPhotoWithLink(
  token: string,
  input: Buffer,
): Promise<{ equipmentId: string }> {
  const hash = sha256Hex(token);
  const [claimed] = await db
    .update(photoUploadTokens)
    .set({ usedAt: now() })
    .where(
      and(
        eq(photoUploadTokens.tokenHash, hash),
        isNull(photoUploadTokens.usedAt),
        gt(photoUploadTokens.expiresAt, now()),
      ),
    )
    .returning({
      id: photoUploadTokens.id,
      equipmentId: photoUploadTokens.equipmentId,
      userId: photoUploadTokens.userId,
    });
  if (!claimed) {
    throw new ServiceError("Dieser Link ist abgelaufen oder wurde schon benutzt.");
  }

  try {
    await addEquipmentImage({ id: claimed.userId }, claimed.equipmentId, input);
  } catch (error) {
    await db
      .update(photoUploadTokens)
      .set({ usedAt: null })
      .where(eq(photoUploadTokens.id, claimed.id));
    throw error;
  }
  return { equipmentId: claimed.equipmentId };
}
