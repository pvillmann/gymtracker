/**
 * Liest einen Request-Body höchstens bis `maxBytes`. Ein Blick auf
 * Content-Length reicht nicht: Bei „Transfer-Encoding: chunked“ fehlt der
 * Header, und request.text() läse alles in den Speicher.
 * null = zu groß (oder kein Body lesbar).
 */
export async function readBodyLimited(request: Request, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | null> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return null;
  if (!request.body) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}
