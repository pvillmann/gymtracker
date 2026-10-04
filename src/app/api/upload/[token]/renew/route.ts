import { isServiceError } from "@/lib/services/errors";
import { renewPhotoUploadLink } from "@/lib/services/photo-upload";

/** Neuer Link für einen abgelaufenen, unbenutzten – direkt von der Upload-Seite. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  try {
    const { url } = await renewPhotoUploadLink(token);
    // Nur den Pfad zurückgeben: der Browser bleibt auf derselben Adresse,
    // auch wenn APP_URL anders lautet als die, über die er gekommen ist.
    return Response.json({ path: new URL(url, "http://x").pathname }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (isServiceError(error)) return Response.json({ error: error.message }, { status: 410 });
    throw error;
  }
}
