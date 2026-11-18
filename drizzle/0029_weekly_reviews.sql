CREATE TABLE `weekly_reviews` (
	`user_id` text NOT NULL,
	`week_start` integer NOT NULL,
	`facts` text NOT NULL,
	`hints` text NOT NULL,
	`status` text NOT NULL,
	`feedback` text,
	`actions` text,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	PRIMARY KEY(`user_id`, `week_start`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
