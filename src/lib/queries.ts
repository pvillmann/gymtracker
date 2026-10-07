import "server-only";

import {
  and,
  asc,
  count,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  lt,
  ne,
  sql,
} from "drizzle-orm";

import { db } from "@/db";
import {
  equipment,
  equipmentImages,
  exercises,
  gymEquipment,
  gymExercises,
  gyms,
  movementEquipment,
  movements,
  planExercises,
  plans,
  users,
  workouts,
  workoutSets,
  workoutVariants,
  type Equipment,
  type EquipmentImage,
  type Exercise,
  type Gym,
  type GymExercise,
  type Movement,
  type SetEffort,
  type TrackingMode,
} from "@/db/schema";

export async function listExercises(
  userId: string,
  { includeArchived = false } = {},
): Promise<Exercise[]> {
  return db
    .select()
    .from(exercises)
    .where(
      includeArchived
        ? eq(exercises.userId, userId)
        : and(eq(exercises.userId, userId), isNull(exercises.archivedAt)),
    )
    .orderBy(asc(exercises.muscleGroup), asc(exercises.name));
}

export type EquipmentSummary = Equipment & {
  /** Erstes Foto als Vorschaubild, falls vorhanden. */
  imageId: string | null;
  exerciseCount: number;
};

/** Der gemeinsame Gerätekatalog der Instanz. */
export async function listEquipment(): Promise<EquipmentSummary[]> {
  const rows = await db.select().from(equipment).orderBy(asc(equipment.name));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [images, counts] = await Promise.all([
    db
      .select({ id: equipmentImages.id, equipmentId: equipmentImages.equipmentId })
      .from(equipmentImages)
      .where(inArray(equipmentImages.equipmentId, ids))
      .orderBy(asc(equipmentImages.createdAt)),
    // Wie viele Übungen an der Maschine gehen – gemeinsamer Katalog.
    db
      .select({ equipmentId: movementEquipment.equipmentId, count: count() })
      .from(movementEquipment)
      .where(inArray(movementEquipment.equipmentId, ids))
      .groupBy(movementEquipment.equipmentId),
  ]);
  const firstImage = new Map<string, string>();
  for (const image of images) {
    if (!firstImage.has(image.equipmentId)) firstImage.set(image.equipmentId, image.id);
  }
  const countBy = new Map(counts.map((c) => [c.equipmentId, c.count]));

  return rows.map((row) => ({
    ...row,
    imageId: firstImage.get(row.id) ?? null,
    exerciseCount: countBy.get(row.id) ?? 0,
  }));
}

export async function getEquipment(equipmentId: string) {
  const [row] = await db
    .select({ equipment, ownerName: users.name })
    .from(equipment)
    .leftJoin(users, eq(users.id, equipment.userId))
    .where(eq(equipment.id, equipmentId))
    .limit(1);
  return row ? { ...row.equipment, ownerName: row.ownerName } : null;
}

export async function listEquipmentImages(equipmentId: string): Promise<EquipmentImage[]> {
  return db
    .select()
    .from(equipmentImages)
    .where(eq(equipmentImages.equipmentId, equipmentId))
    .orderBy(asc(equipmentImages.createdAt));
}

/** Die Studios der Instanz – gemeinsam für alle Nutzer. */
export async function listGyms(): Promise<Gym[]> {
  return db.select().from(gyms).orderBy(asc(gyms.name));
}

/** Was ein Studio für die Geräte dort abweichend festhält: Übung → Werte. */
export async function getGymExercises(gymId: string): Promise<Map<string, GymExercise>> {
  const rows = await db.select().from(gymExercises).where(eq(gymExercises.gymId, gymId));
  return new Map(rows.map((row) => [row.exerciseId, row]));
}

/** Was die Studios für eine Übung festhalten: Studio → Werte. */
export async function getExerciseGymSettings(
  exerciseId: string,
): Promise<Map<string, GymExercise>> {
  const rows = await db
    .select()
    .from(gymExercises)
    .where(eq(gymExercises.exerciseId, exerciseId));
  return new Map(rows.map((row) => [row.gymId, row]));
}

/** Pro Übung: wann sie zuletzt in diesem Studio trainiert wurde. */
export async function getLastUsedInGym(
  userId: string,
  gymId: string,
  exerciseIds: string[],
  excludeWorkoutId: string,
): Promise<Map<string, number>> {
  if (exerciseIds.length === 0) return new Map();
  const rows = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      lastAt: sql<number>`max(${workouts.startedAt})`,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(
      and(
        eq(workouts.userId, userId),
        eq(workouts.gymId, gymId),
        inArray(workoutSets.exerciseId, exerciseIds),
        ne(workouts.id, excludeWorkoutId),
      ),
    )
    .groupBy(workoutSets.exerciseId);
  return new Map(rows.map((row) => [row.exerciseId, row.lastAt]));
}

/** Die Bewegungen der Instanz – gemeinsam für alle Nutzer. */
export async function listMovements(): Promise<Movement[]> {
  return db.select().from(movements).orderBy(asc(movements.muscleGroup), asc(movements.name));
}

export async function getMovement(movementId: string) {
  const [row] = await db
    .select({ movement: movements, ownerName: users.name })
    .from(movements)
    .leftJoin(users, eq(users.id, movements.userId))
    .where(eq(movements.id, movementId))
    .limit(1);
  return row ? { ...row.movement, ownerName: row.ownerName } : null;
}

export async function getExercise(
  userId: string,
  exerciseId: string,
): Promise<Exercise | null> {
  const rows = await db
    .select()
    .from(exercises)
    .where(and(eq(exercises.id, exerciseId), eq(exercises.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listPlans(userId: string) {
  // Join statt korrelierter Unterabfrage: in einem sql``-Fragment qualifiziert
  // Drizzle Spalten fremder Tabellen nicht, dort würde "plan_id" = "id" landen.
  return db
    .select({
      id: plans.id,
      name: plans.name,
      notes: plans.notes,
      archivedAt: plans.archivedAt,
      createdAt: plans.createdAt,
      exerciseCount: count(planExercises.id),
    })
    .from(plans)
    .leftJoin(planExercises, eq(planExercises.planId, plans.id))
    .where(eq(plans.userId, userId))
    .groupBy(plans.id)
    .orderBy(asc(plans.archivedAt), asc(plans.name));
}

export async function getPlan(userId: string, planId: string) {
  const rows = await db
    .select()
    .from(plans)
    .where(and(eq(plans.id, planId), eq(plans.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export type PlanItem = {
  id: string;
  /** Die Übung (Bewegung) – das, was im Plan steht. */
  movementId: string;
  /** Bevorzugte Variante, falls gesetzt; sonst entscheidet das Training. */
  exerciseId: string | null;
  position: number;
  targetSets: number;
  targetRepsMin: number;
  targetRepsMax: number;
  targetDurationSeconds: number | null;
  restSeconds: number;
  notes: string | null;
  /** Name der Übung. */
  exerciseName: string;
  muscleGroup: string | null;
  trackingMode: TrackingMode;
};

export async function listPlanItems(planId: string): Promise<PlanItem[]> {
  return db
    .select({
      id: planExercises.id,
      movementId: planExercises.movementId,
      exerciseId: planExercises.exerciseId,
      position: planExercises.position,
      targetSets: planExercises.targetSets,
      targetRepsMin: planExercises.targetRepsMin,
      targetRepsMax: planExercises.targetRepsMax,
      targetDurationSeconds: planExercises.targetDurationSeconds,
      restSeconds: planExercises.restSeconds,
      notes: planExercises.notes,
      exerciseName: movements.name,
      muscleGroup: movements.muscleGroup,
      trackingMode: movements.trackingMode,
    })
    .from(planExercises)
    .innerJoin(movements, eq(movements.id, planExercises.movementId))
    .where(eq(planExercises.planId, planId))
    .orderBy(asc(planExercises.position));
}

/** Welche Maschinen zu welchen Übungen passen: Übung → Maschinen-IDs. */
export async function listMachineLinks(
  movementIds?: string[],
): Promise<Map<string, string[]>> {
  if (movementIds && movementIds.length === 0) return new Map();
  const rows = await db
    .select({
      movementId: movementEquipment.movementId,
      equipmentId: movementEquipment.equipmentId,
      addedBy: movementEquipment.addedBy,
    })
    .from(movementEquipment)
    .where(movementIds ? inArray(movementEquipment.movementId, movementIds) : undefined);
  const map = new Map<string, string[]>();
  for (const row of rows) map.set(row.movementId, [...(map.get(row.movementId) ?? []), row.equipmentId]);
  return map;
}

/** Zuordnungen samt "angelegt von" – für Seiten, die sie entfernen lassen. */
export async function listMachineLinkRows() {
  const [movementLinks, gymLinks] = await Promise.all([
    db.select().from(movementEquipment),
    db.select().from(gymEquipment),
  ]);
  return { movementLinks, gymLinks };
}

/** Welche Maschinen in einem Studio stehen. */
/** Eigene abgeschlossene Trainings je Studio: Anzahl und das letzte. */
export async function getGymWorkoutStats(
  userId: string,
): Promise<Map<string, { count: number; lastAt: number }>> {
  const rows = await db
    .select({
      gymId: workouts.gymId,
      count: count(),
      lastAt: sql<number>`max(${workouts.startedAt})`,
    })
    .from(workouts)
    .where(and(eq(workouts.userId, userId), isNotNull(workouts.finishedAt), isNotNull(workouts.gymId)))
    .groupBy(workouts.gymId);
  return new Map(rows.map((r) => [r.gymId!, { count: r.count, lastAt: r.lastAt }]));
}

export async function listGymMachineIds(gymId: string): Promise<Set<string>> {
  const rows = await db
    .select({ id: gymEquipment.equipmentId })
    .from(gymEquipment)
    .where(eq(gymEquipment.gymId, gymId));
  return new Set(rows.map((r) => r.id));
}

/** Im Training gewählte Geräte: Bewegung → Übung. */
export async function listWorkoutVariants(workoutId: string): Promise<Map<string, string>> {
  const rows = await db
    .select({ movementId: workoutVariants.movementId, exerciseId: workoutVariants.exerciseId })
    .from(workoutVariants)
    .where(eq(workoutVariants.workoutId, workoutId));
  return new Map(rows.map((row) => [row.movementId, row.exerciseId]));
}

export async function getWorkout(userId: string, workoutId: string) {
  const rows = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function getActiveWorkout(userId: string) {
  const rows = await db
    .select()
    .from(workouts)
    .where(and(eq(workouts.userId, userId), isNull(workouts.finishedAt)))
    .orderBy(desc(workouts.startedAt))
    .limit(1);
  return rows[0] ?? null;
}

export type LoggedSet = {
  id: string;
  exerciseId: string;
  setNumber: number;
  weightKg: number;
  reps: number;
  durationSeconds: number | null;
  isWarmup: boolean;
  effort: SetEffort | null;
  volumeKg: number;
  completedAt: number;
};

export async function listWorkoutSets(workoutId: string): Promise<LoggedSet[]> {
  return db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      isWarmup: workoutSets.isWarmup,
      effort: workoutSets.effort,
      volumeKg: workoutSets.volumeKg,
      completedAt: workoutSets.completedAt,
    })
    .from(workoutSets)
    .where(eq(workoutSets.workoutId, workoutId))
    .orderBy(asc(workoutSets.exerciseId), asc(workoutSets.setNumber));
}

export type PreviousPerformance = {
  workoutId: string;
  workoutName: string;
  performedAt: number;
  sets: LoggedSet[];
  totalVolumeKg: number;
  topSet: LoggedSet | null;
};

type PreviousRow = {
  id: string;
  workout_id: string;
  workout_name: string;
  started_at: number;
  exercise_id: string;
  set_number: number;
  weight_kg: number;
  reps: number;
  duration_seconds: number | null;
  is_warmup: number;
  effort: SetEffort | null;
  volume_kg: number;
  completed_at: number;
};

/**
 * Das jeweils letzte Training pro Übung – in einer einzigen Abfrage, damit die
 * Trainingsansicht nicht pro Übung eine eigene Query braucht.
 * `excludeWorkoutId` blendet das laufende Training aus, sonst würde es sich
 * selbst als "letztes Mal" sehen.
 */
export async function getPreviousPerformances(
  userId: string,
  exerciseIds: string[],
  options: {
    /** Das laufende bzw. betrachtete Training ausblenden. */
    excludeWorkoutId?: string;
    /** Nur Trainings davor – für die Rückschau auf ein altes Training. */
    beforeStartedAt?: number;
  } = {},
): Promise<Map<string, PreviousPerformance>> {
  const result = new Map<string, PreviousPerformance>();
  if (exerciseIds.length === 0) return result;

  const idList = sql.join(
    exerciseIds.map((id) => sql`${id}`),
    sql`, `,
  );
  const exclude = options.excludeWorkoutId
    ? sql`and w.id <> ${options.excludeWorkoutId}`
    : sql``;
  const before =
    options.beforeStartedAt !== undefined
      ? sql`and w.started_at < ${options.beforeStartedAt}`
      : sql``;

  const rows = db.all<PreviousRow>(sql`
    select id, workout_id, workout_name, started_at, exercise_id, set_number,
           weight_kg, reps, duration_seconds, is_warmup, effort, volume_kg,
           completed_at
    from (
      select s.id             as id,
             s.workout_id     as workout_id,
             w.name           as workout_name,
             w.started_at     as started_at,
             s.exercise_id    as exercise_id,
             s.set_number     as set_number,
             s.weight_kg      as weight_kg,
             s.reps           as reps,
             s.duration_seconds as duration_seconds,
             s.is_warmup      as is_warmup,
             s.effort         as effort,
             s.volume_kg      as volume_kg,
             s.completed_at   as completed_at,
             dense_rank() over (
               partition by s.exercise_id
               order by w.started_at desc, w.id desc
             ) as rk
      from workout_sets s
      join workouts w on w.id = s.workout_id
      where w.user_id = ${userId}
        and s.exercise_id in (${idList})
        ${exclude}
        ${before}
    )
    where rk = 1
    order by exercise_id asc, set_number asc
  `);

  for (const row of rows) {
    const set: LoggedSet = {
      id: row.id,
      exerciseId: row.exercise_id,
      setNumber: row.set_number,
      weightKg: row.weight_kg,
      reps: row.reps,
      durationSeconds: row.duration_seconds,
      isWarmup: Boolean(row.is_warmup),
      effort: row.effort,
      volumeKg: row.volume_kg,
      completedAt: row.completed_at,
    };

    const existing = result.get(row.exercise_id);
    if (existing) {
      existing.sets.push(set);
      existing.totalVolumeKg += set.volumeKg;
    } else {
      result.set(row.exercise_id, {
        workoutId: row.workout_id,
        workoutName: row.workout_name,
        performedAt: row.started_at,
        sets: [set],
        totalVolumeKg: set.volumeKg,
        topSet: null,
      });
    }
  }

  // Der "Top-Satz" ist der schwerste Arbeitssatz – der Wert, an dem man sich
  // beim nächsten Training misst.
  for (const performance of result.values()) {
    const working = performance.sets.filter((s) => !s.isWarmup);
    const candidates = working.length > 0 ? working : performance.sets;
    performance.topSet = candidates.reduce<LoggedSet | null>((best, set) => {
      if (!best) return set;
      if (set.weightKg !== best.weightKg) {
        return set.weightKg > best.weightKg ? set : best;
      }
      return set.reps > best.reps ? set : best;
    }, null);
  }

  return result;
}

export type ExerciseSession = {
  workoutId: string;
  workoutName: string;
  performedAt: number;
  sets: LoggedSet[];
  totalVolumeKg: number;
};

/** Alle Trainings, in denen eine bestimmte Übung vorkam – neueste zuerst. */
export async function getExerciseSessions(
  userId: string,
  exerciseId: string,
  limit = 60,
): Promise<ExerciseSession[]> {
  const rows = await db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      isWarmup: workoutSets.isWarmup,
      effort: workoutSets.effort,
      volumeKg: workoutSets.volumeKg,
      completedAt: workoutSets.completedAt,
      workoutId: workouts.id,
      workoutName: workouts.name,
      performedAt: workouts.startedAt,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .where(and(eq(workouts.userId, userId), eq(workoutSets.exerciseId, exerciseId)))
    .orderBy(desc(workouts.startedAt), asc(workoutSets.setNumber));

  const sessions: ExerciseSession[] = [];
  const index = new Map<string, ExerciseSession>();

  for (const row of rows) {
    let session = index.get(row.workoutId);
    if (!session) {
      if (sessions.length >= limit) break;
      session = {
        workoutId: row.workoutId,
        workoutName: row.workoutName,
        performedAt: row.performedAt,
        sets: [],
        totalVolumeKg: 0,
      };
      index.set(row.workoutId, session);
      sessions.push(session);
    }
    session.sets.push({
      id: row.id,
      exerciseId: row.exerciseId,
      setNumber: row.setNumber,
      weightKg: row.weightKg,
      reps: row.reps,
      durationSeconds: row.durationSeconds,
      isWarmup: row.isWarmup,
      effort: row.effort,
      volumeKg: row.volumeKg,
      completedAt: row.completedAt,
    });
    session.totalVolumeKg += row.volumeKg;
  }

  return sessions;
}

export type WorkoutSummary = {
  id: string;
  name: string;
  startedAt: number;
  finishedAt: number | null;
  setCount: number;
  workingSetCount: number;
  exerciseCount: number;
  totalReps: number;
  volumeKg: number;
};

/**
 * Alle abgeschlossenen Trainings mit ihren Kennzahlen – Grundlage für Verlauf
 * und Statistik. Eine Abfrage reicht, die Auswertung passiert in JS (und damit
 * in der Zeitzone des Servers, statt in UTC-Wochen).
 */
export async function listWorkoutSummaries(
  userId: string,
): Promise<WorkoutSummary[]> {
  return db
    .select({
      id: workouts.id,
      name: workouts.name,
      startedAt: workouts.startedAt,
      finishedAt: workouts.finishedAt,
      setCount: sql<number>`count(${workoutSets.id})`,
      workingSetCount: sql<number>`sum(case when ${workoutSets.isWarmup} then 0 else 1 end)`,
      exerciseCount: sql<number>`count(distinct ${workoutSets.exerciseId})`,
      totalReps: sql<number>`coalesce(sum(${workoutSets.reps}), 0)`,
      volumeKg: sql<number>`coalesce(sum(${workoutSets.volumeKg}), 0)`,
    })
    .from(workouts)
    .leftJoin(workoutSets, eq(workoutSets.workoutId, workouts.id))
    .where(and(eq(workouts.userId, userId), isNotNull(workouts.finishedAt)))
    .groupBy(workouts.id)
    .orderBy(desc(workouts.startedAt));
}

export type ExerciseVolume = {
  exerciseId: string;
  name: string;
  muscleGroup: string | null;
  volumeKg: number;
  setCount: number;
};

export async function getVolumeByExercise(
  userId: string,
): Promise<ExerciseVolume[]> {
  return db
    .select({
      exerciseId: exercises.id,
      name: exercises.name,
      muscleGroup: exercises.muscleGroup,
      volumeKg: sql<number>`coalesce(sum(${workoutSets.volumeKg}), 0)`,
      setCount: sql<number>`count(${workoutSets.id})`,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(and(eq(workouts.userId, userId), isNotNull(workouts.finishedAt)))
    .groupBy(exercises.id)
    .orderBy(desc(sql`sum(${workoutSets.volumeKg})`));
}

export type WorkoutDetailEntry = {
  exerciseId: string;
  name: string;
  muscleGroup: string | null;
  trackingMode: TrackingMode;
  /** Gewicht je Seite bzw. Stufen statt kg – von der Maschine. */
  unit: { perSide: boolean; level: boolean } | null;
  sets: LoggedSet[];
  volumeKg: number;
};

/** Ein einzelnes Training mit allen Sätzen, nach Übungen gruppiert. */
export async function getWorkoutDetail(
  userId: string,
  workoutId: string,
): Promise<WorkoutDetailEntry[]> {
  const rows = await db
    .select({
      id: workoutSets.id,
      exerciseId: workoutSets.exerciseId,
      setNumber: workoutSets.setNumber,
      weightKg: workoutSets.weightKg,
      reps: workoutSets.reps,
      durationSeconds: workoutSets.durationSeconds,
      isWarmup: workoutSets.isWarmup,
      effort: workoutSets.effort,
      volumeKg: workoutSets.volumeKg,
      completedAt: workoutSets.completedAt,
      name: exercises.name,
      muscleGroup: exercises.muscleGroup,
      trackingMode: exercises.trackingMode,
      perSide: equipment.perSide,
      loadUnit: equipment.loadUnit,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .leftJoin(equipment, eq(equipment.id, exercises.equipmentId))
    .where(and(eq(workouts.id, workoutId), eq(workouts.userId, userId)))
    .orderBy(asc(workoutSets.completedAt), asc(workoutSets.setNumber));

  const entries: WorkoutDetailEntry[] = [];
  const index = new Map<string, WorkoutDetailEntry>();

  for (const row of rows) {
    let entry = index.get(row.exerciseId);
    if (!entry) {
      entry = {
        exerciseId: row.exerciseId,
        name: row.name,
        muscleGroup: row.muscleGroup,
        trackingMode: row.trackingMode,
        unit:
          row.perSide === null || row.loadUnit === null
            ? null
            : { perSide: row.perSide, level: row.loadUnit === "level" },
        sets: [],
        volumeKg: 0,
      };
      index.set(row.exerciseId, entry);
      entries.push(entry);
    }
    entry.sets.push({
      id: row.id,
      exerciseId: row.exerciseId,
      setNumber: row.setNumber,
      weightKg: row.weightKg,
      reps: row.reps,
      durationSeconds: row.durationSeconds,
      isWarmup: row.isWarmup,
      effort: row.effort,
      volumeKg: row.volumeKg,
      completedAt: row.completedAt,
    });
    entry.volumeKg += row.volumeKg;
  }

  // Sätze innerhalb einer Übung wieder in ihre eigene Reihenfolge bringen.
  for (const entry of entries) {
    entry.sets.sort((a, b) => a.setNumber - b.setNumber);
  }

  return entries;
}

/**
 * Bestes geschätztes 1RM je Übung vor einem Zeitpunkt – daran erkennt die
 * Trainingsauswertung, ob ein Satz ein neuer persönlicher Rekord war.
 */
export async function getBestsBefore(
  userId: string,
  exerciseIds: string[],
  beforeStartedAt: number,
  bodyweightKg: number,
): Promise<Map<string, number>> {
  const result = new Map<string, number>();
  if (exerciseIds.length === 0) return result;

  const rows = await db
    .select({
      exerciseId: workoutSets.exerciseId,
      // Epley-Formel auf der effektiven Last – identisch zu estimateOneRepMax
      // und effectiveLoad in lib/training.
      best: sql<number>`max(
        (case
          when ${exercises.trackingMode} = 'bodyweight_reps'
          then ${bodyweightKg} + ${workoutSets.weightKg}
          when ${exercises.trackingMode} = 'assisted_reps'
          then max(${bodyweightKg} - ${workoutSets.weightKg}, 0)
          else ${workoutSets.weightKg}
        end) * (1 + ${workoutSets.reps} / 30.0)
      )`,
    })
    .from(workoutSets)
    .innerJoin(workouts, eq(workouts.id, workoutSets.workoutId))
    .innerJoin(exercises, eq(exercises.id, workoutSets.exerciseId))
    .where(
      and(
        eq(workouts.userId, userId),
        inArray(workoutSets.exerciseId, exerciseIds),
        lt(workouts.startedAt, beforeStartedAt),
      ),
    )
    .groupBy(workoutSets.exerciseId);

  for (const row of rows) {
    result.set(row.exerciseId, Math.max(row.best ?? 0, 0));
  }
  return result;
}

export type ManagedUser = {
  id: string;
  name: string;
  email: string;
  emailVerifiedAt: number | null;
  disabledAt: number | null;
  createdAt: number;
  workoutCount: number;
};

/**
 * Alle Konten für die Benutzerverwaltung, neueste zuerst. Die Zahl der
 * Trainings gibt einen Anhaltspunkt, wie aktiv ein Konto ist – Inhalte der
 * Trainings sieht ein Administrator bewusst nicht.
 */
export async function listAllUsers(): Promise<ManagedUser[]> {
  return db
    .select({
      id: users.id,
      name: users.name,
      email: users.email,
      emailVerifiedAt: users.emailVerifiedAt,
      disabledAt: users.disabledAt,
      createdAt: users.createdAt,
      workoutCount: count(workouts.id),
    })
    .from(users)
    .leftJoin(workouts, eq(workouts.userId, users.id))
    .groupBy(users.id)
    .orderBy(desc(users.createdAt));
}

/**
 * Konten, die sich bei der Einrichtung zum Administrator machen lassen.
 * Unbestätigte und gesperrte Konten bleiben außen vor – als Administrator
 * kämen sie nicht am Login vorbei.
 */
export async function listPromotableAccounts(): Promise<
  Array<{ id: string; name: string; email: string }>
> {
  return db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(
      and(
        eq(users.isSetupAccount, false),
        isNull(users.disabledAt),
        isNotNull(users.emailVerifiedAt),
      ),
    )
    .orderBy(asc(users.createdAt));
}
