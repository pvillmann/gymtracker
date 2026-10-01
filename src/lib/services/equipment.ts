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
  notes?: string | null;
};

function isDuplicateName(error: unknown): boolean {
  return error instanceof Error && error.message.includes("UNIQUE constraint failed");
}

export async function requireOwnEquipment(userId: string, equipmentId: string) {
  const [row] = await db
    .select()
    .from(equipment)
    .where(and(eq(equipment.id, equipmentId), eq(equipment.userId, userId)))
    .limit(1);
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
  await requireOwnEquipment(user.id, equipmentId);
  try {
    await db.update(equipment).set(input).where(eq(equipment.id, equipmentId));
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Ein Gerät mit diesem Namen gibt es schon.");
    throw error;
  }
  await recomputeVolumes(user.id, { equipmentId });
}

export async function deleteEquipment(user: User, equipmentId: string): Promise<void> {
  await requireOwnEquipment(user.id, equipmentId);
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
  await recomputeVolumes(user.id, { exerciseIds: affected.map((e) => e.id) });
}

export async function addEquipmentImage(
  user: User,
  equipmentId: string,
  input: Buffer,
): Promise<string> {
  await requireOwnEquipment(user.id, equipmentId);
  const [existing] = await db
    .select({ count: sql<number>`count(*)` })
    .from(equipmentImages)
    .where(eq(equipmentImages.equipmentId, equipmentId));
  if ((existing?.count ?? 0) >= MAX_IMAGES) {
    throw new ServiceError(`Höchstens ${MAX_IMAGES} Fotos pro Gerät.`);
  }

  const id = newId();
  const stored = await storeImage(id, input);
  await db.insert(equipmentImages).values({ id, equipmentId, ...stored });
  return id;
}

export async function deleteEquipmentImage(user: User, imageId: string): Promise<string> {
  const [row] = await db
    .select({ id: equipmentImages.id, equipmentId: equipmentImages.equipmentId })
    .from(equipmentImages)
    .innerJoin(equipment, eq(equipment.id, equipmentImages.equipmentId))
    .where(and(eq(equipmentImages.id, imageId), eq(equipment.userId, user.id)))
    .limit(1);
  if (!row) throw new ServiceError("Dieses Foto gibt es nicht.");

  await db.delete(equipmentImages).where(eq(equipmentImages.id, imageId));
  await removeImage(imageId);
  return row.equipmentId;
}

/** Ein Foto nur für seinen Besitzer – die Bilder liegen nicht öffentlich. */
export async function canSeeImage(userId: string, imageId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: equipmentImages.id })
    .from(equipmentImages)
    .innerJoin(equipment, eq(equipment.id, equipmentImages.equipmentId))
    .where(and(eq(equipmentImages.id, imageId), eq(equipment.userId, userId)))
    .limit(1);
  return row !== undefined;
}

/**
 * Das vorberechnete Volumen der Sätze an die Übersetzung und das Eigengewicht
 * des Geräts anpassen. Betrifft nur Gewicht × Wiederholungen – bei den anderen
 * Messarten spielt das Gerät für die Last keine Rolle.
 */
export async function recomputeVolumes(
  userId: string,
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
        eq(exercises.userId, userId),
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
