export const RESERVED_BB_CLI_COMMANDS: readonly string[] = [
  "agent",
  "browser",
  "diagnostics",
  "environment",
  "file",
  "guide",
  "help",
  "machine",
  "manager",
  "marketplace",
  "mcp",
  "plugin",
  "project",
  "provider",
  "search",
  "server",
  "settings",
  "skill",
  "status",
  "terminal",
  "theme",
  "thread",
  "updates",
  "voice",
];

export function pluginCliCall(pluginId: string, name: string): string {
  if (RESERVED_BB_CLI_COMMANDS.includes(name))
    return `bb plugin run ${pluginId}`;
  return `bb ${name}`;
}
