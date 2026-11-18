CREATE TABLE `meals` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`eaten_at` integer NOT NULL,
	`description` text NOT NULL,
	`kcal` real NOT NULL,
	`protein_g` real,
	`carbs_g` real,
	`fat_g` real,
	`confidence` text DEFAULT 'mittel' NOT NULL,
	`source` text DEFAULT 'chat' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `meals_user_eaten_idx` ON `meals` (`user_id`,`eaten_at`);