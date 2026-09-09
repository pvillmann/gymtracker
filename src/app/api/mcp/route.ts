import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { authenticateApiToken } from "@/lib/api-tokens";
import { registerGymTools } from "@/lib/mcp/tools";

// better-sqlite3 läuft nicht im Edge-Runtime, und jede Anfrage ist an einen
// Schlüssel gebunden – hier gibt es nichts zu cachen.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unauthorized(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32001, message: "Ungültiger oder fehlender API-Schlüssel." },
      id: null,
    }),
    {
      status: 401,
      headers: {
        "content-type": "application/json",
        // Sagt dem Client, welches Verfahren erwartet wird.
        "www-authenticate": 'Bearer realm="GymTracker"',
      },
    },
  );
}

function readBearer(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const [scheme, ...rest] = header.split(" ");
  if (scheme.toLowerCase() !== "bearer") return null;
  const token = rest.join(" ").trim();
  return token || null;
}

/**
 * MCP-Endpunkt.
 *
 * Bewusst zustandslos: pro Anfrage wird ein Server samt Transport aufgebaut.
 * Das kostet fast nichts, spart die Sitzungsverwaltung und passt dazu, dass
 * jede Anfrage ohnehin über ihren API-Schlüssel einem Konto zugeordnet wird.
 */
export async function POST(request: Request): Promise<Response> {
  const token = readBearer(request);
  if (!token) return unauthorized();

  const user = await authenticateApiToken(token);
  if (!user) return unauthorized();

  const server = new McpServer(
    { name: "gymtracker", version: "1.0.0" },
    {
      instructions:
        "GymTracker verwaltet Trainingspläne und protokolliert Trainings. " +
        "Frage vor einem Satz mit last_performance nach, was beim letzten Mal " +
        "stand. Übungen und Pläne werden über ihren Namen angesprochen; ist " +
        "ein Name mehrdeutig, nennt die Fehlermeldung die Kandidaten – frage " +
        "dann nach, statt zu raten.",
    },
  );
  registerGymTools(server, user);

  const transport = new WebStandardStreamableHTTPServerTransport({
    // Kein sessionIdGenerator: zustandsloser Betrieb.
    enableJsonResponse: true,
  });

  await server.connect(transport);

  try {
    return await transport.handleRequest(request);
  } finally {
    // Der Server lebt nur für diese eine Anfrage.
    void server.close();
  }
}

/**
 * MCP nutzt GET für den serverseitigen Ereignisstrom. Dieser Server schickt
 * von sich aus nichts, also gibt es hier nichts zu abonnieren.
 */
export function GET(): Response {
  return new Response(
    JSON.stringify({
      jsonrpc: "2.0",
      error: { code: -32000, message: "Dieser Server nutzt nur POST." },
      id: null,
    }),
    { status: 405, headers: { "content-type": "application/json", allow: "POST" } },
  );
}
