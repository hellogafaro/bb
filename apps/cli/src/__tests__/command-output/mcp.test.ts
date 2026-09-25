import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BbSdk,
  ProviderGuardResult,
  McpServerRecordResult,
  McpToolPolicyResult,
} from "@bb/sdk";
import {
  collectLogLines,
  collectLogPayloads,
  runCommand,
  setupCommandOutputTestEnvironment,
  type CommandRegistrar,
} from "../helpers/command-output-harness.js";
import { createCliBbSdk } from "../../client.js";
import { registerMcpCommands } from "../../commands/mcp.js";

const createSdkMock = vi.mocked(createCliBbSdk);
const createRealSdk = createSdkMock.getMockImplementation();

function serverRecord(
  overrides: Partial<McpServerRecordResult> = {},
): McpServerRecordResult {
  return {
    id: "mcp_linear",
    handle: "linear",
    name: "Linear",
    description: null,
    type: "streamable-http",
    status: "ready",
    sourceKind: "manual",
    enabled: true,
    authStatus: "authenticated",
    lastError: null,
    sourceRef: "https://mcp.linear.app/mcp",
    registryName: null,
    registryVersion: null,
    config: {
      type: "streamable-http",
      url: "https://mcp.linear.app/mcp",
      headers: {},
    },
    toolCount: 3,
    promptCount: null,
    resourceCount: null,
    guide: null,
    ...overrides,
  };
}

const policyRows: McpToolPolicyResult[] = [
  { tool: "search_issues", risk: "read", mode: "inherit", policy: "allow" },
  {
    tool: "delete_issue",
    risk: "destructive",
    mode: "deny",
    policy: "deny",
  },
];

const providerStatus: ProviderGuardResult = {
  hostId: "host-1",
  hostName: "local",
  status: {
    claude: {
      settingsPath: "/home/me/.claude/settings.json",
      connectorsDisabled: true,
      bundledSkillsDisabled: true,
      skillSyncDisabled: true,
      enabledPlugins: [],
      mcpServers: [],
      pluginsDir: "/home/me/.claude/plugins",
      marketplaces: [],
      knownMarketplacesFile: null,
      installedPlugins: [],
      skillsDir: "/home/me/.claude/skills",
      extraSkills: [],
    },
    codex: {
      configPath: "/home/me/.codex/config.toml",
      features: [],
      systemSkills: [],
      mcpServers: [],
      pluginCacheDir: "/home/me/.codex/plugins/cache",
      pluginCache: [],
      skillsDir: "/home/me/.codex/skills",
      extraSkills: [],
    },
  },
  issues: [],
  changes: [],
  text: "machine: host-1\nguard: ok",
};

describe("bb mcp commands", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerMcpCommands(program, () => "http://server");

  let sdk: BbSdk;

  beforeEach(() => {
    if (!createRealSdk) throw new Error("createCliBbSdk mock has no default");
    sdk = createRealSdk("http://server");
    createSdkMock.mockImplementation(() => sdk);
  });

  afterEach(() => {
    if (createRealSdk) createSdkMock.mockImplementation(createRealSdk);
  });

  function logLines(): string[] {
    return collectLogLines(vi.mocked(console.log));
  }

  function errorOutput(): string {
    return collectLogLines(vi.mocked(console.error)).join("\n");
  }

  it("lists servers one per line and suggests the registry when empty", async () => {
    const list = vi
      .spyOn(sdk.mcp, "list")
      .mockResolvedValueOnce([
        serverRecord(),
        serverRecord({
          id: "mcp_files",
          handle: "files",
          type: "stdio",
          status: "idle",
        }),
      ])
      .mockResolvedValueOnce([]);

    await runCommand(["mcp", "list"], register);
    await runCommand(["mcp", "list"], register);

    expect(list).toHaveBeenCalledWith();
    expect(logLines()).toEqual([
      "mcp_linear  linear  streamable-http  ready\nmcp_files  files  stdio  idle",
      "No MCP servers. Try: bb mcp registry notion",
    ]);
  });

  it("lists full records as a bare JSON array with --details", async () => {
    const record = serverRecord();
    const list = vi.spyOn(sdk.mcp, "list").mockResolvedValue([record]);

    await runCommand(["mcp", "list", "--details", "--json"], register);

    expect(list).toHaveBeenCalledWith({ details: true });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual(
      [record],
    );
  });

  it("shows a server's settings and omits empty fields", async () => {
    const get = vi.spyOn(sdk.mcp, "get").mockResolvedValue(
      serverRecord({
        status: "needs-auth",
        authStatus: "unauthenticated",
        lastError: "401 Unauthorized",
        guide: "Use for Linear issues.",
      }),
    );

    await runCommand(["mcp", "show", "linear"], register);

    expect(get).toHaveBeenCalledWith({ server: "linear" });
    expect(logLines()).toEqual([
      [
        "id: mcp_linear",
        "handle: linear",
        "name: Linear",
        "type: streamable-http",
        "status: needs-auth",
        "enabled: true",
        "auth: unauthenticated",
        "source: https://mcp.linear.app/mcp",
        "error: 401 Unauthorized",
        "guide: Use for Linear issues.",
      ].join("\n"),
    ]);
  });

  it("adds an HTTP server with headers, choosing SSE from the URL", async () => {
    const add = vi
      .spyOn(sdk.mcp, "add")
      .mockResolvedValue({ id: "mcp_1", handle: "linear", name: "linear" });

    await runCommand(
      [
        "mcp",
        "add",
        "linear",
        "https://mcp.linear.app/sse",
        "--header",
        "Authorization: Bearer abc",
        "--header",
        "X-Team: core",
      ],
      register,
    );

    expect(add).toHaveBeenCalledWith({
      kind: "http",
      url: "https://mcp.linear.app/sse",
      transport: "sse",
      name: "linear",
      headers: { Authorization: "Bearer abc", "X-Team": "core" },
    });
    expect(logLines()).toEqual(["Added linear (mcp_1)"]);
  });

  it("adds a bare URL without a name and a registry id with one", async () => {
    const add = vi
      .spyOn(sdk.mcp, "add")
      .mockResolvedValue({ id: "mcp_2", handle: "example", name: "example" });

    await runCommand(["mcp", "add", "https://example.com/mcp"], register);
    await runCommand(
      ["mcp", "add", "notion", "io.github.makenotion/notion-mcp-server"],
      register,
    );

    expect(add).toHaveBeenNthCalledWith(1, {
      kind: "http",
      url: "https://example.com/mcp",
      transport: "streamable-http",
    });
    expect(add).toHaveBeenNthCalledWith(2, {
      kind: "registry",
      registryName: "io.github.makenotion/notion-mcp-server",
      name: "notion",
    });
  });

  it("adds a stdio command after -- and keeps its flags as arguments", async () => {
    const add = vi
      .spyOn(sdk.mcp, "add")
      .mockResolvedValue({ id: "mcp_3", handle: "files", name: "files" });

    await runCommand(
      [
        "mcp",
        "add",
        "files",
        "--json",
        "--",
        "npx",
        "-y",
        "@modelcontextprotocol/server-filesystem",
        "/tmp",
      ],
      register,
    );

    expect(add).toHaveBeenCalledWith({
      kind: "stdio",
      name: "files",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
    });
    expect(JSON.parse(collectLogPayloads(vi.mocked(console.log))[0]!)).toEqual(
      { id: "mcp_3", handle: "files", name: "files" },
    );
  });

  it("rejects ambiguous or invalid add invocations before calling the server", async () => {
    const add = vi.spyOn(sdk.mcp, "add");

    await expect(
      runCommand(["mcp", "add", "files", "npx", "server"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["mcp", "add", "files", "--header", "A: b", "--", "npx"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(
        ["mcp", "add", "x", "https://x.dev", "--header", "no-colon"],
        register,
      ),
    ).rejects.toThrow("process.exit:1");

    expect(add).not.toHaveBeenCalled();
    expect(errorOutput()).toContain("Put `--` before a local command");
    expect(errorOutput()).toContain(
      "--header and --sse apply to HTTP servers, not commands",
    );
    expect(errorOutput()).toContain(
      "invalid header (use Name: value): no-colon",
    );
  });

  it("lists, shows, and sets tool policies", async () => {
    const listPolicies = vi
      .spyOn(sdk.mcp, "listPolicies")
      .mockResolvedValue(policyRows);
    const setPolicy = vi.spyOn(sdk.mcp, "setPolicy").mockResolvedValue({
      tool: "delete_issue",
      risk: "destructive",
      mode: "confirm",
      policy: "confirm",
    });

    await runCommand(["mcp", "policy", "linear"], register);
    await runCommand(["mcp", "policy", "linear", "search_issues"], register);
    await runCommand(
      ["mcp", "policy", "linear", "delete_issue", "confirm"],
      register,
    );

    expect(listPolicies).toHaveBeenCalledWith({ server: "linear" });
    expect(setPolicy).toHaveBeenCalledWith({
      server: "linear",
      tool: "delete_issue",
      mode: "confirm",
    });
    expect(logLines()).toEqual([
      "search_issues  read         allow (default)\ndelete_issue   destructive  deny",
      "search_issues  read         allow (default)",
      "delete_issue  destructive  confirm",
    ]);
  });

  it("rejects unknown tools and policy modes", async () => {
    vi.spyOn(sdk.mcp, "listPolicies").mockResolvedValue(policyRows);
    const setPolicy = vi.spyOn(sdk.mcp, "setPolicy");

    await expect(
      runCommand(["mcp", "policy", "linear", "missing"], register),
    ).rejects.toThrow("process.exit:1");
    await expect(
      runCommand(["mcp", "policy", "linear", "delete_issue", "never"], register),
    ).rejects.toThrow("process.exit:1");

    expect(setPolicy).not.toHaveBeenCalled();
    expect(errorOutput()).toContain("Tool not found on linear: missing");
    expect(errorOutput()).toContain(
      "mode must be one of: inherit, allow, confirm, deny",
    );
  });

  it("keeps bb mcp providers as an alias of bb provider guard", async () => {
    const status = vi
      .spyOn(sdk.providers, "guardStatus")
      .mockResolvedValue(providerStatus);
    const fix = vi
      .spyOn(sdk.providers, "guardFix")
      .mockResolvedValue(providerStatus);

    await runCommand(["mcp", "providers"], register);
    await runCommand(["mcp", "providers", "--machine", "host-2"], register);
    await runCommand(
      ["mcp", "providers", "--fix", "--machine", "host-2", "--path", "/repo"],
      register,
    );

    expect(status).toHaveBeenNthCalledWith(1, { projectPath: process.cwd() });
    expect(status).toHaveBeenNthCalledWith(2, { hostId: "host-2" });
    expect(fix).toHaveBeenCalledWith({ hostId: "host-2", projectPath: "/repo" });
    expect(logLines()).toEqual([
      providerStatus.text,
      providerStatus.text,
      providerStatus.text,
    ]);
  });

  it("shows, sets, and clears a server guide", async () => {
    vi.spyOn(sdk.mcp, "get").mockResolvedValue(serverRecord());
    const setGuide = vi
      .spyOn(sdk.mcp, "setGuide")
      .mockResolvedValueOnce({
        id: "mcp_linear",
        handle: "linear",
        guide: "Use for issues.",
      })
      .mockResolvedValueOnce({ id: "mcp_linear", handle: "linear", guide: null });

    await runCommand(["mcp", "guide", "linear"], register);
    await runCommand(["mcp", "guide", "linear", "Use", "for", "issues."], register);
    await runCommand(["mcp", "guide", "linear", "--clear"], register);

    expect(setGuide).toHaveBeenNthCalledWith(1, {
      server: "linear",
      guide: "Use for issues.",
    });
    expect(setGuide).toHaveBeenNthCalledWith(2, {
      server: "linear",
      guide: null,
    });
    expect(logLines()).toEqual([
      "No guide for linear.",
      "Updated guide for linear",
      "Cleared guide for linear",
    ]);
  });

  it("rejects guide text combined with --clear", async () => {
    const setGuide = vi.spyOn(sdk.mcp, "setGuide");

    await expect(
      runCommand(["mcp", "guide", "linear", "text", "--clear"], register),
    ).rejects.toThrow("process.exit:1");

    expect(setGuide).not.toHaveBeenCalled();
    expect(errorOutput()).toContain("Pass guide text or --clear, not both");
  });

  it("calls a tool as the current thread with parsed JSON arguments", async () => {
    vi.stubEnv("BB_THREAD_ID", "thread-1");
    const callTool = vi.spyOn(sdk.mcp, "callTool").mockResolvedValue({
      content: [{ type: "text", text: "ok" }],
    });

    await runCommand(
      ["mcp", "call", "linear__search", '{"query":"roadmap"}'],
      register,
    );
    await expect(
      runCommand(["mcp", "call", "linear__search", "[1]"], register),
    ).rejects.toThrow("process.exit:1");

    expect(callTool).toHaveBeenCalledTimes(1);
    expect(callTool).toHaveBeenCalledWith({
      id: "linear__search",
      args: { query: "roadmap" },
      threadId: "thread-1",
    });
    expect(errorOutput()).toContain("call args must be JSON object");
  });

  it("removes a server by its resolved id and names it", async () => {
    vi.spyOn(sdk.mcp, "get").mockResolvedValue(serverRecord());
    const remove = vi
      .spyOn(sdk.mcp, "remove")
      .mockResolvedValue({ deleted: true, id: "mcp_linear" });

    await runCommand(["mcp", "remove", "linear"], register);

    expect(remove).toHaveBeenCalledWith({ server: "mcp_linear" });
    expect(logLines()).toEqual(["Removed Linear"]);
  });
});
