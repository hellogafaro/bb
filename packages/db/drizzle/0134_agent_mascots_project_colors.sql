ALTER TABLE `agents` ADD `mascot` text DEFAULT 'robot' NOT NULL;--> statement-breakpoint
ALTER TABLE `agents` ADD `color` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `projects` ADD `color` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
WITH RECURSIVE `agent_hash`(`id`, `name`, `position`, `mascot_hash`, `color_hash`) AS (
	SELECT `id`, `name`, 0, 0, 0 FROM `agents`
	UNION ALL
	SELECT `id`, `name`, `position` + 1,
		(`mascot_hash` * 131 + unicode(substr(`name`, `position` + 1, 1))) % 4294967296,
		(`color_hash` * 31 + unicode(substr(`name`, `position` + 1, 1))) % 4294967296
	FROM `agent_hash` WHERE `position` < length(`name`)
)
UPDATE `agents` SET
	`mascot` = CASE (SELECT `mascot_hash` FROM `agent_hash` WHERE `agent_hash`.`id` = `agents`.`id` AND `position` = length(`agents`.`name`)) % 10
		WHEN 0 THEN 'invader'
		WHEN 1 THEN 'ghost'
		WHEN 2 THEN 'robot'
		WHEN 3 THEN 'cat'
		WHEN 4 THEN 'skull'
		WHEN 5 THEN 'crab'
		WHEN 6 THEN 'mushroom'
		WHEN 7 THEN 'rocket'
		WHEN 8 THEN 'dino'
		ELSE 'frog'
	END,
	`color` = (SELECT `color_hash` FROM `agent_hash` WHERE `agent_hash`.`id` = `agents`.`id` AND `position` = length(`agents`.`name`)) % 8 + 1;--> statement-breakpoint
UPDATE `agents` SET `mascot` = 'robot', `color` = 1
WHERE lower(`name`) = 'bb'
	AND `id` = (SELECT `id` FROM `agents` ORDER BY `created_at`, `id` LIMIT 1);--> statement-breakpoint
WITH RECURSIVE `project_hash`(`id`, `position`, `color_hash`) AS (
	SELECT `id`, 0, 0 FROM `projects`
	UNION ALL
	SELECT `project_hash`.`id`, `position` + 1,
		(`color_hash` * 31 + unicode(substr(`projects`.`id`, `position` + 1, 1))) % 4294967296
	FROM `project_hash` JOIN `projects` ON `projects`.`id` = `project_hash`.`id`
	WHERE `position` < length(`projects`.`id`)
)
UPDATE `projects` SET
	`color` = (SELECT `color_hash` FROM `project_hash` WHERE `project_hash`.`id` = `projects`.`id` AND `position` = length(`projects`.`id`)) % 24 + 1;
