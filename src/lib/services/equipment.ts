import "server-only";

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/db";
import {
  equipment,
  equipmentImages,
  exercises,
  users,
  workoutSets,
  type EquipmentKind,
  type LoadUnit,
  type User,
} from "@/db/schema";
import { newId } from "@/lib/ids";
import { removeImage, storeImage } from "@/lib/images";
import { assertCanDeleteCatalog, assertNameFree, nameKey } from "@/lib/services/catalog";
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
  perSide?: boolean;
  loadUnit?: LoadUnit;
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

async function equipmentNames() {
  return db.select({ id: equipment.id, name: equipment.name }).from(equipment);
}

export async function createEquipment(user: User, input: EquipmentInput): Promise<string> {
  assertNameFree(await equipmentNames(), input.name, "Ein Gerät");
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
  const current = await requireEquipment(equipmentId);
  if (nameKey(input.name) !== nameKey(current.name)) {
    assertNameFree(await equipmentNames(), input.name, "Ein Gerät", equipmentId);
  }
  try {
    await db.update(equipment).set(input).where(eq(equipment.id, equipmentId));
  } catch (error) {
    if (isDuplicateName(error)) throw new ServiceError("Ein Gerät mit diesem Namen gibt es schon.");
    throw error;
  }
  // Übersetzung und Eigengewicht gelten für alle, die das Gerät benutzen.
  await recomputeVolumes({ equipmentId });
}

/** Hängen an einer Maschine Sätze – bei irgendeinem Nutzer? */
export async function equipmentHasHistory(equipmentId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: workoutSets.id })
    .from(workoutSets)
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(eq(exercises.equipmentId, equipmentId))
    .limit(1);
  return Boolean(row);
}

/**
 * Löscht eine Maschine samt Fotos und Zuordnungen – nur, solange niemand an
 * ihr trainiert hat. Mit Verlauf würden die Varianten aller Nutzer
 * stillschweigend zu „ohne Gerät“; dann ist Archivieren der Weg.
 */
export async function deleteEquipment(user: User, equipmentId: string): Promise<void> {
  const current = await requireEquipment(equipmentId);
  await assertCanDeleteCatalog(user, current.userId, `Das Gerät „${current.name}“`);
  if (await equipmentHasHistory(equipmentId)) {
    throw new ServiceError(
      `An „${current.name}“ wurde schon trainiert – Löschen würde den Verlauf vom Gerät trennen. Archiviere die Maschine stattdessen.`,
    );
  }
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

/**
 * Archivieren blendet eine Maschine aus Auswahllisten und Vorschlägen aus;
 * Verlauf, Fotos und Zuordnungen bleiben. Rückgängig jederzeit. Gemeinsamer
 * Katalog: darf jeder, wie Bearbeiten.
 */
export async function setEquipmentArchived(equipmentId: string, archived: boolean): Promise<void> {
  await requireEquipment(equipmentId);
  await db
    .update(equipment)
    .set({ archivedAt: archived ? Math.floor(Date.now() / 1000) : null })
    .where(eq(equipment.id, equipmentId));
}

export async function addEquipmentImage(
  user: Pick<User, "id">,
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
/**
 * Rechnet das bewegte Gewicht bestehender Sätze neu. Normalerweise nur für
 * Gewicht × Wiederholungen (Übersetzung, Eigengewicht). `allModes` nimmt die
 * übrigen Messarten dazu – nur beim Wechsel der Messart, denn bei
 * Körpergewichts-Übungen gilt dann das heutige Körpergewicht auch für alte
 * Sätze.
 */
export async function recomputeVolumes(
  scope: { equipmentId: string } | { exerciseIds: string[] },
  { allModes = false }: { allModes?: boolean } = {},
): Promise<void> {
  const targets = await db
    .select({
      id: exercises.id,
      trackingMode: exercises.trackingMode,
      loadFactor: equipment.loadFactor,
      baseLoadKg: equipment.baseLoadKg,
      perSide: equipment.perSide,
      loadUnit: equipment.loadUnit,
      // Das Körpergewicht wird nicht pro Satz gespeichert – es gilt das
      // aktuelle aus dem Profil, wie beim Erfassen.
      bodyweightKg: users.bodyweightKg,
    })
    .from(exercises)
    .innerJoin(users, eq(users.id, exercises.userId))
    .leftJoin(equipment, eq(equipment.id, exercises.equipmentId))
    .where(
      and(
        allModes ? undefined : eq(exercises.trackingMode, "weight_reps"),
        "equipmentId" in scope
          ? eq(exercises.equipmentId, scope.equipmentId)
          : scope.exerciseIds.length > 0
            ? inArray(exercises.id, scope.exerciseIds)
            : sql`0`,
      ),
    );

  // Dieselbe Rechnung wie setVolume in lib/training.ts, nur in SQL.
  for (const target of targets) {
    const factor = (target.loadFactor ?? 1) * (target.perSide ? 2 : 1);
    const base = target.baseLoadKg ?? 0;
    const bodyweight = target.bodyweightKg;
    const volume =
      target.trackingMode === "time"
        ? sql`0`
        : target.trackingMode === "bodyweight_reps"
          ? sql`max(0, (${bodyweight} + ${workoutSets.weightKg}) * ${workoutSets.reps})`
          : target.trackingMode === "assisted_reps"
            ? sql`max(0, ${bodyweight} - ${workoutSets.weightKg}) * ${workoutSets.reps}`
            : target.loadUnit === "level"
              ? sql`0`
              : sql`max(0, (${base} + ${workoutSets.weightKg} * ${factor}) * ${workoutSets.reps})`;
    await db
      .update(workoutSets)
      .set({ volumeKg: volume })
      .where(eq(workoutSets.exerciseId, target.id));
  }
}
