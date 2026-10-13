import { resolve } from "node:path";

import { defineConfig, devices } from "@playwright/test";

/**
 * Browser-Tests gegen den Produktions-Build (vorher `npm run build`). Der
 * Server läuft auf einer eigenen Testdatenbank, die e2e/seed.mts bei jedem
 * Start frisch anlegt.
 */
const PORT = 3200;
const BASE = `http://127.0.0.1:${PORT}`;
// Absolut: der Standalone-Server wechselt beim Start in .next/standalone.
const DATABASE_PATH = resolve("e2e/.data/e2e.db");

export default defineConfig({
  testDir: "e2e",
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: BASE,
    ...devices["Pixel 7"],
    launchOptions: {
      // Lokal vorinstalliertes Chromium nutzen, falls angegeben.
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined,
    },
  },
  webServer: {
    command: "npx tsx e2e/seed.mts && npm start",
    url: `${BASE}/login`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      DATABASE_PATH,
      PORT: String(PORT),
      HOSTNAME: "127.0.0.1",
      APP_URL: BASE,
      COOKIE_SECURE: "false",
      DB_BACKUP_BEFORE_MIGRATION: "false",
    },
  },
});
