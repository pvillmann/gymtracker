import "server-only";

import { desc, eq, lt } from "drizzle-orm";
import { cache } from "react";
import {
  createHash,
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import { db } from "@/db";
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  users,
  type User,
} from "@/db/schema";

const scrypt = promisify(scryptCallback) as (
  password: string,
  salt: Buffer,
  keylen: number,
) => Promise<Buffer>;

const SESSION_COOKIE = "gym_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 90; // 90 Tage
const KEY_LENGTH = 64;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH);
  return `scrypt$${salt.toString("hex")}$${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split("$");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  const derived = await scrypt(password, Buffer.from(saltHex, "hex"), expected.length);
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

/** SHA-256 eines Tokens – dieselbe Funktion für Sessions, Verifizierungs- und
 * Reset-Links, damit nirgendwo ein Klartext-Token in der DB landet. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/**
 * Entscheidet, ob das Session-Cookie als "secure" gesetzt wird.
 *
 * Ein hart auf true gesetztes secure-Flag würde den Login über einfaches HTTP
 * (z. B. http://nas.local:3000 im Heimnetz) stillschweigend unmöglich machen:
 * Der Browser nimmt das Cookie dann gar nicht erst an. Deshalb richtet es sich
 * nach dem tatsächlichen Protokoll. COOKIE_SECURE=true erzwingt es für
 * Reverse Proxies, die kein X-Forwarded-Proto mitschicken.
 */
async function useSecureCookie(): Promise<boolean> {
  if (process.env.COOKIE_SECURE === "true") return true;
  if (process.env.COOKIE_SECURE === "false") return false;

  const forwarded = (await headers()).get("x-forwarded-proto");
  return forwarded?.split(",")[0]?.trim() === "https";
}

/**
 * Legt eine Session an und setzt das Cookie. Nur der Hash landet in der DB –
 * wer die Datenbank liest, kann damit keine Session übernehmen.
 */
export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;

  await db.insert(sessions).values({ tokenHash: hashToken(token), userId, expiresAt });

  // Abgelaufene Sessions nebenbei aufräumen – kein Cronjob nötig.
  await db.delete(sessions).where(lt(sessions.expiresAt, Math.floor(Date.now() / 1000)));

  const store = await cookies();
  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: await useSecureCookie(),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
  store.delete(SESSION_COOKIE);
}

/** Der eingeloggte Nutzer, oder null. Pro Request nur einmal ausgeführt. */
export const getCurrentUser = cache(async (): Promise<User | null> => {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({ user: users, expiresAt: sessions.expiresAt })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(eq(sessions.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt < Math.floor(Date.now() / 1000)) return null;

  return row.user;
});

/** Wie getCurrentUser, leitet aber zum Login statt null zurückzugeben. */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

const EMAIL_VERIFICATION_TTL_SECONDS = 60 * 60 * 24; // 24 Stunden
const PASSWORD_RESET_TTL_SECONDS = 60 * 60; // 1 Stunde, sensibler als Verifizierung
/** Kein erneuter Versand, solange schon ein frischer Token existiert. */
const RESEND_THROTTLE_SECONDS = 60;

/**
 * Legt einen Einmal-Token an und gibt den Klartext zurück (nur für den
 * Mail-Link – in der DB landet ausschließlich der Hash).
 */
export async function createEmailVerificationToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  await db.insert(emailVerificationTokens).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: now + EMAIL_VERIFICATION_TTL_SECONDS,
  });
  await db
    .delete(emailVerificationTokens)
    .where(lt(emailVerificationTokens.expiresAt, now));

  return token;
}

/** Prüft, konsumiert (löscht) den Token und gibt die zugehörige userId zurück. */
export async function consumeEmailVerificationToken(
  token: string,
): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select()
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .delete(emailVerificationTokens)
    .where(eq(emailVerificationTokens.tokenHash, row.tokenHash));

  if (row.expiresAt < now) return null;
  return row.userId;
}

/** Ob in den letzten RESEND_THROTTLE_SECONDS schon ein Token verschickt wurde. */
export async function hasRecentEmailVerificationToken(userId: string): Promise<boolean> {
  const cutoff = Math.floor(Date.now() / 1000) - RESEND_THROTTLE_SECONDS;
  const rows = await db
    .select({ createdAt: emailVerificationTokens.createdAt })
    .from(emailVerificationTokens)
    .where(eq(emailVerificationTokens.userId, userId))
    .orderBy(desc(emailVerificationTokens.createdAt))
    .limit(1);

  return (rows[0]?.createdAt ?? 0) > cutoff;
}

export async function createPasswordResetToken(userId: string): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  const now = Math.floor(Date.now() / 1000);

  await db.insert(passwordResetTokens).values({
    tokenHash: hashToken(token),
    userId,
    expiresAt: now + PASSWORD_RESET_TTL_SECONDS,
  });
  await db.delete(passwordResetTokens).where(lt(passwordResetTokens.expiresAt, now));

  return token;
}

export async function consumePasswordResetToken(token: string): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  const rows = await db
    .select()
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, hashToken(token)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  await db
    .delete(passwordResetTokens)
    .where(eq(passwordResetTokens.tokenHash, row.tokenHash));

  if (row.expiresAt < now) return null;
  return row.userId;
}

export async function hasRecentPasswordResetToken(userId: string): Promise<boolean> {
  const cutoff = Math.floor(Date.now() / 1000) - RESEND_THROTTLE_SECONDS;
  const rows = await db
    .select({ createdAt: passwordResetTokens.createdAt })
    .from(passwordResetTokens)
    .where(eq(passwordResetTokens.userId, userId))
    .orderBy(desc(passwordResetTokens.createdAt))
    .limit(1);

  return (rows[0]?.createdAt ?? 0) > cutoff;
}
