/**
 * Frische Datenbank für die Browser-Tests: zwei bestätigte Konten (Anna ist
 * Administratorin, damit die Instanz als eingerichtet gilt), eine Übung und
 * ein Plan, der ohne Studio-Abfrage startet.
 */
import { mkdirSync, rmSync } from "node:fs";
import { dirname, resolve } from "node:path";

const path = resolve(process.env.DATABASE_PATH ?? "e2e/.data/e2e.db");
mkdirSync(dirname(path), { recursive: true });
for (const suffix of ["", "-wal", "-shm"]) rmSync(path + suffix, { force: true });
process.env.DATABASE_PATH = path;

const { runMigrations } = await import("../src/db/migrate");
runMigrations();
const { db } = await import("../src/db/connection");
const s = await import("../src/db/schema");
const { hashPassword } = await import("../src/lib/password");

export const PASSWORD = "geheim-e2e-123";
const passwordHash = await hashPassword(PASSWORD);
const now = Math.floor(Date.now() / 1000);

await db.insert(s.users).values([
  { id: "u-anna", email: "anna@e2e.local", name: "Anna", passwordHash, emailVerifiedAt: now },
  { id: "u-ben", email: "ben@e2e.local", name: "Ben", passwordHash, emailVerifiedAt: now },
  { id: "u-cara", email: "cara@e2e.local", name: "Cara", passwordHash, emailVerifiedAt: now },
]);
await db.insert(s.groups).values({ id: "g-admin", slug: "administrators", name: "Administratoren", isSystem: true });
await db.insert(s.groupMembers).values({ groupId: "g-admin", userId: "u-anna" });
await db.insert(s.movements).values({ id: "m-squat", userId: "u-anna", name: "Kniebeuge E2E", muscleGroup: "Beine", trackingMode: "weight_reps" });
await db.insert(s.plans).values({ id: "p-beine", userId: "u-anna", name: "Beine E2E", notes: "privat", rememberGym: true });
await db.insert(s.planExercises).values({
  id: "pe-1",
  planId: "p-beine",
  movementId: "m-squat",
  position: 0,
  targetSets: 3,
  targetRepsMin: 8,
  targetRepsMax: 10,
  restSeconds: 90,
  notes: "tief runter",
});
// Ein vergangenes Training: 3 × 10 mit 100 kg, oberes Ende des Plans (8–10)
// geschafft – heute schlägt die App +2,5 kg vor. Über die echten Services,
// damit Varianten, Volumen und Satznummern stimmen.
const { eq } = await import("drizzle-orm");
const { getOrCreateVariant } = await import("../src/lib/services/machines");
const workouts = await import("../src/lib/services/workouts");
const [anna] = await db.select().from(s.users).where(eq(s.users.id, "u-anna"));
const variant = await getOrCreateVariant(anna, "m-squat", null);
const { workoutId } = await workouts.startWorkout(anna, "p-beine");
for (let i = 0; i < 3; i++) {
  await workouts.logSet(anna, workoutId, variant, { weightKg: 100, reps: 10, effort: i === 2 ? "ok" : null });
}
await workouts.finishWorkout(anna, workoutId);

// Cara hat letzte Woche an vier Tagen gegessen, mit wenig Eiweiß – für den Wochenrückblick.
const { logMeal } = await import("../src/lib/services/nutrition");
const { lastWeekStart } = await import("../src/lib/services/weekly-review");
const [cara] = await db.select().from(s.users).where(eq(s.users.id, "u-cara"));
for (let i = 0; i < 4; i++) {
  await logMeal(cara, { description: `Tag ${i}`, kcal: 2100, proteinG: 70, eatenAt: lastWeekStart() + i * 86_400 + 12 * 3600 });
}

console.log(`[e2e] Testdatenbank angelegt: ${path}`);
