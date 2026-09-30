import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

import * as schema from "./schema";

function createConnection() {
  // turbopackIgnore verhindert, dass der Bundler wegen des dynamischen Pfads
  // das komplette Projekt in den Standalone-Output traced.
  const path = resolve(/* turbopackIgnore: true */ process.env.DATABASE_PATH ?? "./data/gym.db");
  mkdirSync(/* turbopackIgnore: true */ dirname(path), { recursive: true });

  const sqlite = new Database(path);
  sqlite.pragma("busy_timeout = 5000");
  enableWal(sqlite);
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
}

/**
 * WAL überlebt Neustarts besser und erlaubt Lesen während Schreibvorgängen.
 *
 * Die Umstellung wartet nicht auf busy_timeout: Hat ein anderer Prozess die
 * Datei gerade offen, kommt sofort SQLITE_BUSY. Genau das passiert beim
 * Build, wenn mehrere Worker gleichzeitig eine frische Datenbank öffnen.
 * Der Modus bleibt in der Datei gespeichert – sobald einer durch ist, geht
 * es für alle anderen ohne Sperre.
 */
function enableWal(sqlite: Database.Database): void {
  for (let attempt = 1; ; attempt++) {
    try {
      sqlite.pragma("journal_mode = WAL");
      return;
    } catch (error) {
      const busy = (error as { code?: string }).code === "SQLITE_BUSY";
      if (!busy || attempt >= 100) throw error;
      // Synchron warten: das Modul wird synchron ausgewertet.
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

// Next.js lädt Module im Dev-Modus bei jeder Änderung neu – ohne Cache würden
// sich sonst immer mehr offene SQLite-Handles ansammeln.
const globalForDb = globalThis as unknown as {
  __gymtrackerDb?: ReturnType<typeof createConnection>;
};

export const db = globalForDb.__gymtrackerDb ?? createConnection();

if (process.env.NODE_ENV !== "production") {
  globalForDb.__gymtrackerDb = db;
}

export { schema };
