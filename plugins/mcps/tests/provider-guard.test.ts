import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { experimental_createHostEntryHarness } from "@get-bb/plugin-sdk/testing/host";
import hostEntry from "../host.js";
import plugin from "../server";
import {
  codexMcpServerNames,
  disableClaudeConnectors,
  providerGuardIssues,
  providerGuardPaths,
  readProviderMcpStatus,
} from "../src/provider-guard.js";

const ENV_KEYS = ["HOME", "CODEX_HOME", "CLAUDE_CONFIG_DIR"] as const;
let saved: Record<string, string | undefined> = {};
let home = "";

beforeEach(async () => {
  saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  home = await mkdtemp(join(tmpdir(), "bb-mcps-home-"));
  process.env.HOME = home;
  process.env.CODEX_HOME = join(home, "codex-home");
  delete process.env.CLAUDE_CONFIG_DIR;
});

afterEach(async () => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  await rm(home, { recursive: true, force: true });
});

async function writeFixtures() {
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(join(home, ".claude", "settings.json"), JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }, null, 2));
  await writeFile(join(home, ".claude.json"), JSON.stringify({
    numStartups: 4,
    mcpServers: { notion: { type: "http", url: "https://mcp.notion.com/mcp" } },
    projects: { "/work/app": { mcpServers: { github: { command: "gh-mcp" } } }, "/work/empty": { mcpServers: {} } },
  }));
  await mkdir(join(home, "codex-home"), { recursive: true });
  await writeFile(join(home, "codex-home", "config.toml"), [
    "model = \"gpt-5\"",
    "[mcp_servers.linear]",
    "command = \"linear-mcp\"",
    "[mcp_servers.linear.env]",
    "TOKEN = \"x\"",
    "[mcp_servers.\"quoted name\"]",
    "url = \"https://x\"",
    "[profiles.fast]",
    "mcp_servers = \"not a table\"",
  ].join("\n"));
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  await writeFile(join(project, ".mcp.json"), JSON.stringify({ mcpServers: { local: { command: "local-mcp" } } }));
  return project;
}

describe("provider MCP guard", () => {
  it("reports connectors and every MCP entry from the Claude and Codex config files", async () => {
    const project = await writeFixtures();
    const paths = providerGuardPaths();
    expect(paths).toEqual({
      claudeSettings: join(home, ".claude", "settings.json"),
      claudeJson: join(home, ".claude.json"),
      codexConfig: join(home, "codex-home", "config.toml"),
    });
    const status = await readProviderMcpStatus({ projectPath: project });
    expect(status).toEqual({
      claude: {
        settingsPath: paths.claudeSettings,
        connectorsDisabled: false,
        mcpServers: [
          { name: "notion", file: paths.claudeJson, scope: "user" },
          { name: "github", file: paths.claudeJson, scope: "project /work/app" },
          { name: "local", file: join(project, ".mcp.json"), scope: "project" },
        ],
      },
      codex: {
        configPath: paths.codexConfig,
        mcpServers: [
          { name: "linear", file: paths.codexConfig, scope: "user" },
          { name: "quoted name", file: paths.codexConfig, scope: "user" },
        ],
      },
    });
    const issues = providerGuardIssues(status);
    expect(issues.map((issue) => issue.provider)).toEqual(["claude", "claude", "claude", "claude", "codex", "codex"]);
    expect(issues[0]!.message).toContain("disableClaudeAiConnectors");
    expect(issues[2]!.message).toContain(`"github" (project /work/app) in ${paths.claudeJson}`);
    expect(issues[4]!.message).toContain("[mcp_servers.linear]");
  });

  it("treats missing files as clean and rejects files that are not JSON objects", async () => {
    const status = await readProviderMcpStatus();
    expect(status.claude).toMatchObject({ connectorsDisabled: false, mcpServers: [] });
    expect(status.codex.mcpServers).toEqual([]);
    expect(providerGuardIssues(status)).toHaveLength(1);
    await writeFile(join(home, ".claude.json"), "[1, 2]");
    await expect(readProviderMcpStatus()).rejects.toThrow("must contain a JSON object");
  });

  it("finds Codex servers declared as a bare table, dotted keys, or an inline table", () => {
    expect(codexMcpServerNames("[mcp_servers]\nalpha = { command = \"a\" }\nbeta.command = \"b\"\n[other]\ngamma = 1")).toEqual(["alpha", "beta"]);
    expect(codexMcpServerNames("mcp_servers.delta.command = \"d\"\nmcp_servers = { eps = { command = \"e\", args = [\"x,y\"] }, zeta = {} }")).toEqual(["delta", "eps", "zeta"]);
    expect(codexMcpServerNames("# [mcp_servers.commented]\n[[mcp_servers.arr]]\n")).toEqual(["arr"]);
    expect(codexMcpServerNames("model = \"x\"\n[profiles.mcp_servers]\nfoo = 1")).toEqual([]);
  });

  it("merges disableClaudeAiConnectors into settings without dropping keys", async () => {
    await writeFixtures();
    const settingsPath = join(home, ".claude", "settings.json");
    await disableClaudeConnectors(settingsPath);
    const written = await readFile(settingsPath, "utf8");
    expect(JSON.parse(written)).toEqual({ model: "opus", permissions: { allow: ["Bash(ls)"] }, disableClaudeAiConnectors: true });
    expect(written).toContain("\n  \"model\": \"opus\"");
    expect(await readdir(join(home, ".claude"))).toEqual(["settings.json"]);
    const before = (await stat(settingsPath)).mtimeMs;
    await disableClaudeConnectors(settingsPath);
    expect((await stat(settingsPath)).mtimeMs).toBe(before);
    await writeFile(settingsPath, "{ broken");
    await expect(disableClaudeConnectors(settingsPath)).rejects.toThrow("not valid JSON");
    expect(await readFile(settingsPath, "utf8")).toBe("{ broken");
  });

  it("creates a missing settings file through the host RPC and returns the new status", async () => {
    const harness = experimental_createHostEntryHarness(hostEntry);
    try {
      expect((await harness.experimental_call("providerMcpStatus", {})).claude.connectorsDisabled).toBe(false);
      const fixed = await harness.experimental_call("providerMcpFix", {});
      expect(fixed.claude.connectorsDisabled).toBe(true);
      expect(JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"))).toEqual({ disableClaudeAiConnectors: true });
    } finally { await harness.experimental_dispose(); }
  });

  it("prints the status, fixes connectors, and targets a chosen machine over the CLI", async () => {
    await writeFixtures();
    const hostHarness = experimental_createHostEntryHarness(hostEntry);
    const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-providers-"));
    const hostIds: string[] = [];
    const { bb, harness } = createFakePluginHost({
      pluginId: "mcps",
      sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } },
      experimental_callHostRpc: async (call) => {
        hostIds.push(call.hostId);
        if (call.method !== "providerMcpStatus" && call.method !== "providerMcpFix") throw new Error(`unexpected ${call.method}`);
        return hostHarness.experimental_call(call.method, call.input as { projectPath?: string });
      },
    });
    await plugin(bb);
    try {
      const status = await harness.behavior.runCli(["providers"]);
      expect(status.exitCode).toBe(0);
      expect(status.stdout).toContain("machine: host_1");
      expect(status.stdout).toContain(`claude.ai connectors: ENABLED (${join(home, ".claude", "settings.json")})`);
      expect(status.stdout).toContain(`notion (user) in ${join(home, ".claude.json")}`);
      expect(status.stdout).toContain("Remove \"notion\" from the top-level mcpServers by hand.");
      expect(status.stdout).toContain("Remove \"github\" from projects[\"/work/app\"].mcpServers by hand.");
      expect(status.stdout).toContain("Delete the [mcp_servers.linear] table by hand.");
      expect(status.stdout).toContain("Delete the [mcp_servers.\"quoted name\"] table by hand.");
      expect(status.stdout).toContain("guard: 5 issue(s); run bb mcp providers --fix to disable claude.ai connectors");

      const project = await harness.behavior.runCli(["providers", "--path", join(home, "project"), "--json"]);
      expect(JSON.parse(project.stdout!).status.claude.mcpServers.map((entry: { name: string }) => entry.name)).toEqual(["notion", "github", "local"]);

      const fixed = await harness.behavior.runCli(["providers", "--fix", "--machine", "host_2", "--json"]);
      const payload = JSON.parse(fixed.stdout!);
      expect(payload).toMatchObject({ hostId: "host_2", status: { claude: { connectorsDisabled: true } } });
      expect(payload.issues).toHaveLength(4);
      expect(hostIds.at(-1)).toBe("host_2");
      expect(JSON.parse(await readFile(join(home, ".claude", "settings.json"), "utf8"))).toMatchObject({ model: "opus", disableClaudeAiConnectors: true });

      const rpc = await harness.behavior.callRpc("providerStatus", {}) as { issues: unknown[] };
      expect(rpc.issues).toHaveLength(4);
      expect((await harness.behavior.runCli(["providers", "--bogus"])).exitCode).toBe(2);
    } finally {
      await harness.lifecycle.dispose();
      await hostHarness.experimental_dispose();
      await rm(dataDir, { recursive: true, force: true });
    }
  });
});
