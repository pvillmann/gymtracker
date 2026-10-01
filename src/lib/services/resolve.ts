import "server-only";

import type { Exercise, User } from "@/db/schema";
import {
  getLastUsedInGym,
  getPreviousPerformances,
  listEquipment,
  listExercises,
  listMovements,
  listPlans,
  listWorkoutVariants,
} from "@/lib/queries";
import { ServiceError } from "@/lib/services/errors";
import { getOrCreateVariant, machinesForMovement } from "@/lib/services/machines";

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

export async function resolveEquipment(user: User, query: string) {
  const candidates = await listEquipment();
  return pick(query, candidates, { noun: "Gerät", feminine: false });
}

/** Eine Übung (Bewegung) im gemeinsamen Katalog. */
export async function resolveMovement(query: string) {
  const candidates = await listMovements();
  return pick(query, candidates, { noun: "Übung", feminine: true });
}

/** Ein Eintrag in einem Plan, über den Namen seiner Übung. */
export function resolvePlanItem<T extends { id: string; exerciseName: string }>(
  query: string,
  items: T[],
): T {
  const named = items.map((item) => ({ ...item, name: item.exerciseName }));
  return pick(query, named, { noun: "Übung im Plan", feminine: true });
}

const NO_MACHINE = new Set(["ohne gerät", "ohne geraet", "keins", "keine", "ohne", "-"]);

/**
 * Die eigene Variante (Übung × Maschine), auf die ein Satz gebucht oder deren
 * Verlauf gezeigt wird. Angesprochen wird die Übung, die Maschine nur bei
 * Bedarf – sonst gilt, was im Training gewählt ist, dann was im Studio
 * zuletzt benutzt wurde, dann was überhaupt zuletzt benutzt wurde. Mit
 * `create` entsteht eine fehlende Variante, wenn die Maschine eindeutig ist.
 */
export async function resolveVariant(
  user: User,
  query: string,
  options: {
    machine?: string;
    workout?: { id: string; gymId: string | null } | null;
    create?: boolean;
    includeArchived?: boolean;
  } = {},
): Promise<Exercise> {
  const variants = await listExercises(user.id, { includeArchived: true });
  const byId = new Map(variants.map((v) => [v.id, v]));
  const visible = options.includeArchived ? variants : variants.filter((v) => v.archivedAt === null);

  // Ohne Maschinenangabe zählt ein exakt genannter Variantenname, z. B.
  // „Seitheben · Kabelturm“ oder ein alter, frei vergebener Name.
  if (!options.machine) {
    const exact = visible.filter((v) => normalize(v.name) === normalize(query));
    if (exact.length === 1) return exact[0];
  }

  let movement: Awaited<ReturnType<typeof resolveMovement>>;
  try {
    movement = await resolveMovement(query);
  } catch (error) {
    // Alte Namen ohne passende Übung: unscharf über die Varianten suchen.
    if (options.machine) throw error;
    try {
      return pick(query, visible, { noun: "Übung", feminine: true });
    } catch {
      throw error;
    }
  }

  const fetchById = async (id: string) =>
    byId.get(id) ?? (await listExercises(user.id, { includeArchived: true })).find((v) => v.id === id)!;

  if (options.machine) {
    const machineId = NO_MACHINE.has(normalize(options.machine))
      ? null
      : (await resolveEquipment(user, options.machine)).id;
    const existing = variants.find(
      (v) => v.movementId === movement.id && v.equipmentId === machineId,
    );
    if (existing && (options.includeArchived || existing.archivedAt === null || options.create)) {
      if (options.create) await getOrCreateVariant(user, movement.id, machineId);
      return existing;
    }
    if (!options.create) {
      throw new ServiceError(`An „${options.machine}“ wurde „${movement.name}“ noch nie trainiert.`);
    }
    return fetchById(await getOrCreateVariant(user, movement.id, machineId));
  }

  const own = visible.filter((v) => v.movementId === movement.id);

  // Im laufenden Training gewählt?
  if (options.workout) {
    const chosen = (await listWorkoutVariants(options.workout.id)).get(movement.id);
    if (chosen && byId.has(chosen)) return byId.get(chosen)!;
  }
  if (own.length > 0) {
    const ids = own.map((v) => v.id);
    if (options.workout?.gymId) {
      const inGym = await getLastUsedInGym(user.id, options.workout.gymId, ids, options.workout.id);
      const recent = [...inGym.entries()].sort((a, b) => b[1] - a[1])[0];
      if (recent) return byId.get(recent[0])!;
    }
    const previous = await getPreviousPerformances(user.id, ids);
    const recent = [...previous.entries()].sort((a, b) => b[1].performedAt - a[1].performedAt)[0];
    if (recent) return byId.get(recent[0])!;
    if (own.length === 1) return own[0];
  }

  const machines = await machinesForMovement(movement.id, options.workout?.gymId);
  const all = options.workout?.gymId ? await machinesForMovement(movement.id) : machines;
  if (options.create) {
    if (machines.length === 1) return fetchById(await getOrCreateVariant(user, movement.id, machines[0].id));
    if (all.length === 0) return fetchById(await getOrCreateVariant(user, movement.id, null));
  }
  if (own.length === 0 && !options.create) {
    throw new ServiceError(`„${movement.name}“ wurde noch nie trainiert.`);
  }
  const choices = (machines.length > 0 ? machines : all).map((m) => m.name);
  throw new ServiceError(
    `Bei „${movement.name}“ ist die Maschine nicht eindeutig. Zur Wahl: ${
      choices.length > 0 ? choices.join(", ") : own.map((v) => v.name).join(", ")
    }. Bitte mit machine angeben.`,
  );
}
