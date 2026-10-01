CREATE TABLE `gym_equipment` (
	`gym_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`added_by` text,
	PRIMARY KEY(`gym_id`, `equipment_id`),
	FOREIGN KEY (`gym_id`) REFERENCES `gyms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `gym_equipment_equipment_idx` ON `gym_equipment` (`equipment_id`);--> statement-breakpoint
CREATE TABLE `movement_equipment` (
	`movement_id` text NOT NULL,
	`equipment_id` text NOT NULL,
	`added_by` text,
	PRIMARY KEY(`movement_id`, `equipment_id`),
	FOREIGN KEY (`movement_id`) REFERENCES `movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`added_by`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `movement_equipment_equipment_idx` ON `movement_equipment` (`equipment_id`);--> statement-breakpoint
-- Planeinträge nennen künftig die Übung (Bewegung), die Variante ist nur
-- noch ein Vorschlag. Neubau der Tabelle ist hier unbedenklich: keine andere
-- Tabelle verweist auf plan_exercises, ein DROP löst also keine Kaskade aus.
CREATE TABLE `__new_plan_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`movement_id` text NOT NULL,
	`exercise_id` text,
	`position` integer NOT NULL,
	`target_sets` integer DEFAULT 3 NOT NULL,
	`target_reps_min` integer DEFAULT 8 NOT NULL,
	`target_reps_max` integer DEFAULT 12 NOT NULL,
	`target_duration_seconds` integer,
	`rest_seconds` integer DEFAULT 90 NOT NULL,
	`notes` text,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movement_id`) REFERENCES `movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
INSERT INTO `__new_plan_exercises`("id", "plan_id", "movement_id", "exercise_id", "position", "target_sets", "target_reps_min", "target_reps_max", "target_duration_seconds", "rest_seconds", "notes")
SELECT p."id", p."plan_id", x."movement_id", p."exercise_id", p."position", p."target_sets", p."target_reps_min", p."target_reps_max", p."target_duration_seconds", p."rest_seconds", p."notes"
FROM `plan_exercises` p JOIN `exercises` x ON x."id" = p."exercise_id"
WHERE x."movement_id" IS NOT NULL;--> statement-breakpoint
DROP TABLE `plan_exercises`;--> statement-breakpoint
ALTER TABLE `__new_plan_exercises` RENAME TO `plan_exercises`;--> statement-breakpoint
CREATE INDEX `plan_exercises_plan_idx` ON `plan_exercises` (`plan_id`,`position`);--> statement-breakpoint
ALTER TABLE `equipment` ADD `weight_step_kg` real DEFAULT 2.5 NOT NULL;--> statement-breakpoint
ALTER TABLE `movements` ADD `tracking_mode` text DEFAULT 'weight_reps' NOT NULL;--> statement-breakpoint
-- Messart: bisher an der Variante, jetzt an der Übung – die der ältesten Variante.
UPDATE `movements` SET `tracking_mode` = coalesce((
  SELECT x.`tracking_mode` FROM `exercises` x WHERE x.`movement_id` = `movements`.`id` ORDER BY x.`id` LIMIT 1
), 'weight_reps');--> statement-breakpoint
-- Gewichtsstufe: bisher an der Variante, jetzt an der Maschine.
UPDATE `equipment` SET `weight_step_kg` = coalesce((
  SELECT x.`weight_step_kg` FROM `exercises` x WHERE x.`equipment_id` = `equipment`.`id` ORDER BY x.`id` LIMIT 1
), 2.5);--> statement-breakpoint
-- Welche Maschine zu welcher Übung passt: aus den bisherigen Varianten.
INSERT OR IGNORE INTO `movement_equipment` (`movement_id`, `equipment_id`, `added_by`)
SELECT x.`movement_id`, x.`equipment_id`, min(x.`user_id`) FROM `exercises` x
WHERE x.`movement_id` IS NOT NULL AND x.`equipment_id` IS NOT NULL
GROUP BY x.`movement_id`, x.`equipment_id`;--> statement-breakpoint
-- Welche Maschine in welchem Studio steht: aus den bisherigen Sätzen dort.
INSERT OR IGNORE INTO `gym_equipment` (`gym_id`, `equipment_id`, `added_by`)
SELECT g.`gym_id`, x.`equipment_id`, min(x.`user_id`) FROM `gym_exercises` g
JOIN `exercises` x ON x.`id` = g.`exercise_id`
WHERE x.`equipment_id` IS NOT NULL
GROUP BY g.`gym_id`, x.`equipment_id`;
