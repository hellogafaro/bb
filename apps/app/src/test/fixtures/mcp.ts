import type {
  McpProviderStatusResponse,
  McpServer,
  McpToolPolicy,
} from "@bb/server-contract";

export function makeMcpServer(overrides: Partial<McpServer> = {}): McpServer {
  return {
    id: "mcp_github",
    handle: "github",
    name: "GitHub",
    description: "GitHub remote MCP",
    type: "streamable-http",
    status: "ready",
    sourceKind: "manual",
    enabled: true,
    authStatus: "authenticated",
    lastError: null,
    sourceRef: "https://api.githubcopilot.com/mcp/",
    registryName: null,
    registryVersion: null,
    config: {
      type: "streamable-http",
      url: "https://api.githubcopilot.com/mcp/",
      headers: {},
    },
    toolCount: 2,
    promptCount: 0,
    resourceCount: 0,
    guide: null,
    ...overrides,
  };
}

export function makeMcpToolPolicy(
  overrides: Partial<McpToolPolicy> = {},
): McpToolPolicy {
  return {
    tool: "search_issues",
    risk: "read",
    mode: "inherit",
    policy: "allow",
    ...overrides,
  };
}

export function makeMcpProviderStatus(
  overrides: Partial<McpProviderStatusResponse> = {},
): McpProviderStatusResponse {
  return {
    hostId: "host_local",
    status: {
      claude: {
        settingsPath: "/home/u/.claude/settings.json",
        connectorsDisabled: true,
        mcpServers: [],
      },
      codex: { configPath: "/home/u/.codex/config.toml", mcpServers: [] },
    },
    issues: [],
    text: "",
    ...overrides,
  };
}
