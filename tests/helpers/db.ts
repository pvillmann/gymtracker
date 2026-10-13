/**
 * Wegwerf-Datenbank für Service-Tests: eine frische SQLite-Datei je
 * Testdatei (node:test startet jede Datei in einem eigenen Prozess), mit
 * allen Migrationen – also genau das Schema, das auch in Produktion läuft.
 *
 * Die Datenbank-Verbindung wird beim ersten Import geöffnet. Deshalb muss
 * DATABASE_PATH stehen, bevor irgendetwas aus src/ geladen wird: Tests
 * importieren diese Datei zuerst und den Rest per `await import(...)`.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.DATABASE_PATH = join(mkdtempSync(join(tmpdir(), "gymtracker-test-")), "test.db");

let counter = 0;

export async function setupDb() {
  const { runMigrations } = await import("@/db/migrate");
  runMigrations();
  const { db } = await import("@/db/connection");
  const schema = await import("@/db/schema");
  return { db, schema };
}

/** Ein bestätigtes Konto; mit `admin` zusätzlich in der Administratoren-Gruppe. */
export async function makeUser(name: string, { admin = false, bodyweightKg = 80 } = {}) {
  const { db, schema } = await setupDb();
  const { eq } = await import("drizzle-orm");
  const id = `u${++counter}-${name.toLowerCase()}`;
  const [user] = await db
    .insert(schema.users)
    .values({
      id,
      email: `${id}@test.local`,
      passwordHash: "x",
      name,
      bodyweightKg,
      emailVerifiedAt: 1,
    })
    .returning();
  if (admin) {
    let [group] = await db.select().from(schema.groups).where(eq(schema.groups.slug, "administrators"));
    if (!group) {
      [group] = await db
        .insert(schema.groups)
        .values({ id: "g-admin", slug: "administrators", name: "Administratoren", isSystem: true })
        .returning();
    }
    await db.insert(schema.groupMembers).values({ groupId: group.id, userId: id });
  }
  return user;
}
