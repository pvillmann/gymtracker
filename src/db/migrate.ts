import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { resolve } from "node:path";

import { db } from "./connection";

export function runMigrations() {
  migrate(db, { migrationsFolder: resolve(process.cwd(), "drizzle") });
}

// Direkt ausführbar über `npm run db:migrate`.
if (process.argv[1]?.endsWith("migrate.ts")) {
  runMigrations();
  console.log("Migrationen angewendet.");
}
