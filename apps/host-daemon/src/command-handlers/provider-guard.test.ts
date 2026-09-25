import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  codexMcpServerNames,
  disableClaudeConnectors,
  fixProviderMcpStatus,
  providerGuardPaths,
  readProviderMcpStatus,
} from "./mcp-provider-guard.js";

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bb-mcp-home-"));
});

afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

function paths() {
  return providerGuardPaths({
    HOME: home,
    CODEX_HOME: join(home, "codex-home"),
  });
}

async function writeFixtures(): Promise<string> {
  await mkdir(join(home, ".claude"), { recursive: true });
  await writeFile(
    join(home, ".claude", "settings.json"),
    JSON.stringify(
      { model: "opus", permissions: { allow: ["Bash(ls)"] } },
      null,
      2,
    ),
  );
  await writeFile(
    join(home, ".claude.json"),
    JSON.stringify({
      numStartups: 4,
      mcpServers: {
        notion: { type: "http", url: "https://mcp.notion.com/mcp" },
      },
      projects: {
        "/work/app": { mcpServers: { github: { command: "gh-mcp" } } },
        "/work/empty": { mcpServers: {} },
      },
    }),
  );
  await mkdir(join(home, "codex-home"), { recursive: true });
  await writeFile(
    join(home, "codex-home", "config.toml"),
    [
      'model = "gpt-5"',
      "[mcp_servers.linear]",
      'command = "linear-mcp"',
      "[mcp_servers.linear.env]",
      'TOKEN = "x"',
      '[mcp_servers."quoted name"]',
      'url = "https://x"',
      "[profiles.fast]",
      'mcp_servers = "not a table"',
    ].join("\n"),
  );
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  await writeFile(
    join(project, ".mcp.json"),
    JSON.stringify({ mcpServers: { local: { command: "local-mcp" } } }),
  );
  return project;
}

describe("provider MCP guard", () => {
  it("resolves config paths from HOME, CODEX_HOME, and CLAUDE_CONFIG_DIR", () => {
    expect(paths()).toEqual({
      claudeSettings: join(home, ".claude", "settings.json"),
      claudeJson: join(home, ".claude.json"),
      codexConfig: join(home, "codex-home", "config.toml"),
    });
    expect(
      providerGuardPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, "cc") }),
    ).toEqual({
      claudeSettings: join(home, "cc", "settings.json"),
      claudeJson: join(home, "cc", ".claude.json"),
      codexConfig: join(home, ".codex", "config.toml"),
    });
  });

  it("reports connectors and every MCP entry from the Claude and Codex config files", async () => {
    const project = await writeFixtures();
    const resolved = paths();
    expect(await readProviderMcpStatus(resolved, project)).toEqual({
      claude: {
        settingsPath: resolved.claudeSettings,
        connectorsDisabled: false,
        mcpServers: [
          { name: "notion", file: resolved.claudeJson, scope: "user" },
          {
            name: "github",
            file: resolved.claudeJson,
            scope: "project /work/app",
          },
          { name: "local", file: join(project, ".mcp.json"), scope: "project" },
        ],
      },
      codex: {
        configPath: resolved.codexConfig,
        mcpServers: [
          { name: "linear", file: resolved.codexConfig, scope: "user" },
          { name: "quoted name", file: resolved.codexConfig, scope: "user" },
        ],
      },
    });
  });

  it("treats missing files as clean and rejects files that are not JSON objects", async () => {
    const status = await readProviderMcpStatus(paths(), null);
    expect(status.claude).toMatchObject({
      connectorsDisabled: false,
      mcpServers: [],
    });
    expect(status.codex.mcpServers).toEqual([]);
    await writeFile(join(home, ".claude.json"), "[1, 2]");
    await expect(readProviderMcpStatus(paths(), null)).rejects.toThrow(
      "must contain a JSON object",
    );
  });

  it("finds Codex servers declared as a bare table, dotted keys, or an inline table", () => {
    expect(
      codexMcpServerNames(
        '[mcp_servers]\nalpha = { command = "a" }\nbeta.command = "b"\n[other]\ngamma = 1',
      ),
    ).toEqual(["alpha", "beta"]);
    expect(
      codexMcpServerNames(
        'mcp_servers.delta.command = "d"\nmcp_servers = { eps = { command = "e", args = ["x,y"] }, zeta = {} }',
      ),
    ).toEqual(["delta", "eps", "zeta"]);
    expect(
      codexMcpServerNames("# [mcp_servers.commented]\n[[mcp_servers.arr]]\n"),
    ).toEqual(["arr"]);
    expect(
      codexMcpServerNames('model = "x"\n[profiles.mcp_servers]\nfoo = 1'),
    ).toEqual([]);
  });

  it("merges disableClaudeAiConnectors into settings without dropping keys", async () => {
    await writeFixtures();
    const settingsPath = join(home, ".claude", "settings.json");
    await disableClaudeConnectors(settingsPath);
    const written = await readFile(settingsPath, "utf8");
    expect(JSON.parse(written)).toEqual({
      model: "opus",
      permissions: { allow: ["Bash(ls)"] },
      disableClaudeAiConnectors: true,
    });
    expect(written).toContain('\n  "model": "opus"');
    expect(await readdir(join(home, ".claude"))).toEqual(["settings.json"]);
    const before = (await stat(settingsPath)).mtimeMs;
    await disableClaudeConnectors(settingsPath);
    expect((await stat(settingsPath)).mtimeMs).toBe(before);
    await writeFile(settingsPath, "{ broken");
    await expect(disableClaudeConnectors(settingsPath)).rejects.toThrow(
      "not valid JSON",
    );
    expect(await readFile(settingsPath, "utf8")).toBe("{ broken");
  });

  it("creates a missing settings file on fix and returns the new status", async () => {
    expect(
      (await readProviderMcpStatus(paths(), null)).claude.connectorsDisabled,
    ).toBe(false);
    const fixed = await fixProviderMcpStatus(paths(), null);
    expect(fixed.claude.connectorsDisabled).toBe(true);
    expect(
      JSON.parse(
        await readFile(join(home, ".claude", "settings.json"), "utf8"),
      ),
    ).toEqual({ disableClaudeAiConnectors: true });
  });
});
