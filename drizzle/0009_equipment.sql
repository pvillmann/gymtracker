CREATE TABLE `equipment` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`name` text NOT NULL,
	`manufacturer` text,
	`model` text,
	`kind` text DEFAULT 'other' NOT NULL,
	`load_factor` real DEFAULT 1 NOT NULL,
	`base_load_kg` real DEFAULT 0 NOT NULL,
	`notes` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `equipment_user_name_unique` ON `equipment` (`user_id`,`name`);--> statement-breakpoint
CREATE TABLE `equipment_images` (
	`id` text PRIMARY KEY NOT NULL,
	`equipment_id` text NOT NULL,
	`width` integer NOT NULL,
	`height` integer NOT NULL,
	`bytes` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`equipment_id`) REFERENCES `equipment`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `equipment_images_equipment_idx` ON `equipment_images` (`equipment_id`);--> statement-breakpoint
ALTER TABLE `exercises` ADD `equipment_id` text REFERENCES equipment(id) ON DELETE set null;