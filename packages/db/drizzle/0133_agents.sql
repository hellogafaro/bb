CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`provider_id` text NOT NULL,
	`model` text,
	`reasoning_level` text NOT NULL,
	`skills_json` text DEFAULT '[]' NOT NULL,
	`mcp_servers_json` text DEFAULT '[]' NOT NULL,
	`instructions` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agents_name_idx` ON `agents` (`name`);--> statement-breakpoint
ALTER TABLE `threads` ADD `agent_id` text REFERENCES agents(id) ON DELETE set null;