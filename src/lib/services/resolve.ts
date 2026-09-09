import "server-only";

import type { User } from "@/db/schema";
import { listExercises, listPlans } from "@/lib/queries";
import { ServiceError } from "@/lib/services/errors";

/**
 * Auflösung von Namen zu Datensätzen.
 *
 * Ein Sprachmodell spricht Namen, keine IDs – und es spricht sie so, wie ein
 * Mensch sie sagt: "Latzug" für "Latzug breit", "klimmzuege" ohne Umlaut.
 * Bleibt es mehrdeutig, wird bewusst ein Fehler mit allen Kandidaten
 * zurückgegeben, damit das Modell nachfragen kann statt zu raten.
 */

/** Kleinschreibung, Umlaute aufgelöst, Mehrfach-Leerzeichen zusammengezogen. */
function normalize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("ä", "ae")
    .replaceAll("ö", "oe")
    .replaceAll("ü", "ue")
    .replaceAll("ß", "ss")
    .replace(/\s+/g, " ")
    .trim();
}

type Named = { id: string; name: string };

/** Grammatisches Geschlecht, damit die Meldungen deutsch klingen. */
type Label = { noun: string; feminine: boolean };

function pick<T extends Named>(query: string, candidates: T[], label: Label): T {
  const { noun } = label;
  const kein = label.feminine ? "Keine" : "Kein";

  const needle = normalize(query);
  if (!needle) {
    throw new ServiceError(`Bitte ${label.feminine ? "eine" : "einen"} ${noun} angeben.`);
  }

  const exact = candidates.filter((c) => normalize(c.name) === needle);
  if (exact.length === 1) return exact[0];

  const prefix = candidates.filter((c) => normalize(c.name).startsWith(needle));
  if (prefix.length === 1) return prefix[0];

  const partial = candidates.filter((c) => normalize(c.name).includes(needle));
  if (partial.length === 1) return partial[0];

  // Mehrere Treffer: nicht raten, sondern die Auswahl zurückgeben.
  const matches = prefix.length > 0 ? prefix : partial;
  if (matches.length > 1) {
    throw new ServiceError(
      `„${query}“ passt auf mehrere Einträge: ${matches
        .map((m) => m.name)
        .join(", ")}. Bitte genauer angeben.`,
    );
  }

  const available = candidates.map((c) => c.name).join(", ");
  throw new ServiceError(
    available
      ? `${kein} ${noun} namens „${query}“ gefunden. Vorhanden: ${available}.`
      : `Es ist noch ${kein.toLowerCase()} ${noun} angelegt.`,
  );
}

export async function resolveExercise(
  user: User,
  query: string,
  { includeArchived = false } = {},
) {
  const candidates = await listExercises(user.id, { includeArchived });
  return pick(query, candidates, { noun: "Übung", feminine: true });
}

export async function resolvePlan(user: User, query: string) {
  const candidates = await listPlans(user.id);
  const active = candidates.filter((plan) => plan.archivedAt === null);
  return pick(query, active.length > 0 ? active : candidates, {
    noun: "Plan",
    feminine: false,
  });
}
