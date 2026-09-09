import { createHash } from "node:crypto";

/**
 * SHA-256 als Hex. Genutzt für Session-Cookies, Verifizierungs-Links und
 * API-Schlüssel: überall landet nur der Hash in der Datenbank, nie der
 * Klartext.
 */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
