CREATE TABLE `thread_inbox_summaries` (
	`thread_id` text PRIMARY KEY NOT NULL,
	`goal` text NOT NULL,
	`state` text NOT NULL,
	`needs` text,
	`source_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`thread_id`) REFERENCES `threads`(`id`) ON UPDATE no action ON DELETE cascade
);
