import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  equipment,
  equipmentImages,
  exercises,
  workoutSets,
  type EquipmentKind,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { removeImage, storeImage } from "@/lib/images";
import { assertCanDeleteCatalog } from "@/lib/services/catalog";
import { ServiceError } from "@/lib/services/errors";

/** Mehr Fotos braucht niemand, um eine Maschine wiederzuerkennen. */
const MAX_IMAGES = 6;

export type EquipmentInput = {
  name: string;
  manufacturer?: string | null;
  model?: string | null;
  kind: EquipmentKind;
  loadFactor: number;
  baseLoadKg: number;
  /** Kleinster Gewichtssprung – steuert die +/− Tasten im Training. */
  weightStepKg?: number;
  notes?: string | null;
};

function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

/** Geräte gehören der ganzen Instanz – jeder darf jedes einer Übung zuordnen. */
export async function requireEquipment(equipmentId: string) {
  const [row] = await db.select().from(equipment).where(eq(equipment.id, equipmentId)).limit(1);
  if (!row) throw new ServiceError("Dieses Gerät gibt es nicht.");
  return row;
}

export async function createEquipment(user: User, input: EquipmentInput): Promise<string> {
  const id = newId();
  try {
    await db.insert(equipment).values({ id, userId: user.id, ...input });
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Ein Gerät mit diesem Namen gibt es schon.");
    throw error;
  }
  return id;
}

export async function updateEquipment(
  user: User,
  equipmentId: string,
  input: EquipmentInput,
): Promise<void> {
  await requireEquipment(equipmentId);
  try {
    await db.update(equipment).set(input).where(eq(equipment.id, equipmentId));
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Ein Gerät mit diesem Namen gibt es schon.");
    throw error;
  }
  // Übersetzung und Eigengewicht gelten für alle, die das Gerät benutzen.
  await recomputeVolumes({ equipmentId });
}

export async function deleteEquipment(user: User, equipmentId: string): Promise<void> {
  const current = await requireEquipment(equipmentId);
  await assertCanDeleteCatalog(user, current.userId, `Das Gerät „${current.name}“`);
  const images = await db
    .select({ id: equipmentImages.id })
    .from(equipmentImages)
    .where(eq(equipmentImages.equipmentId, equipmentId));
  const affected = await db
    .select({ id: exercises.id })
    .from(exercises)
    .where(eq(exercises.equipmentId, equipmentId));

  await db.delete(equipment).where(eq(equipment.id, equipmentId));
  for (const image of images) await removeImage(image.id);
  // Ohne Gerät gilt wieder das eingestellte Gewicht als Last.
  await recomputeVolumes({ exerciseIds: affected.map((e) => e.id) });
}

export async function addEquipmentImage(
  user: User,
  equipmentId: string,
  input: Buffer,
): Promise<string> {
  // Fotos darf jeder beisteuern – sie helfen allen, das Gerät wiederzuerkennen.
  await requireEquipment(equipmentId);
  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(equipmentImages)
    .where(eq(equipmentImages.equipmentId, equipmentId));
  if ((existing?.count ?? 0) >= MAX_IMAGES) {
    throw new ServiceError(`Höchstens ${MAX_IMAGES} Fotos pro Gerät.`);
  }

  const id = newId();
  const stored = await storeImage(id, input);
  await db.insert(equipmentImages).values({ id, equipmentId, uploadedBy: user.id, ...stored });
  return id;
}

/** Löschen darf, wer das Foto hochgeladen hat – oder wer das Gerät pflegen darf. */
export async function deleteEquipmentImage(user: User, imageId: string): Promise<string> {
  const [row] = await db
    .select({
      id: equipmentImages.id,
      equipmentId: equipmentImages.equipmentId,
      uploadedBy: equipmentImages.uploadedBy,
      ownerId: equipment.userId,
    })
    .from(equipmentImages)
    .innerJoin(equipment, eq(equipment.id, equipmentImages.equipmentId))
    .where(eq(equipmentImages.id, imageId))
    .limit(1);
  if (!row) throw new ServiceError("Dieses Foto gibt es nicht.");
  if (row.uploadedBy !== user.id) {
    await assertCanDeleteCatalog(user, row.ownerId, "Dieses Foto");
  }

  await db.delete(equipmentImages).where(eq(equipmentImages.id, imageId));
  await removeImage(imageId);
  return row.equipmentId;
}

/**
 * Fotos gehören zum gemeinsamen Katalog: sichtbar für jeden angemeldeten
 * Nutzer der Instanz, nicht öffentlich.
 */
export async function imageExists(imageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: equipmentImages.id })
    .from(equipmentImages)
    .where(eq(equipmentImages.id, imageId))
    .limit(1);
  return row !== undefined;
}

/**
 * Das vorberechnete Volumen der Sätze an die Übersetzung und das Eigengewicht
 * des Geräts anpassen. Betrifft nur Gewicht × Wiederholungen – bei den anderen
 * Messarten spielt das Gerät für die Last keine Rolle.
 */
export async function recomputeVolumes(
  scope: { equipmentId: string } | { exerciseIds: string[] },
): Promise<void> {
  const targets = await db
    .select({
      id: exercises.id,
      loadFactor: equipment.loadFactor,
      baseLoadKg: equipment.baseLoadKg,
    })
    .from(exercises)
    .leftJoin(equipment, eq(equipment.id, exercises.equipmentId))
    .where(
      and(
        eq(exercises.trackingMode, "weight_reps"),
        "equipmentId" in scope
          ? eq(exercises.equipmentId, scope.equipmentId)
          : scope.exerciseIds.length > 0
            ? inArray(exercises.id, scope.exerciseIds)
            : sql`0`,
      ),
    );

  for (const target of targets) {
    const factor = target.loadFactor ?? 1;
    const base = target.baseLoadKg ?? 0;
    await db
      .update(workoutSets)
      .set({
        volumeKg: sql`max(0, (${base} + ${workoutSets.weightKg} * ${factor}) * ${workoutSets.reps})`,
      })
      .where(eq(workoutSets.exerciseId, target.id));
  }
}
