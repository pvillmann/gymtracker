import { randomUUID } from "node:crypto";

/** Kurze, sortierbare ID: Zeitstempel-Präfix + Zufallsteil. */
export function newId(): string {
  return `${Date.now().toString(36)}${randomUUID().replaceAll("-", "").slice(0, 12)}`;
}
