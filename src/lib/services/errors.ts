/**
 * Fehler mit einer Meldung, die direkt einem Menschen gezeigt werden kann.
 *
 * Die Server Actions machen daraus eine Formularmeldung, der MCP-Server einen
 * Werkzeug-Fehler. Alles andere ist ein Programmierfehler und darf durchfallen.
 */
export class ServiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ServiceError";
  }
}

export function isServiceError(error: unknown): error is ServiceError {
  return error instanceof ServiceError;
}
