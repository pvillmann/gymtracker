import { isServiceError } from "@/lib/services/errors";
import { inspectPhotoUploadLink, uploadPhotoWithLink } from "@/lib/services/photo-upload";

/**
 * Upload über einen Einmal-Link – bewusst eine feste Route statt einer
 * Server-Action: deren ID ändert sich mit jedem Build, und eine Upload-Seite,
 * die vor einem Deploy geöffnet wurde, bekam beim Absenden 404. Diese Adresse
 * bleibt über Deploys hinweg gleich.
 *
 * Antwort immer JSON: { ok: true } oder { error, code }.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  const { token } = await params;
  const json = (body: object, status: number) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

  const link = await inspectPhotoUploadLink(token);
  if (link.status === "unknown") return json({ error: "Diesen Link gibt es nicht.", code: "unknown" }, 404);
  if (link.status === "used") {
    return json({ error: "Über diesen Link wurde schon ein Foto hochgeladen.", code: "used" }, 410);
  }
  if (link.status === "expired") {
    return json({ error: "Dieser Link ist abgelaufen.", code: "expired", renewable: link.renewable }, 410);
  }

  let file: FormDataEntryValue | null;
  try {
    file = (await request.formData()).get("photo");
  } catch {
    return json({ error: "Das Foto kam nicht vollständig an. Bitte noch einmal versuchen.", code: "body" }, 400);
  }
  if (!(file instanceof File) || file.size === 0) {
    return json({ error: "Bitte ein Foto auswählen.", code: "empty" }, 400);
  }

  try {
    await uploadPhotoWithLink(token, Buffer.from(await file.arrayBuffer()));
  } catch (error) {
    if (isServiceError(error)) return json({ error: error.message, code: "invalid" }, 422);
    throw error;
  }
  return json({ ok: true }, 200);
}
