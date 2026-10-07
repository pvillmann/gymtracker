import { sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch())`;

/** Tracking-Modus einer Übung. Bestimmt, welche Felder beim Loggen erfasst werden. */
export type TrackingMode =
  | "weight_reps"
  | "bodyweight_reps"
  | "assisted_reps"
  | "time";

/**
 * Wie sich der letzte Arbeitssatz einer Übung angefühlt hat. Bewusst grob:
 * es soll beim nächsten Mal nur sagen, ob noch Luft war.
 */
export type SetEffort = "max" | "ok" | "easy";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull(),
    passwordHash: text("password_hash").notNull(),
    name: text("name").notNull(),
    /** Für das Volumen von Körpergewichts-Übungen (Klimmzüge, Dips ...). */
    bodyweightKg: real("bodyweight_kg").notNull().default(80),
    /** null = noch nicht bestätigt. Login ist erst danach möglich. */
    emailVerifiedAt: integer("email_verified_at"),
    /**
     * null = aktiv. Gesetzt sperrt es den Login und beendet laufende Sessions,
     * ohne die Trainingsdaten anzufassen – die Umkehrung von "löschen".
     */
    disabledAt: integer("disabled_at"),
    /**
     * Das Übergangskonto "admin", das die Anwendung anlegt, solange es keinen
     * Administrator gibt. Es kann nichts außer die Einrichtung abschließen und
     * wird danach gelöscht.
     */
    isSetupAccount: integer("is_setup_account", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("users_email_unique").on(t.email)],
);

/**
 * Benutzergruppen. Bewusst allgemein gehalten und nicht als Rollen-Spalte auf
 * users: so lassen sich später auch fachliche Gruppen anlegen, über die
 * Trainingspläne geteilt werden.
 */
export const groups = sqliteTable(
  "groups",
  {
    id: text("id").primaryKey(),
    /** Stabiler Bezeichner, über den der Code eine Gruppe findet. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /**
     * Systemgruppen gehören zur Anwendung selbst (aktuell nur die
     * Administratoren) und lassen sich weder umbenennen noch löschen.
     */
    isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("groups_slug_unique").on(t.slug)],
);

export const groupMembers = sqliteTable(
  "group_members",
  {
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    addedAt: integer("added_at").notNull().default(now),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId] }),
    index("group_members_user_idx").on(t.userId),
  ],
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

/** Einmal-Link zum Bestätigen einer E-Mail-Adresse nach der Registrierung. */
export const emailVerificationTokens = sqliteTable(
  "email_verification_tokens",
  {
    /** SHA-256 des Tokens aus dem Mail-Link – der Klartext steht nur in der Mail. */
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("email_verification_tokens_user_idx").on(t.userId)],
);

/** Einmal-Link für "Passwort vergessen". */
export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("password_reset_tokens_user_idx").on(t.userId)],
);

/**
 * Zugangsschlüssel für den MCP-Endpunkt. Wie bei den Sessions liegt nur der
 * Hash in der Datenbank – der Klartext wird genau einmal angezeigt.
 */
export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Frei wählbare Bezeichnung, damit man mehrere auseinanderhalten kann. */
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull(),
    /** Die ersten Zeichen im Klartext, damit man den Schlüssel wiedererkennt. */
    preview: text("preview").notNull(),
    lastUsedAt: integer("last_used_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("api_tokens_hash_unique").on(t.tokenHash),
    index("api_tokens_user_idx").on(t.userId),
  ],
);

/** Bauart eines Geräts – bestimmt, wie man sich die Last vorstellen muss. */
export type LoadUnit = "kg" | "level";

export type EquipmentKind =
  | "stack"
  | "plates"
  | "cable"
  | "free"
  | "bodyweight"
  | "other";

/**
 * Ein Gerätetyp: "Matrix Ultra Lateral Raise", "Kabelturm", "Kurzhantel".
 * Übungen (die Geräte-Varianten einer Bewegung) verweisen darauf. Übersetzung
 * und Eigengewicht machen das bewegte Gewicht ehrlicher – verglichen wird
 * trotzdem nur am selben Gerät.
 */
export const equipment = sqliteTable(
  "equipment",
  {
    id: text("id").primaryKey(),
    /**
     * Angelegt von – der Katalog gilt für alle Nutzer der Instanz. Wird das
     * Konto gelöscht, gehen die Einträge vorher an jemand anderen über
     * (handOverCatalog), sonst nähme die Kaskade sie allen weg.
     */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    manufacturer: text("manufacturer"),
    model: text("model"),
    kind: text("kind").notNull().default("other").$type<EquipmentKind>(),
    /**
     * Anteil des eingestellten Gewichts, der tatsächlich als Last ankommt:
     * 1 bei 1:1, 0.5 bei einem Kabelzug mit 2:1-Übersetzung.
     */
    loadFactor: real("load_factor").notNull().default(1),
    /** Was ohne Gewicht schon bewegt wird, z. B. der Schlitten der Beinpresse. */
    baseLoadKg: real("base_load_kg").notNull().default(0),
    /** Kleinster Gewichtssprung – steuert die +/- Tasten; pro Studio überschreibbar. */
    weightStepKg: real("weight_step_kg").notNull().default(2.5),
    /**
     * Getrennte Arme mit eigenen Scheiben (Iso-Lateral Row): eingetragen wird
     * das Gewicht einer Seite, bewegt wird das Doppelte.
     */
    perSide: integer("per_side", { mode: "boolean" }).notNull().default(false),
    /**
     * "level": Steckgewicht mit Stufen statt kg (Life Fitness 1–12). Die
     * Stufe wird wie ein Gewicht erfasst und am selben Gerät verglichen,
     * zählt aber nicht als bewegtes Gewicht – sie ist keine Masse.
     */
    loadUnit: text("load_unit").notNull().default("kg").$type<LoadUnit>(),
    notes: text("notes"),
    /** Archiviert: nicht mehr vorgeschlagen, Verlauf bleibt. Siehe movements.archivedAt. */
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("equipment_name_unique").on(t.name)],
);

/**
 * Fotos eines Geräts. Die Datei liegt verkleinert im Daten-Verzeichnis neben
 * der Datenbank (images/<id>.webp und images/<id>-thumb.webp), hier nur die
 * Verwaltungsdaten.
 */
export const equipmentImages = sqliteTable(
  "equipment_images",
  {
    id: text("id").primaryKey(),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    /** Wer das Foto hochgeladen hat – darf es auch wieder löschen. */
    uploadedBy: text("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    bytes: integer("bytes").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("equipment_images_equipment_idx").on(t.equipmentId)],
);

/**
 * Einmal-Links für ein Maschinenfoto. Ein Sprachmodell sieht ein Foto im
 * Chat, kann die Datei aber nicht weiterreichen – also gibt das MCP-Werkzeug
 * einen Link aus, über den genau ein Foto hochgeladen werden kann. Gespeichert
 * wird nur der Hash; der Link läuft nach kurzer Zeit ab.
 */
export const photoUploadTokens = sqliteTable(
  "photo_upload_tokens",
  {
    id: text("id").primaryKey(),
    tokenHash: text("token_hash").notNull(),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    /** Für wen der Link ausgestellt wurde – gilt als Uploader des Fotos. */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("photo_upload_tokens_hash_unique").on(t.tokenHash)],
);

/**
 * Eine Bewegung, unabhängig vom Gerät: "Seitheben", "Rudern eng". Die Geräte,
 * an denen man sie macht, sind ihre Varianten (Tabelle exercises). Ein
 * Planeintrag meint die Bewegung – an welchem Gerät trainiert wird, entscheidet
 * sich im Training. Verglichen wird trotzdem nur innerhalb einer Variante: an
 * Maschine und Kabelturm sind dieselben Kilos nicht dieselbe Last.
 */
export const movements = sqliteTable(
  "movements",
  {
    id: text("id").primaryKey(),
    /**
     * Angelegt von – der Katalog gilt für alle Nutzer der Instanz. Wird das
     * Konto gelöscht, gehen die Einträge vorher an jemand anderen über
     * (handOverCatalog), sonst nähme die Kaskade sie allen weg.
     */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Gilt für alle Varianten und wird dorthin gespiegelt, siehe exercises.muscleGroup. */
    muscleGroup: text("muscle_group"),
    /** Wie die Übung gemessen wird – gilt für alle ihre Maschinen. */
    trackingMode: text("tracking_mode")
      .notNull()
      .default("weight_reps")
      .$type<TrackingMode>(),
    /**
     * Aus wger übernommen: die Angaben, die CC-BY-SA verlangt – Quelle,
     * Urheber, Lizenz – sowie der Name zum Zeitpunkt der Übernahme, damit
     * eine Änderung als "bearbeitet" gekennzeichnet werden kann.
     */
    sourceName: text("source_name"),
    sourceUrl: text("source_url"),
    licenseName: text("license_name"),
    licenseUrl: text("license_url"),
    licenseAuthor: text("license_author"),
    /**
     * Archiviert: taucht in Auswahllisten und Vorschlägen nicht mehr auf,
     * Verlauf und Planeinträge bleiben. Statt Löschen, sobald Sätze dranhängen.
     */
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("movements_name_unique").on(t.name)],
);

export const exercises = sqliteTable(
  "exercises",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /**
     * Die Bewegung, deren Variante diese Übung ist. In der Datenbank nullable,
     * weil SQLite eine Pflichtspalte nicht nachträglich anlegen kann; die
     * Migration füllt sie für alle Bestandsübungen, neue bekommen sie immer.
     */
    movementId: text("movement_id").references(() => movements.id),
    /** Der Gerätetyp, an dem diese Variante gemacht wird – optional. */
    equipmentId: text("equipment_id").references(() => equipment.id, {
      onDelete: "set null",
    }),
    /**
     * Muskelgruppe, z.B. "Brust", "Rücken". Führend ist die der Bewegung; hier
     * steht eine Kopie, damit Statistik und Listen ohne Join auskommen.
     */
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
    index("exercises_movement_idx").on(t.movementId),
    uniqueIndex("exercises_user_name_unique").on(t.userId, t.name),
  ],
);

/**
 * Ein Studio. Welche Geräte dort stehen und wie sie eingestellt sind, steht
 * in gymExercises; welches Gerät für eine Bewegung vorausgewählt wird, ergibt
 * sich aus den Trainings, die dort stattgefunden haben.
 */
export const gyms = sqliteTable(
  "gyms",
  {
    id: text("id").primaryKey(),
    /**
     * Angelegt von – der Katalog gilt für alle Nutzer der Instanz. Wird das
     * Konto gelöscht, gehen die Einträge vorher an jemand anderen über
     * (handOverCatalog), sonst nähme die Kaskade sie allen weg.
     */
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("gyms_name_unique").on(t.name)],
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
    /**
     * "Nicht erneut fragen" beim Trainingsstart. Gesetzt gilt defaultGymId
     * ohne Rückfrage – auch wenn es leer ist, dann eben ohne Studio.
     */
    rememberGym: integer("remember_gym", { mode: "boolean" }).notNull().default(false),
    defaultGymId: text("default_gym_id").references(() => gyms.id, {
      onDelete: "set null",
    }),
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
    /** Der Plan nennt die Übung; die Maschine wird im Training gewählt. */
    movementId: text("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    /** Bevorzugte Variante (Übung × Maschine) – nur ein Vorschlag, optional. */
    exerciseId: text("exercise_id").references(() => exercises.id, { onDelete: "set null" }),
    position: integer("position").notNull(),
    targetSets: integer("target_sets").notNull().default(3),
    targetRepsMin: integer("target_reps_min").notNull().default(8),
    targetRepsMax: integer("target_reps_max").notNull().default(12),
    /** Nur relevant, wenn die Übung im Zeit-Modus getrackt wird. */
    targetDurationSeconds: integer("target_duration_seconds"),
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
    gymId: text("gym_id").references(() => gyms.id, { onDelete: "set null" }),
    startedAt: integer("started_at").notNull().default(now),
    finishedAt: integer("finished_at"),
    notes: text("notes"),
  },
  (t) => [index("workouts_user_started_idx").on(t.userId, t.startedAt)],
);

/**
 * Welche Maschinen zu welcher Übung passen – der Kabelturm passt zu
 * Seitheben, Trizepsdrücken und Face Pulls. Gemeinsamer Katalog: anlegen und
 * entfernen darf jeder.
 */
export const movementEquipment = sqliteTable(
  "movement_equipment",
  {
    movementId: text("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.movementId, t.equipmentId] }),
    index("movement_equipment_equipment_idx").on(t.equipmentId),
  ],
);

/** Welche Maschinen in welchem Studio stehen – gemeinsamer Katalog. */
export const gymEquipment = sqliteTable(
  "gym_equipment",
  {
    gymId: text("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    equipmentId: text("equipment_id")
      .notNull()
      .references(() => equipment.id, { onDelete: "cascade" }),
    addedBy: text("added_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.equipmentId] }),
    index("gym_equipment_equipment_idx").on(t.equipmentId),
  ],
);

/**
 * Ein Gerät in einem bestimmten Studio. Die Zeile entsteht mit dem ersten
 * Satz dort und trägt, was sich von Studio zu Studio unterscheidet: die
 * Einstellungen (Sitzhöhe …) und die tatsächliche Gewichtsstufe. Leer gilt
 * jeweils der Wert der Übung.
 */
export const gymExercises = sqliteTable(
  "gym_exercises",
  {
    gymId: text("gym_id")
      .notNull()
      .references(() => gyms.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
    machineSetup: text("machine_setup"),
    weightStepKg: real("weight_step_kg"),
  },
  (t) => [
    primaryKey({ columns: [t.gymId, t.exerciseId] }),
    index("gym_exercises_exercise_idx").on(t.exerciseId),
  ],
);

/**
 * Welches Gerät im laufenden Training für eine Bewegung gewählt ist. Ohne
 * Eintrag gilt das zuletzt genutzte. Ist erst einmal ein Satz gespeichert,
 * steht die Variante ohnehin fest.
 */
export const workoutVariants = sqliteTable(
  "workout_variants",
  {
    workoutId: text("workout_id")
      .notNull()
      .references(() => workouts.id, { onDelete: "cascade" }),
    movementId: text("movement_id")
      .notNull()
      .references(() => movements.id, { onDelete: "cascade" }),
    exerciseId: text("exercise_id")
      .notNull()
      .references(() => exercises.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.workoutId, t.movementId] })],
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
    /** Selbsteinschätzung, nur beim letzten Arbeitssatz einer Übung gesetzt. */
    effort: text("effort").$type<SetEffort>(),
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
export type ApiToken = typeof apiTokens.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type GroupMember = typeof groupMembers.$inferSelect;
export type Equipment = typeof equipment.$inferSelect;
export type EquipmentImage = typeof equipmentImages.$inferSelect;
export type Gym = typeof gyms.$inferSelect;
export type GymExercise = typeof gymExercises.$inferSelect;
export type Movement = typeof movements.$inferSelect;
export type Exercise = typeof exercises.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type PlanExercise = typeof planExercises.$inferSelect;
export type Workout = typeof workouts.$inferSelect;
export type WorkoutSet = typeof workoutSets.$inferSelect;
