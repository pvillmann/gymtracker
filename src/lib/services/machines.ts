import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  equipment,
  exercises,
  gymEquipment,
  movementEquipment,
  movements,
  planExercises,
  workoutSets,
  type TrackingMode,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { assertCanDeleteCatalog, assertNameFree, nameKey } from "@/lib/services/catalog";
import { diffFields, logChange } from "@/lib/services/changelog";
import { recomputeVolumes, requireEquipment } from "@/lib/services/equipment";
import { ServiceError } from "@/lib/services/errors";
import { requireGym } from "@/lib/services/gyms";
import { getWgerExercise } from "@/lib/wger";

/**
 * Übung, Maschine, Studio – und dazwischen die Variante.
 *
 * Eine Übung (Bewegung, z. B. Seitheben) passt zu mehreren Maschinen, eine
 * Maschine steht in mehreren Studios. Beides ist gemeinsamer Katalog.
 * Privat ist nur die Variante: Übung × Maschine je Nutzer, mit eigenem
 * Verlauf. Sie entsteht von selbst, sobald man an einer Maschine trainiert –
 * von Hand anlegen muss sie niemand mehr.
 */

export async function requireMovement(movementId: string) {
  const [row] = await db.select().from(movements).where(eq(movements.id, movementId)).limit(1);
  if (!row) throw new ServiceError("Diese Übung gibt es nicht.");
  return row;
}

/** Zuordnungen darf jeder anlegen – sie helfen allen. */
export async function linkMovementEquipment(
  user: User,
  movementId: string,
  equipmentId: string,
): Promise<void> {
  const movement = await requireMovement(movementId);
  const machine = await requireEquipment(equipmentId);
  const inserted = await db
    .insert(movementEquipment)
    .values({ movementId, equipmentId, addedBy: user.id })
    .onConflictDoNothing()
    .returning({ movementId: movementEquipment.movementId });
  if (inserted.length > 0) {
    await logChange(user, "movement", movementId, movement.name, "link", { note: `Maschine „${machine.name}“` });
    await logChange(user, "equipment", equipmentId, machine.name, "link", { note: `Übung „${movement.name}“` });
  }
}

/** Korrigieren darf jeder – auch eine falsche Zuordnung entfernen. */
export async function unlinkMovementEquipment(
  user: User,
  movementId: string,
  equipmentId: string,
): Promise<void> {
  const removed = await db
    .delete(movementEquipment)
    .where(
      and(eq(movementEquipment.movementId, movementId), eq(movementEquipment.equipmentId, equipmentId)),
    )
    .returning({ movementId: movementEquipment.movementId });
  if (removed.length > 0) {
    const [movement] = await db.select({ name: movements.name }).from(movements).where(eq(movements.id, movementId));
    const [machine] = await db.select({ name: equipment.name }).from(equipment).where(eq(equipment.id, equipmentId));
    if (movement && machine) {
      await logChange(user, "movement", movementId, movement.name, "unlink", { note: `Maschine „${machine.name}“` });
      await logChange(user, "equipment", equipmentId, machine.name, "unlink", { note: `Übung „${movement.name}“` });
    }
  }
}

export async function linkGymEquipment(user: User, gymId: string, equipmentId: string): Promise<void> {
  const gym = await requireGym(gymId);
  const machine = await requireEquipment(equipmentId);
  const inserted = await db
    .insert(gymEquipment)
    .values({ gymId, equipmentId, addedBy: user.id })
    .onConflictDoNothing()
    .returning({ gymId: gymEquipment.gymId });
  if (inserted.length > 0) {
    await logChange(user, "gym", gymId, gym.name, "link", { note: `Maschine „${machine.name}“` });
    await logChange(user, "equipment", equipmentId, machine.name, "link", { note: `Studio „${gym.name}“` });
  }
}

export async function unlinkGymEquipment(user: User, gymId: string, equipmentId: string): Promise<void> {
  const removed = await db
    .delete(gymEquipment)
    .where(and(eq(gymEquipment.gymId, gymId), eq(gymEquipment.equipmentId, equipmentId)))
    .returning({ gymId: gymEquipment.gymId });
  if (removed.length > 0) {
    const gym = await requireGym(gymId);
    const machine = await requireEquipment(equipmentId);
    await logChange(user, "gym", gymId, gym.name, "unlink", { note: `Maschine „${machine.name}“` });
    await logChange(user, "equipment", equipmentId, machine.name, "unlink", { note: `Studio „${gym.name}“` });
  }
}

/** Die Maschinen einer Übung – auf Wunsch nur die in einem Studio. */
export async function machinesForMovement(movementId: string, gymId?: string | null) {
  const linked = await db
    .select({
      id: equipment.id,
      name: equipment.name,
      weightStepKg: equipment.weightStepKg,
      loadFactor: equipment.loadFactor,
      baseLoadKg: equipment.baseLoadKg,
    })
    .from(movementEquipment)
    .innerJoin(equipment, eq(equipment.id, movementEquipment.equipmentId))
    .where(eq(movementEquipment.movementId, movementId))
    .orderBy(asc(equipment.name));
  if (!gymId || linked.length === 0) return linked;

  const here = new Set(
    (
      await db
        .select({ id: gymEquipment.equipmentId })
        .from(gymEquipment)
        .where(
          and(
            eq(gymEquipment.gymId, gymId),
            inArray(
              gymEquipment.equipmentId,
              linked.map((m) => m.id),
            ),
          ),
        )
    ).map((r) => r.id),
  );
  return linked.filter((m) => here.has(m.id));
}

/**
 * Die Variante eines Nutzers für Übung × Maschine (null = ohne Gerät) –
 * gefunden oder neu angelegt. Ihr Name ("Seitheben · Kabelturm") ist nur
 * Anzeige; Messart und Muskelgruppe kommen von der Übung, die Gewichtsstufe
 * von der Maschine.
 */
export async function getOrCreateVariant(
  user: User,
  movementId: string,
  equipmentId: string | null,
): Promise<string> {
  const [existing] = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(
      and(
        eq(exercises.userId, user.id),
        eq(exercises.movementId, movementId),
        equipmentId === null ? isNull(exercises.equipmentId) : eq(exercises.equipmentId, equipmentId),
      ),
    )
    // Aktive Varianten vor archivierten, ältere vor neueren.
    .orderBy(asc(exercises.archivedAt), asc(exercises.id))
    .limit(1);
  if (existing) {
    await db.update(exercises).set({ archivedAt: null }).where(eq(exercises.id, existing.id));
    return existing.id;
  }

  const movement = await requireMovement(movementId);
  const machine = equipmentId ? await requireEquipment(equipmentId) : null;
  if (machine) await linkMovementEquipment(user, movementId, machine.id);

  // Der Name ist pro Nutzer eindeutig – bei einer Kollision mit einer alten,
  // von Hand benannten Übung eine Nummer anhängen.
  const base = machine ? `${movement.name} · ${machine.name}` : movement.name;
  const taken = new Set(
    (
      await db.select({ name: exercises.name }).from(exercises).where(eq(exercises.userId, user.id))
    ).map((r) => r.name),
  );
  let name = base;
  for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;

  const id = newId();
  await db.insert(exercises).values({
    id,
    userId: user.id,
    name,
    movementId,
    equipmentId: machine?.id ?? null,
    muscleGroup: movement.muscleGroup,
    trackingMode: movement.trackingMode,
    weightStepKg: machine?.weightStepKg ?? 2.5,
  });
  return id;
}

async function movementNames() {
  return db.select({ id: movements.id, name: movements.name }).from(movements);
}

export type MovementInput = {
  name: string;
  muscleGroup: string | null;
  trackingMode: TrackingMode;
};

function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/**
 * Legt eine Übung im gemeinsamen Katalog an – auf Wunsch aus wger, dann mit
 * Quelle, Urheber und Lizenz, die der Server selbst bei wger holt.
 */
export async function createMovement(
  user: User,
  input: MovementInput,
  wgerId?: number | null,
): Promise<string> {
  assertNameFree(await movementNames(), input.name, "Eine Übung");
  const source = wgerId ? await getWgerExercise(wgerId) : null;
  const id = newId();
  try {
    await db.insert(movements).values({
      id,
      userId: user.id,
      name: input.name,
      muscleGroup: input.muscleGroup ?? source?.muscleGroup ?? null,
      trackingMode: input.trackingMode,
      ...(source
        ? {
            sourceName: source.name,
            sourceUrl: source.sourceUrl,
            licenseName: source.licenseName,
            licenseUrl: source.licenseUrl,
            licenseAuthor: source.licenseAuthor,
          }
        : {}),
    });
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    throw error;
  }
  await logChange(user, "movement", id, input.name, "create", source ? { note: `aus wger (${source.name})` } : undefined);
  return id;
}

/**
 * Welche Messarten sich ineinander überführen lassen, wenn schon Sätze
 * dranhängen: Gewicht × Wdh. und Körpergewicht + Zusatz messen beide ein
 * aufgelegtes Gewicht (die Hackenschmidt-Kniebeuge mit Scheiben). Gegengewicht
 * bedeutet das Gegenteil, und Zeit hat keine Wiederholungen.
 */
export const CONVERTIBLE: ReadonlyArray<[TrackingMode, TrackingMode]> = [
  ["weight_reps", "bodyweight_reps"],
  ["bodyweight_reps", "weight_reps"],
];

/** Hängen an einer Übung Sätze – bei irgendeinem Nutzer? */
export async function movementHasHistory(movementId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(eq(exercises.movementId, movementId))
    .limit(1);
  return Boolean(row);
}

/**
 * Ändert eine Übung für alle – jeder darf korrigieren. Muskelgruppe und
 * Messart wandern in die Varianten aller Nutzer mit; bei einem Wechsel der
 * Messart wird das bewegte Gewicht bisheriger Sätze neu berechnet.
 */
export async function updateMovement(
  user: User,
  movementId: string,
  input: MovementInput,
): Promise<void> {
  const current = await requireMovement(movementId);
  // Nur bei neuem Namen prüfen – sonst ließe sich eine bestehende Dublette
  // nicht einmal mehr bearbeiten.
  if (nameKey(input.name) !== nameKey(current.name)) {
    assertNameFree(await movementNames(), input.name, "Eine Übung", movementId);
  }
  const modeChanged = current.trackingMode !== input.trackingMode;
  if (
    modeChanged &&
    !CONVERTIBLE.some(([from, to]) => from === current.trackingMode && to === input.trackingMode) &&
    (await movementHasHistory(movementId))
  ) {
    throw new ServiceError(
      `Die Messart von „${current.name}“ lässt sich nicht mehr ändern: bisherige Sätze ließen sich nicht umrechnen. Möglich ist nur der Wechsel zwischen Gewicht × Wiederholungen und Körpergewicht + Zusatz.`,
    );
  }
  try {
    await db.update(movements).set(input).where(eq(movements.id, movementId));
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    throw error;
  }
  const changes = diffFields(current, input, {
    name: "Name",
    muscleGroup: "Muskelgruppe",
    trackingMode: "Messart",
  });
  if (Object.keys(changes).length > 0) {
    await logChange(user, "movement", movementId, input.name, "update", changes);
  }
  const variants = await db
    .update(exercises)
    .set({ muscleGroup: input.muscleGroup, trackingMode: input.trackingMode })
    .where(eq(exercises.movementId, movementId))
    .returning({ id: exercises.id });
  if (modeChanged) {
    await recomputeVolumes({ exerciseIds: variants.map((v) => v.id) }, { allModes: true });
  }
}

/**
 * Archivieren blendet eine Übung aus Auswahllisten aus; Verlauf und
 * Planeinträge bleiben. Gemeinsamer Katalog: darf jeder, wie Bearbeiten.
 */
export async function setMovementArchived(
  user: User,
  movementId: string,
  archived: boolean,
): Promise<void> {
  const movement = await requireMovement(movementId);
  if ((movement.archivedAt !== null) !== archived) {
    await logChange(user, "movement", movementId, movement.name, archived ? "archive" : "restore");
  }
  await db
    .update(movements)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(eq(movements.id, movementId));
}

/**
 * Löscht eine Übung – nur ohne Verlauf (bei allen Nutzern) und nur durch den,
 * der sie angelegt hat, oder einen Admin. Planeinträge aller Nutzer gehen
 * mit; die Zahl wird zurückgegeben, damit man sie nennen kann.
 */
export async function deleteMovement(
  user: User,
  movementId: string,
): Promise<{ removedFromPlans: number }> {
  const movement = await requireMovement(movementId);
  await assertCanDeleteCatalog(user, movement.userId, `Die Übung „${movement.name}“`);
  if (await movementHasHistory(movementId)) {
    throw new ServiceError(
      `An „${movement.name}“ hängt schon Verlauf – Löschen würde ihn vernichten. Archiviere die Übung stattdessen.`,
    );
  }
  const inPlans = await db
    .select({ id: planExercises.id })
    .from(planExercises)
    .where(eq(planExercises.movementId, movementId));
  // Varianten ohne Sätze verweisen noch auf die Übung (ohne Kaskade) – erst sie.
  await db.delete(exercises).where(eq(exercises.movementId, movementId));
  await db.delete(movements).where(eq(movements.id, movementId));
  await logChange(user, "movement", movementId, movement.name, "delete");
  return { removedFromPlans: inPlans.length };
}
