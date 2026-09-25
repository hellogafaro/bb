import type {
  McpProviderEntry,
  McpProviderStatus,
} from "@bb/host-daemon-contract";

export interface ProviderGuardIssue {
  provider: "claude" | "codex";
  message: string;
}

function codexTable(name: string): string {
  return `[mcp_servers.${/^[A-Za-z0-9_-]+$/.test(name) ? name : JSON.stringify(name)}]`;
}

function claudeLocation(entry: McpProviderEntry): string {
  if (entry.scope === "user") return "the top-level mcpServers";
  if (entry.scope === "project") return "mcpServers in that file";
  return `projects[${JSON.stringify(entry.scope.slice("project ".length))}].mcpServers`;
}

export function providerGuardIssues(
  status: McpProviderStatus,
): ProviderGuardIssue[] {
  const issues: ProviderGuardIssue[] = [];
  if (!status.claude.connectorsDisabled) {
    issues.push({
      provider: "claude",
      message: `claude.ai connectors are enabled; set "disableClaudeAiConnectors": true in ${status.claude.settingsPath} (bb mcp providers --fix)`,
    });
  }
  for (const entry of status.claude.mcpServers) {
    issues.push({
      provider: "claude",
      message: `Claude Code MCP server "${entry.name}" (${entry.scope}) in ${entry.file}; remove it from ${claudeLocation(entry)} by hand`,
    });
  }
  for (const entry of status.codex.mcpServers) {
    issues.push({
      provider: "codex",
      message: `Codex MCP server "${entry.name}" in ${entry.file}; delete its ${codexTable(entry.name)} table by hand`,
    });
  }
  return issues;
}

export function formatProviderStatus(
  result: {
    hostId: string;
    status: McpProviderStatus;
    issues: ProviderGuardIssue[];
  },
  fixed: boolean,
): string {
  const { claude, codex } = result.status;
  const entries = (
    items: McpProviderEntry[],
    hint: (entry: McpProviderEntry) => string,
  ) =>
    items.length === 0
      ? ["  MCP servers: none"]
      : [
          "  MCP servers:",
          ...items.map(
            (entry) =>
              `    ${entry.name} (${entry.scope}) in ${entry.file}\n      ${hint(entry)}`,
          ),
        ];
  return [
    `machine: ${result.hostId}`,
    ...(fixed
      ? [`Set "disableClaudeAiConnectors": true in ${claude.settingsPath}`]
      : []),
    "Claude Code",
    `  claude.ai connectors: ${claude.connectorsDisabled ? "disabled" : "ENABLED"} (${claude.settingsPath})`,
    ...entries(
      claude.mcpServers,
      (entry) =>
        `Remove "${entry.name}" from ${claudeLocation(entry)} by hand.`,
    ),
    "Codex",
    ...entries(
      codex.mcpServers,
      (entry) => `Delete the ${codexTable(entry.name)} table by hand.`,
    ),
    result.issues.length === 0
      ? "guard: ok"
      : `guard: ${result.issues.length} issue(s)${claude.connectorsDisabled ? "" : "; run bb mcp providers --fix to disable claude.ai connectors"}`,
  ].join("\n");
}
