CREATE TABLE `catalog_changes` (
	`id` text PRIMARY KEY NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`entity_name` text NOT NULL,
	`user_id` text,
	`action` text NOT NULL,
	`details` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `catalog_changes_entity_idx` ON `catalog_changes` (`entity`,`entity_id`,`created_at`);