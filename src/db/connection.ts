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
  // WAL überlebt Neustarts besser und erlaubt Lesen während Schreibvorgängen.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.pragma("foreign_keys = ON");

  return drizzle(sqlite, { schema });
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
