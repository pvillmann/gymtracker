import "server-only";

import { and, asc, eq, isNull } from "drizzle-orm";

import { db } from "@/db";
import {
  exercises,
  gymExercises,
  movementEquipment,
  movements,
  planExercises,
  workoutSets,
  workoutVariants,
  type User,
} from "@/db/schema";
import { canDeleteCatalog } from "@/lib/services/catalog";
import { recomputeVolumes } from "@/lib/services/equipment";
import { logChange } from "@/lib/services/changelog";
import { ServiceError } from "@/lib/services/errors";
import { CONVERTIBLE, movementHasHistory, requireMovement } from "@/lib/services/machines";

export type MergeReport = {
  movedVariants: number;
  mergedVariants: number;
  movedSets: number;
  movedPlanItems: number;
  droppedPlanItems: number;
  movedMachines: number;
};

/**
 * Führt Übung `source` in `target` zusammen – für Dubletten wie „Kniebeuge
 * Hackenschmidt“ / „Hackenschmidt - Kniebeugen“. Danach gibt es `source`
 * nicht mehr; alles, was an ihr hing, hängt an `target`:
 *
 * - Maschinen-Zuordnungen werden übernommen.
 * - Varianten (Übung × Maschine) jedes Nutzers wandern mit. Hat ein Nutzer
 *   an derselben Maschine schon eine Variante von `target`, werden die Sätze
 *   dorthin gelegt – sonst gäbe es zwei Verläufe für dasselbe Gerät.
 * - Planeinträge aller Nutzer zeigen auf `target`; steht `target` schon im
 *   selben Plan, fällt der Eintrag von `source` weg.
 * - Die Wahl im laufenden Training wird mitgenommen.
 *
 * Alles in einer Transaktion: entweder ganz oder gar nicht. Weil die
 * Übung danach für alle verschwindet, dürfen das nur, wer `source` angelegt
 * hat, und Admins – wie beim Löschen.
 */
export async function mergeMovements(
  user: User,
  sourceId: string,
  targetId: string,
): Promise<MergeReport> {
  if (sourceId === targetId) throw new ServiceError("Eine Übung lässt sich nicht mit sich selbst zusammenführen.");
  const source = await requireMovement(sourceId);
  const target = await requireMovement(targetId);
  if (!(await canDeleteCatalog(user, source.userId))) {
    throw new ServiceError(
      `Zusammenführen löscht „${source.name}“ für alle – das darf nur, wer die Übung angelegt hat, oder ein Administrator.`,
    );
  }

  const modeChanges = source.trackingMode !== target.trackingMode;
  if (
    modeChanges &&
    !CONVERTIBLE.some(([from, to]) => from === source.trackingMode && to === target.trackingMode) &&
    (await movementHasHistory(sourceId))
  ) {
    throw new ServiceError(
      `„${source.name}“ und „${target.name}“ werden unterschiedlich gemessen – die Sätze ließen sich nicht umrechnen. Erst die Messart angleichen (update_exercise).`,
    );
  }

  const report: MergeReport = {
    movedVariants: 0,
    mergedVariants: 0,
    movedSets: 0,
    movedPlanItems: 0,
    droppedPlanItems: 0,
    movedMachines: 0,
  };
  const touched = new Set<string>();

  // better-sqlite3 arbeitet synchron – die Transaktion auch: kein await darin.
  db.transaction((tx) => {
    // 1. Maschinen-Zuordnungen übernehmen.
    const links = tx.select().from(movementEquipment).where(eq(movementEquipment.movementId, sourceId)).all();
    for (const link of links) {
      const inserted = tx
        .insert(movementEquipment)
        .values({ movementId: targetId, equipmentId: link.equipmentId, addedBy: link.addedBy })
        .onConflictDoNothing()
        .run();
      report.movedMachines += inserted.changes;
    }

    // 2. Varianten: mitnehmen oder in die vorhandene Variante legen.
    const variants = tx.select().from(exercises).where(eq(exercises.movementId, sourceId)).all();
    for (const variant of variants) {
      const [twin] = tx
        .select()
        .from(exercises)
        .where(
          and(
            eq(exercises.userId, variant.userId),
            eq(exercises.movementId, targetId),
            variant.equipmentId === null
              ? isNull(exercises.equipmentId)
              : eq(exercises.equipmentId, variant.equipmentId),
          ),
        )
        .orderBy(asc(exercises.archivedAt), asc(exercises.id))
        .limit(1)
        .all();

      if (!twin) {
        // Kein Gegenstück: die Variante zieht um und bekommt den neuen Namen.
        const taken = new Set(
          tx
            .select({ name: exercises.name })
            .from(exercises)
            .where(eq(exercises.userId, variant.userId))
            .all()
            .map((r) => r.name),
        );
        taken.delete(variant.name);
        const base = variant.name.startsWith(source.name)
          ? target.name + variant.name.slice(source.name.length)
          : variant.name;
        let name = base;
        for (let n = 2; taken.has(name); n++) name = `${base} (${n})`;
        tx.update(exercises)
          .set({
            movementId: targetId,
            name,
            muscleGroup: target.muscleGroup,
            trackingMode: target.trackingMode,
          })
          .where(eq(exercises.id, variant.id))
          .run();
        report.movedVariants++;
        touched.add(variant.id);
        continue;
      }

      // Gegenstück vorhanden: Sätze, Studio-Einstellungen und Verweise
      // umhängen, dann die leere Variante entfernen.
      const moved = tx
        .update(workoutSets)
        .set({ exerciseId: twin.id })
        .where(eq(workoutSets.exerciseId, variant.id))
        .run();
      report.movedSets += moved.changes;

      const settings = tx.select().from(gymExercises).where(eq(gymExercises.exerciseId, variant.id)).all();
      for (const setting of settings) {
        // Die Einstellung der Zielvariante gilt; fehlt sie, kommt die alte.
        tx.insert(gymExercises)
          .values({ ...setting, exerciseId: twin.id })
          .onConflictDoNothing()
          .run();
      }
      tx.update(workoutVariants)
        .set({ exerciseId: twin.id })
        .where(eq(workoutVariants.exerciseId, variant.id))
        .run();
      tx.update(planExercises)
        .set({ exerciseId: twin.id })
        .where(eq(planExercises.exerciseId, variant.id))
        .run();
      tx.delete(exercises).where(eq(exercises.id, variant.id)).run();

      // Satznummern je Training neu vergeben, falls beide Varianten im
      // selben Training Sätze hatten.
      const sets = tx
        .select({ id: workoutSets.id, workoutId: workoutSets.workoutId })
        .from(workoutSets)
        .where(eq(workoutSets.exerciseId, twin.id))
        .orderBy(asc(workoutSets.workoutId), asc(workoutSets.completedAt), asc(workoutSets.setNumber))
        .all();
      let workout = "";
      let number = 0;
      for (const set of sets) {
        if (set.workoutId !== workout) {
          workout = set.workoutId;
          number = 0;
        }
        tx.update(workoutSets).set({ setNumber: ++number }).where(eq(workoutSets.id, set.id)).run();
      }
      report.mergedVariants++;
      touched.add(twin.id);
    }

    // 3. Planeinträge aller Nutzer.
    const items = tx.select().from(planExercises).where(eq(planExercises.movementId, sourceId)).all();
    for (const item of items) {
      const [already] = tx
        .select({ id: planExercises.id })
        .from(planExercises)
        .where(and(eq(planExercises.planId, item.planId), eq(planExercises.movementId, targetId)))
        .limit(1)
        .all();
      if (already) {
        tx.delete(planExercises).where(eq(planExercises.id, item.id)).run();
        report.droppedPlanItems++;
      } else {
        tx.update(planExercises).set({ movementId: targetId }).where(eq(planExercises.id, item.id)).run();
        report.movedPlanItems++;
      }
    }

    // 4. Wahl in laufenden Trainings.
    const choices = tx.select().from(workoutVariants).where(eq(workoutVariants.movementId, sourceId)).all();
    for (const choice of choices) {
      const [already] = tx
        .select({ workoutId: workoutVariants.workoutId })
        .from(workoutVariants)
        .where(and(eq(workoutVariants.workoutId, choice.workoutId), eq(workoutVariants.movementId, targetId)))
        .limit(1)
        .all();
      if (already) {
        tx.delete(workoutVariants)
          .where(and(eq(workoutVariants.workoutId, choice.workoutId), eq(workoutVariants.movementId, sourceId)))
          .run();
      } else {
        tx.update(workoutVariants)
          .set({ movementId: targetId })
          .where(and(eq(workoutVariants.workoutId, choice.workoutId), eq(workoutVariants.movementId, sourceId)))
          .run();
      }
    }

    // 5. Die Quelle selbst – Zuordnungen gehen per Kaskade mit.
    tx.delete(movements).where(eq(movements.id, sourceId)).run();
  });

  const summary = `${report.movedVariants + report.mergedVariants} Varianten, ${report.movedSets} Sätze zusammengelegt, ${report.movedPlanItems} Planeinträge umgehängt`;
  await logChange(user, "movement", targetId, target.name, "merge", {
    note: `„${source.name}“ ist hierin aufgegangen (${summary})`,
  });
  await logChange(user, "movement", sourceId, source.name, "merge", {
    note: `in „${target.name}“ aufgegangen und gelöscht`,
  });

  // Bei anderer Messart rechnen die umgezogenen Sätze neu; sonst ändert sich
  // an Gerät und Messart nichts, die Volumina stimmen schon.
  if (modeChanges && touched.size > 0) {
    await recomputeVolumes({ exerciseIds: [...touched] }, { allModes: true });
  }
  return report;
}

