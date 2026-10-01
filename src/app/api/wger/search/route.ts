import { getCurrentUser } from "@/lib/auth";
import { isServiceError } from "@/lib/services/errors";
import { searchWger } from "@/lib/wger";

/** Vorschläge aus wger für das Feld "Bewegung" – nur für angemeldete Nutzer. */
export async function GET(request: Request): Promise<Response> {
  if (!(await getCurrentUser())) {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  const term = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return Response.json({ results: await searchWger(term) });
  } catch (error) {
    if (isServiceError(error)) return Response.json({ error: error.message }, { status: 502 });
    throw error;
  }
}
