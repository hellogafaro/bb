import type {
  McpServer,
  McpToolPolicy,
  ProviderGuardResponse,
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

export function makeProviderGuard(
  overrides: Partial<ProviderGuardResponse> = {},
): ProviderGuardResponse {
  return {
    hostId: "host_local",
    hostName: "studio",
    status: {
      claude: {
        settingsPath: "/home/u/.claude/settings.json",
        connectorsDisabled: true,
        bundledSkillsDisabled: true,
        skillSyncDisabled: true,
        enabledPlugins: [],
        mcpServers: [],
        pluginsDir: "/home/u/.claude/plugins",
        marketplaces: [],
        knownMarketplacesFile: null,
        installedPlugins: [],
        skillsDir: "/home/u/.claude/skills",
        extraSkills: [],
      },
      codex: {
        configPath: "/home/u/.codex/config.toml",
        features: [],
        systemSkills: [],
        mcpServers: [],
        pluginCacheDir: "/home/u/.codex/plugins/cache",
        pluginCache: [],
        skillsDir: "/home/u/.codex/skills",
        extraSkills: [],
      },
    },
    issues: [],
    changes: [],
    text: "",
    ...overrides,
  };
}
