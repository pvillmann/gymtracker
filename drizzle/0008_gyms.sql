CREATE TABLE `gym_exercises` (
	`gym_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`machine_setup` text,
	`weight_step_kg` real,
	PRIMARY KEY(`gym_id`, `exercise_id`),
	FOREIGN KEY (`gym_id`) REFERENCES `gyms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `gym_exercises_exercise_idx` ON `gym_exercises` (`exercise_id`);--> statement-breakpoint
CREATE TABLE `gyms` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `gyms_user_name_unique` ON `gyms` (`user_id`,`name`);--> statement-breakpoint
ALTER TABLE `plans` ADD `remember_gym` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `plans` ADD `default_gym_id` text REFERENCES gyms(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `workouts` ADD `gym_id` text REFERENCES gyms(id) ON DELETE set null;