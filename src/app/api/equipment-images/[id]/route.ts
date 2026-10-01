import { getCurrentUser } from "@/lib/auth";
import { readImage } from "@/lib/images";
import { imageExists } from "@/lib/services/equipment";

/**
 * Gerätefotos liegen nicht öffentlich, sondern im Daten-Verzeichnis. Sie
 * gehören zum gemeinsamen Katalog: jeder angemeldete Nutzer der Instanz
 * sieht sie, sonst niemand. `?thumb` liefert das Vorschaubild.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user || !/^[a-z0-9]+$/.test(id) || !(await imageExists(id))) {
    return new Response("Nicht gefunden", { status: 404 });
  }

  const thumb = new URL(request.url).searchParams.has("thumb");
  const data = await readImage(id, thumb);
  if (!data) return new Response("Nicht gefunden", { status: 404 });

  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": "image/webp",
      // Die ID ändert sich mit jedem neuen Foto – der Inhalt dahinter nie.
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
}
