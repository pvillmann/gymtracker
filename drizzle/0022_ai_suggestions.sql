CREATE TABLE `workout_ai_suggestions` (
	`workout_id` text NOT NULL,
	`exercise_id` text NOT NULL,
	`status` text NOT NULL,
	`weight` real,
	`reps` text,
	`reason` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`workout_id`, `exercise_id`),
	FOREIGN KEY (`workout_id`) REFERENCES `workouts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`exercise_id`) REFERENCES `exercises`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `anthropic_key_enc` text;--> statement-breakpoint
ALTER TABLE `users` ADD `ai_suggestions` integer DEFAULT 0 NOT NULL;