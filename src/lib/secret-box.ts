import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Verschlüsselt Geheimnisse der Nutzer (z. B. ihren Anthropic-API-Schlüssel)
 * mit AES-256-GCM. Der Schlüssel dazu liegt NICHT in der Datenbank:
 *
 * - SECRET_KEY aus der Umgebung, falls gesetzt (empfohlen), sonst
 * - die Datei secret.key neben der Datenbank, beim ersten Bedarf erzeugt.
 *
 * Eine Sicherung der gym.db allein öffnet die Schlüssel also nicht. Geht
 * secret.key verloren, müssen die Nutzer ihre API-Schlüssel neu eintragen.
 */

let cached: Buffer | null = null;

function dataKey(): Buffer {
  if (cached) return cached;
  const fromEnv = process.env.SECRET_KEY?.trim();
  if (fromEnv) {
    // Ein kurzes Passwort wäre per Wörterbuch zu raten – der SHA-256 macht es nicht stärker.
    if (fromEnv.length < 32) throw new Error("SECRET_KEY muss mindestens 32 Zeichen lang sein.");
    cached = createHash("sha256").update(fromEnv).digest();
    return cached;
  }
  const dbPath = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? "./data/gym.db");
  const file = join(dirname(dbPath), "secret.key");
  if (!existsSync(file)) {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, randomBytes(32).toString("base64"), { mode: 0o600, flag: "wx" });
  }
  chmodSync(file, 0o600);
  cached = Buffer.from(readFileSync(file, "utf8").trim(), "base64");
  return cached;
}

/** "v1.<iv>.<tag>.<ciphertext>", alles base64url. */
export function seal(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", dataKey(), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return ["v1", iv, cipher.getAuthTag(), data].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

/** null, wenn der Wert nicht (mehr) zu öffnen ist – etwa nach neuem SECRET_KEY. */
export function open(sealed: string): string | null {
  const [version, iv, tag, data] = sealed.split(".");
  if (version !== "v1" || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey(), Buffer.from(iv, "base64url"));
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
