CREATE TABLE `body_metrics` (
	`user_id` text NOT NULL,
	`metric` text NOT NULL,
	`measured_at` integer NOT NULL,
	`value` real NOT NULL,
	`source` text,
	PRIMARY KEY(`user_id`, `metric`, `measured_at`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
ALTER TABLE `users` ADD `health_token_hash` text;--> statement-breakpoint
ALTER TABLE `users` ADD `health_imported_at` integer;--> statement-breakpoint
INSERT INTO `body_metrics` (`user_id`, `metric`, `measured_at`, `value`, `source`) SELECT `id`, 'weight', unixepoch(), `bodyweight_kg`, 'manuell' FROM `users` WHERE `is_setup_account` = 0;
