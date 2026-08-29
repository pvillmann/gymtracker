CREATE TABLE `exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`muscle_group` text,
	`machine_setup` text,
	`tracking_mode` text DEFAULT 'weight_reps' NOT NULL,
	`weight_step_kg` real DEFAULT 2.5 NOT NULL,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `exercises_user_idx` ON `exercises` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `exercises_user_name_unique` ON `exercises` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `plan_exercises` (
	`id` text PRIMARY KEY NOT NULL,
	`plan_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`position` integer NOT NULL,
	`target_sets` integer DEFAULT 3 NOT NULL,
	`target_reps_min` integer DEFAULT 8 NOT NULL,
	`target_reps_max` integer DEFAULT 12 NOT NULL,
	`rest_seconds` integer DEFAULT 90 NOT NULL,
	`notes` text,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plan_exercises_plan_idx` ON `plan_exercises` (`plan_id`,`position`);--> statement-breakpoint
CREATE TABLE `plans` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`notes` text,
	`archived_at` integer,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `plans_user_idx` ON `plans` (`user_id`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`token_hash` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `sessions_user_idx` ON `sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`password_hash` text NOT NULL,
	`name` text NOT NULL,
	`bodyweight_kg` real DEFAULT 80 NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_email_unique` ON `users` (`email`);--> statement-breakpoint
CREATE TABLE `workout_sets` (
	`id` text PRIMARY KEY NOT NULL,
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`set_number` integer NOT NULL,
	`weight_kg` real DEFAULT 0 NOT NULL,
	`reps` integer DEFAULT 0 NOT NULL,
	`duration_seconds` integer,
	`is_warmup` integer DEFAULT false NOT NULL,
	`volume_kg` real DEFAULT 0 NOT NULL,
	`completed_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `workout_sets_workout_idx` ON `workout_sets` (`workout_id`);--> statement-breakpoint
CREATE INDEX `workout_sets_exercise_idx` ON `workout_sets` (`exercise_id`,`completed_at`);--> statement-breakpoint
CREATE TABLE `workouts` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`plan_id` text,
	`name` text NOT NULL,
	`started_at` integer DEFAULT (unixepoch()) NOT NULL,
	`finished_at` integer,
	`notes` text,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`plan_id`) REFERENCES `plans`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `workouts_user_started_idx` ON `workouts` (`user_id`,`started_at`);