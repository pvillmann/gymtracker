CREATE TABLE `movements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`muscle_group` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `movements_user_name_unique` ON `movements` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `workout_variants` (
	`workout_id` text NOT NULL,
	`movement_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	PRIMARY KEY(`workout_id`, `movement_id`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`movement_id`) REFERENCES `movements`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `exercises` ADD `movement_id` text REFERENCES movements(id);--> statement-breakpoint
CREATE INDEX `exercises_movement_idx` ON `exercises` (`movement_id`);--> statement-breakpoint
-- Jede bestehende Übung wird zunächst die einzige Variante einer gleichnamigen
-- Bewegung. So bleibt der Verlauf unangetastet; zusammengeführt wird danach
-- von Hand, indem man eine Übung einer anderen Bewegung zuordnet.
INSERT INTO `movements` (`id`, `user_id`, `name`, `muscle_group`, `created_at`)
SELECT 'mv' || `id`, `user_id`, `name`, `muscle_group`, `created_at` FROM `exercises`;--> statement-breakpoint
UPDATE `exercises` SET `movement_id` = 'mv' || `id`;
