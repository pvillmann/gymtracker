import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/** Tracking-Modus einer Übung. Bestimmt, welche Felder beim Loggen erfasst werden. */
export type TrackingMode = "weight_reps" | "bodyweight_reps" | "time";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    /** Für das Volumen von Körpergewichts-Übungen (Klimmzüge, Dips ...). */
    bodyweightKg: real("bodyweight_kg").notNull().default(80),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

export const sessions = sqliteTable(
  "sessions",
  {
    /** SHA-256 des Cookie-Tokens – der Klartext-Token liegt nur im Browser. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Muskelgruppe, z.B. "Brust", "Rücken" – frei wählbar. */
    muscleGroup: text("muscle_group"),
    /** Notiz für Maschineneinstellungen: Sitzhöhe, Lehne, Griff ... */
    machineSetup: text("machine_setup"),
    trackingMode: text("tracking_mode")
      .notNull()
      .default("weight_reps")
      .$type<TrackingMode>(),
    /** Kleinste Gewichtsstufe der Maschine – steuert die +/- Buttons. */
    weightStepKg: real("weight_step_kg").notNull().default(2.5),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("exercises_user_idx").on(t.userId),
    uniqueIndex("exercises_user_name_unique").on(t.userId, t.name),
  ],
);

export const plans = sqliteTable(
  "plans",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    notes: text("notes"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("plans_user_idx").on(t.userId)],
);

export const planExercises = sqliteTable(
  "plan_exercises",
  {
    id: text("id").primaryKey(),
    planId: text("plan_id")
      .notNull()
      .references(() => plans.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    position: integer("position").notNull(),
    targetSets: integer("target_sets").notNull().default(3),
    targetRepsMin: integer("target_reps_min").notNull().default(8),
    targetRepsMax: integer("target_reps_max").notNull().default(12),
    restSeconds: integer("rest_seconds").notNull().default(90),
    notes: text("notes"),
  },
  (t) => [index("plan_exercises_plan_idx").on(t.planId, t.position)],
);

export const workouts = sqliteTable(
  "workouts",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, { onDelete: "set null" }),
    /** Snapshot des Plannamens, bleibt auch wenn der Plan gelöscht wird. */
    name: text("name").notNull(),
    startedAt: integer("started_at").notNull().default(now),
    finishedAt: integer("finished_at"),
    notes: text("notes"),
  },
  (t) => [index("workouts_user_started_idx").on(t.userId, t.startedAt)],
);

export const workoutSets = sqliteTable(
  "workout_sets",
  {
    id: text("id").primaryKey(),
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    /** 1-basiert, pro Übung innerhalb eines Workouts. */
    setNumber: integer("set_number").notNull(),
    weightKg: real("weight_kg").notNull().default(0),
    reps: integer("reps").notNull().default(0),
    /** Nur für trackingMode "time". */
    durationSeconds: integer("duration_seconds"),
    isWarmup: integer("is_warmup", { mode: "boolean" }).notNull().default(false),
    /** Vorberechnetes Volumen in kg, damit Statistiken ohne Joins auskommen. */
    volumeKg: real("volume_kg").notNull().default(0),
    completedAt: integer("completed_at").notNull().default(now),
  },
  (t) => [
    index("workout_sets_workout_idx").on(t.workoutId),
    index("workout_sets_exercise_idx").on(t.exerciseId, t.completedAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type PlanExercise = typeof planExercises.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
