export async function register() {
  // Nur im Node-Runtime – better-sqlite3 läuft nicht im Edge-Runtime.
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { runMigrations } = await import("./db/migrate");
  runMigrations();
}
