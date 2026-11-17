import { authenticateHealthToken, importHealthExport } from "@/lib/services/body-metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Großzügig für einen Jahresexport, aber kein Weg, den Speicher zu füllen. */
const MAX_BYTES = 20 * 1024 * 1024;

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/**
 * Import aus Apple Health über die iOS-App „Health Auto Export“
 * (Automation „REST API“, Format JSON). Schlüssel als
 * `Authorization: Bearer gymh_…` – eigener Schlüssel aus den Einstellungen,
 * der nur Körperwerte schreiben kann.
 */
export async function POST(request: Request): Promise<Response> {
  const header = request.headers.get("authorization") ?? "";
  const token = /^bearer\s+(.+)$/i.exec(header)?.[1]?.trim() ?? request.headers.get("x-api-key")?.trim() ?? "";
  const user = token ? await authenticateHealthToken(token) : null;
  if (!user) {
    return json(401, { error: "Ungültiger oder fehlender Schlüssel." }, { "www-authenticate": 'Bearer realm="GymTracker"' });
  }

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES) return json(413, { error: "Export zu groß – kürzeren Zeitraum wählen oder in Teilen senden." });
  const body = await request.text();
  if (body.length > MAX_BYTES) return json(413, { error: "Export zu groß – kürzeren Zeitraum wählen oder in Teilen senden." });

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return json(400, { error: "Kein gültiges JSON. In der Automation das Format JSON wählen." });
  }

  const summary = await importHealthExport(user, payload);
  return json(200, summary);
}

export function GET(): Response {
  return json(405, { error: "Nur POST." }, { allow: "POST" });
}
