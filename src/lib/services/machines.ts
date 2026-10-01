import "server-only";

import { and, asc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  equipment,
  exercises,
  gymEquipment,
  movementEquipment,
  movements,
  type TrackingMode,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { assertCanEditCatalog, canEditCatalog } from "@/lib/services/catalog";
import { requireEquipment } from "@/lib/services/equipment";
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
  await requireMovement(movementId);
  await requireEquipment(equipmentId);
  await db
    .insert(movementEquipment)
    .values({ movementId, equipmentId, addedBy: user.id })
    .onConflictDoNothing();
}

/** Entfernen nur, wer die Zuordnung angelegt hat, oder ein Admin. */
export async function unlinkMovementEquipment(
  user: User,
  movementId: string,
  equipmentId: string,
): Promise<void> {
  const [row] = await db
    .select({ addedBy: movementEquipment.addedBy })
    .from(movementEquipment)
    .where(
      and(eq(movementEquipment.movementId, movementId), eq(movementEquipment.equipmentId, equipmentId)),
    )
    .limit(1);
  if (!row) return;
  if (!(await canEditCatalog(user, row.addedBy ?? ""))) {
    throw new ServiceError("Entfernen kann die Zuordnung nur, wer sie angelegt hat, oder ein Administrator.");
  }
  await db
    .delete(movementEquipment)
    .where(
      and(eq(movementEquipment.movementId, movementId), eq(movementEquipment.equipmentId, equipmentId)),
    );
}

export async function linkGymEquipment(user: User, gymId: string, equipmentId: string): Promise<void> {
  await requireGym(gymId);
  await requireEquipment(equipmentId);
  await db
    .insert(gymEquipment)
    .values({ gymId, equipmentId, addedBy: user.id })
    .onConflictDoNothing();
}

export async function unlinkGymEquipment(user: User, gymId: string, equipmentId: string): Promise<void> {
  const [row] = await db
    .select({ addedBy: gymEquipment.addedBy })
    .from(gymEquipment)
    .where(and(eq(gymEquipment.gymId, gymId), eq(gymEquipment.equipmentId, equipmentId)))
    .limit(1);
  if (!row) return;
  if (!(await canEditCatalog(user, row.addedBy ?? ""))) {
    throw new ServiceError("Entfernen kann die Zuordnung nur, wer sie angelegt hat, oder ein Administrator.");
  }
  await db
    .delete(gymEquipment)
    .where(and(eq(gymEquipment.gymId, gymId), eq(gymEquipment.equipmentId, equipmentId)));
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
  return id;
}

/**
 * Ändert eine Übung für alle – deshalb nur durch den, der sie angelegt hat,
 * oder einen Admin. Muskelgruppe und Messart wandern in die Varianten aller
 * Nutzer mit.
 */
export async function updateMovement(
  user: User,
  movementId: string,
  input: MovementInput,
): Promise<void> {
  const movement = await requireMovement(movementId);
  await assertCanEditCatalog(user, movement.userId, `Die Übung „${movement.name}“`);
  try {
    await db.update(movements).set(input).where(eq(movements.id, movementId));
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Eine Übung mit diesem Namen gibt es schon.");
    throw error;
  }
  await db
    .update(exercises)
    .set({ muscleGroup: input.muscleGroup, trackingMode: input.trackingMode })
    .where(eq(exercises.movementId, movementId));
}
