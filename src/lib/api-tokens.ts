import "server-only";

import { and, desc, eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";

import { db } from "@/db";
import { apiTokens, users, type User } from "@/db/schema";
import { sha256Hex } from "@/lib/hash";
import { newId } from "@/lib/ids";

/** Am Präfix erkennt man den Schlüssel in Konfigurationsdateien wieder. */
const PREFIX = "gym_";

export type NewApiToken = { id: string; token: string };

/**
 * Erzeugt einen Schlüssel und gibt ihn im Klartext zurück – das ist die
 * einzige Gelegenheit, ihn zu sehen. Gespeichert wird nur der Hash.
 */
export async function createApiToken(
  userId: string,
  name: string,
): Promise<NewApiToken> {
  const token = `${PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = newId();

  await db.insert(apiTokens).values({
    id,
    userId,
    name,
    tokenHash: sha256Hex(token),
    // Reicht zum Wiedererkennen, aber nicht zum Erraten.
    preview: `${token.slice(0, PREFIX.length + 6)}…`,
  });

  return { id, token };
}

export async function listApiTokens(userId: string) {
  return db
    .select({
      id: apiTokens.id,
      name: apiTokens.name,
      preview: apiTokens.preview,
      lastUsedAt: apiTokens.lastUsedAt,
      createdAt: apiTokens.createdAt,
    })
    .from(apiTokens)
    .where(eq(apiTokens.userId, userId))
    .orderBy(desc(apiTokens.createdAt));
}

export async function revokeApiToken(userId: string, tokenId: string): Promise<void> {
  await db
    .delete(apiTokens)
    .where(and(eq(apiTokens.id, tokenId), eq(apiTokens.userId, userId)));
}

/**
 * Löst einen Schlüssel zum Konto auf. Gesperrte Konten werden abgewiesen –
 * dieselbe Regel wie beim Session-Cookie, sonst wäre der Schlüssel ein
 * Hintereingang an der Sperre vorbei.
 */
export async function authenticateApiToken(token: string): Promise<User | null> {
  if (!token.startsWith(PREFIX)) return null;

  const rows = await db
    .select({ user: users, tokenId: apiTokens.id })
    .from(apiTokens)
    .innerJoin(users, eq(users.id, apiTokens.userId))
    .where(eq(apiTokens.tokenHash, sha256Hex(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.user.disabledAt !== null) return null;
  if (row.user.isSetupAccount) return null;

  await db
    .update(apiTokens)
    .set({ lastUsedAt: Math.floor(Date.now() / 1000) })
    .where(eq(apiTokens.id, row.tokenId));

  return row.user;
}
