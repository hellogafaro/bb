CREATE TABLE `mcp_servers` (
	`id` text PRIMARY KEY NOT NULL,
	`handle` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`type` text NOT NULL,
	`config_json` text NOT NULL,
	`status` text NOT NULL,
	`last_error` text,
	`enabled` integer DEFAULT true NOT NULL,
	`guide` text,
	`source_kind` text NOT NULL,
	`source_ref` text,
	`registry_name` text,
	`registry_version` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "mcp_servers_type_check" CHECK("mcp_servers"."type" IN ('stdio', 'streamable-http', 'sse')),
	CONSTRAINT "mcp_servers_status_check" CHECK("mcp_servers"."status" IN ('idle', 'ready', 'error', 'disabled', 'needs-auth')),
	CONSTRAINT "mcp_servers_source_kind_check" CHECK("mcp_servers"."source_kind" IN ('manual', 'registry'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mcp_servers_handle_idx` ON `mcp_servers` (`handle`);--> statement-breakpoint
CREATE TABLE `mcp_tool_policies` (
	`server_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`risk` text NOT NULL,
	`mode` text NOT NULL,
	PRIMARY KEY(`server_id`, `tool_name`),
	FOREIGN KEY (`server_id`) REFERENCES `mcp_servers`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "mcp_tool_policies_risk_check" CHECK("mcp_tool_policies"."risk" IN ('read', 'write', 'destructive')),
	CONSTRAINT "mcp_tool_policies_mode_check" CHECK("mcp_tool_policies"."mode" IN ('inherit', 'allow', 'deny', 'confirm'))
);
