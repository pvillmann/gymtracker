import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { db } from "./connection";

/** So viele Sicherungen vor Migrationen bleiben liegen, ältere fallen weg. */
const KEEP_BACKUPS = 5;

/**
 * Wie viele Migrationen noch fehlen – nach derselben Regel wie Drizzle:
 * fällig ist jede, deren Zeitstempel (`when` im Journal) nach dem der
 * zuletzt angewandten liegt. Fehlt die Buchführungstabelle, ist die
 * Datenbank neu oder stammt aus der Zeit vor den Migrationen.
 */
function pendingMigrations(folder: string): { pending: number; fresh: boolean; next?: string } {
  const journal = JSON.parse(readFileSync(join(folder, "meta", "_journal.json"), "utf8")) as {
    entries: Array<{ tag: string; when: number }>;
  };
  const sqlite = db.$client;
  const table = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'")
    .get();
  if (!table) {
    const anyTable = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' LIMIT 1").get();
    return { pending: journal.entries.length, fresh: !anyTable };
  }
  const last = sqlite
    .prepare("SELECT max(created_at) AS at FROM __drizzle_migrations")
    .get() as { at: number | null };
  const due = journal.entries.filter((e) => last.at === null || e.when > last.at);
  return { pending: due.length, fresh: false, next: due[0]?.tag };
}

/**
 * Sichert die Datenbank, bevor Migrationen sie verändern. Geht eine
 * Migration schief, startet der Container nicht – mit der Sicherung lässt
 * sich der alte Stand samt altem Image wiederherstellen.
 *
 * VACUUM INTO schreibt eine konsistente Kopie, auch im WAL-Modus und ohne
 * die laufende Verbindung anzuhalten.
 */
function backupBeforeMigrating(next: string | undefined): string | null {
  const dbFile = db.$client.name;
  if (!dbFile || dbFile === ":memory:" || !existsSync(dbFile)) return null;

  const dir = join(dirname(dbFile), "backups");
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(dir, `gym-${stamp}-vor-${next ?? "migration"}.db`);
  db.$client.prepare("VACUUM INTO ?").run(target);

  const old = readdirSync(dir)
    .filter((f) => f.startsWith("gym-") && f.endsWith(".db"))
    .sort()
    .slice(0, -KEEP_BACKUPS);
  for (const file of old) rmSync(join(dir, file));
  return target;
}

export function runMigrations() {
  const folder = resolve(process.cwd(), "drizzle");
  const { pending, fresh, next } = pendingMigrations(folder);
  if (pending > 0 && !fresh && process.env.DB_BACKUP_BEFORE_MIGRATION !== "false") {
    const file = backupBeforeMigrating(next);
    if (file) console.log(`[db] ${pending} Migration(en) ausstehend – Sicherung: ${file}`);
  }
  migrate(db, { migrationsFolder: folder });
}

// Direkt ausführbar über `npm run db:migrate`.
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations();
  console.log("Migrationen angewendet.");
}
