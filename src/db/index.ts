// Verhindert, dass die Datenbank versehentlich in eine Client-Komponente
// gebündelt wird. Das Migrationsskript importiert direkt aus "./connection".
import "server-only";

export { db, schema } from "./connection";
