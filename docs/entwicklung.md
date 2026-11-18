# Entwicklung

Zurück zum [README](../README.md).

```bash
npm install
npm run db:migrate     # legt data/gym.db an
npm run dev            # http://localhost:3000
```

Nützliche Skripte:

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run build` | Produktions-Build (Standalone-Output für Docker) |
| `npm run typecheck` | TypeScript prüfen |
| `npm run lint` | ESLint mit den Next.js-Regeln (React, Hooks, Barrierefreiheit) |
| `npm test` | Unit- und Service-Tests: Volumen, Zusammenführen, Namensauflösung, Rechte, Teilen – je Testdatei gegen eine frische SQLite-Datenbank |
| `npm run e2e` | Browser-Tests (Playwright) gegen den Produktions-Build – vorher `npm run build`; lokal mit vorhandenem Chromium: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/pfad/zu/chromium` |
| `npm run db:generate` | Migration aus `src/db/schema.ts` erzeugen |
| `npm run db:migrate` | Migrationen anwenden |

## Technik

- **Next.js 16** (App Router, Server Actions) mit **React 19**
- **SQLite** über **better-sqlite3**, Schema und Abfragen mit **Drizzle ORM**
- **Tailwind CSS 4**
- Eigene Auth: scrypt-Passworthashes, Session-, Verifizierungs- und
  Reset-Tokens werden nur als SHA-256-Hash gespeichert — wer die Datenbank
  liest, kann damit weder eine Session übernehmen noch einen Mail-Link fälschen
- Mailversand über **nodemailer** direkt per SMTP, keine Drittanbieter-API
- MCP-Server über das offizielle **@modelcontextprotocol/sdk**, zustandslos
  über Streamable HTTP unter `/api/mcp`
- Diagramme sind handgeschriebenes SVG, keine Chart-Bibliothek
- Docker-Image auf `node:22-trixie-slim` (aktuelle Debian-Stable-Basis)

## Aufbau

```
src/
  app/            Seiten – (auth) für Login/Registrierung, (app) für alles dahinter
    api/mcp/      Der MCP-Endpunkt, Anmeldung per API-Schlüssel
  actions/        Server Actions – dünne Adapter auf die Services
  components/     UI-Bausteine, u. a. der Satz-Logger und die Diagramme
  db/             Drizzle-Schema und SQLite-Verbindung
  lib/            Abfragen, Auth, Mailversand, Statistik, Formatierung
    services/     Fachlogik, geteilt von Oberfläche und MCP-Server
    mcp/          Die Werkzeuge, die der MCP-Server anbietet
drizzle/          Generierte SQL-Migrationen
```
