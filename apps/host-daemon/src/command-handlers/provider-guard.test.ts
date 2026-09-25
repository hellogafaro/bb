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
  applyCodexGuardConfig,
  codexFeatureValues,
  codexMcpServerNames,
  fixProviderGuard,
  mergeClaudeGuardSettings,
  providerGuardPaths,
  readProviderGuardStatus,
} from "./provider-guard.js";

let home = "";

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "bb-provider-guard-home-"));
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

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value, null, 2));
}

async function writeClaudeFixtures(): Promise<void> {
  const claude = join(home, ".claude");
  await mkdir(join(claude, "plugins", "marketplaces", "official", ".git"), {
    recursive: true,
  });
  await writeJson(join(claude, "settings.json"), {
    theme: "dark",
    model: "opus",
    permissions: { allow: ["Bash(ls)"] },
    enabledPlugins: { "notes@official": true, "old@official": false },
  });
  await writeJson(join(claude, "plugins", "known_marketplaces.json"), {
    official: { source: { source: "github" } },
  });
  for (const skill of ["bb-cli", "synced", "personal"])
    await mkdir(join(claude, "skills", skill), { recursive: true });
  await writeJson(join(home, ".claude.json"), {
    numStartups: 4,
    mcpServers: {
      notion: { type: "http", url: "https://mcp.notion.com/mcp" },
    },
    projects: {
      "/work/app": { mcpServers: { github: { command: "gh-mcp" } } },
      "/work/empty": { mcpServers: {} },
    },
  });
}

const CODEX_CONFIG = [
  'model = "gpt-5"',
  "",
  "[features]",
  "apps = true",
  "unified_exec = true",
  "",
  "[mcp_servers.linear]",
  'command = "linear-mcp"',
  "[mcp_servers.linear.env]",
  'TOKEN = "x"',
  '[mcp_servers."quoted name"]',
  'url = "https://x"',
  "",
  '[projects."/work/app"]',
  'trust_level = "trusted"',
  "",
].join("\n");

async function writeCodexFixtures(): Promise<string> {
  const codex = join(home, "codex-home");
  for (const skill of ["imagegen", "skill-creator"])
    await mkdir(join(codex, "skills", ".system", skill), { recursive: true });
  await writeFile(join(codex, "skills", ".system", ".marker"), "");
  await mkdir(join(codex, "skills", "mine"), { recursive: true });
  await mkdir(join(codex, "skills", "bb-cli"), { recursive: true });
  await mkdir(join(codex, "plugins", "cache", "openai-curated-remote"), {
    recursive: true,
  });
  await writeFile(join(codex, "config.toml"), CODEX_CONFIG);
  const project = join(home, "project");
  await mkdir(project, { recursive: true });
  await writeJson(join(project, ".mcp.json"), {
    mcpServers: { local: { command: "local-mcp" } },
  });
  return project;
}

describe("provider guard paths", () => {
  it("resolves config paths from HOME, CODEX_HOME, and CLAUDE_CONFIG_DIR", () => {
    expect(paths()).toEqual({
      claudeSettings: join(home, ".claude", "settings.json"),
      claudeJson: join(home, ".claude.json"),
      claudePluginsDir: join(home, ".claude", "plugins"),
      claudeSkillsDir: join(home, ".claude", "skills"),
      codexHome: join(home, "codex-home"),
      codexConfig: join(home, "codex-home", "config.toml"),
    });
    expect(
      providerGuardPaths({ HOME: home, CLAUDE_CONFIG_DIR: join(home, "cc") }),
    ).toMatchObject({
      claudeSettings: join(home, "cc", "settings.json"),
      claudeJson: join(home, "cc", ".claude.json"),
      claudePluginsDir: join(home, "cc", "plugins"),
      codexConfig: join(home, ".codex", "config.toml"),
    });
  });
});

describe("provider guard status", () => {
  it("reports every provider-owned MCP, skill, and plugin source", async () => {
    await writeClaudeFixtures();
    const project = await writeCodexFixtures();
    const resolved = paths();
    const codexHome = join(home, "codex-home");
    expect(await readProviderGuardStatus(resolved, project)).toEqual({
      claude: {
        settingsPath: resolved.claudeSettings,
        connectorsDisabled: false,
        bundledSkillsDisabled: false,
        skillSyncDisabled: false,
        enabledPlugins: ["notes@official"],
        mcpServers: [
          { name: "notion", file: resolved.claudeJson, scope: "user" },
          {
            name: "github",
            file: resolved.claudeJson,
            scope: "project /work/app",
          },
          { name: "local", file: join(project, ".mcp.json"), scope: "project" },
        ],
        pluginsDir: resolved.claudePluginsDir,
        marketplaces: ["official"],
        knownMarketplacesFile: join(
          resolved.claudePluginsDir,
          "known_marketplaces.json",
        ),
        installedPlugins: [],
        skillsDir: resolved.claudeSkillsDir,
        extraSkills: ["personal", "synced"],
      },
      codex: {
        configPath: resolved.codexConfig,
        features: [
          { key: "remote_plugin", value: null },
          { key: "plugins", value: null },
          { key: "apps", value: true },
          { key: "skill_mcp_dependency_install", value: null },
        ],
        systemSkills: [
          {
            name: "imagegen",
            path: join(codexHome, "skills", ".system", "imagegen", "SKILL.md"),
            disabled: false,
          },
          {
            name: "skill-creator",
            path: join(
              codexHome,
              "skills",
              ".system",
              "skill-creator",
              "SKILL.md",
            ),
            disabled: false,
          },
        ],
        mcpServers: [
          { name: "linear", file: resolved.codexConfig, scope: "user" },
          { name: "quoted name", file: resolved.codexConfig, scope: "user" },
        ],
        pluginCacheDir: join(codexHome, "plugins", "cache"),
        pluginCache: ["openai-curated-remote"],
        skillsDir: join(codexHome, "skills"),
        extraSkills: ["mine"],
      },
    });
  });

  it("treats missing files as clean and rejects files that are not JSON objects", async () => {
    const status = await readProviderGuardStatus(paths(), null);
    expect(status.claude).toMatchObject({
      connectorsDisabled: false,
      bundledSkillsDisabled: false,
      skillSyncDisabled: false,
      enabledPlugins: [],
      mcpServers: [],
      marketplaces: [],
      knownMarketplacesFile: null,
      extraSkills: [],
    });
    expect(status.codex).toMatchObject({
      mcpServers: [],
      systemSkills: [],
      pluginCache: [],
      extraSkills: [],
    });
    await writeFile(join(home, ".claude.json"), "[1, 2]");
    await expect(readProviderGuardStatus(paths(), null)).rejects.toThrow(
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

  it("reads Codex feature flags from a table or top-level dotted keys", () => {
    expect([
      ...codexFeatureValues(
        "features.apps = false\n[features]\nplugins = true # on\n[profiles.x.features]\nremote_plugin = true",
      ),
    ]).toEqual([
      ["apps", false],
      ["plugins", true],
    ]);
  });
});

describe("Claude settings merge", () => {
  it("sets the guard keys without dropping theme or other keys", async () => {
    await writeClaudeFixtures();
    const settingsPath = join(home, ".claude", "settings.json");
    expect(await mergeClaudeGuardSettings(settingsPath)).toEqual([
      `Set "disableClaudeAiConnectors": true in ${settingsPath}`,
      `Set "disableBundledSkills": true in ${settingsPath}`,
      `Set "syncClaudeAiSkills": false in ${settingsPath}`,
      `Set "enabledPlugins": {} in ${settingsPath}`,
    ]);
    const written = await readFile(settingsPath, "utf8");
    expect(JSON.parse(written)).toEqual({
      theme: "dark",
      model: "opus",
      permissions: { allow: ["Bash(ls)"] },
      enabledPlugins: {},
      disableClaudeAiConnectors: true,
      disableBundledSkills: true,
      syncClaudeAiSkills: false,
    });
    expect(written).toContain('\n  "theme": "dark"');
    expect(await readdir(join(home, ".claude"))).toEqual([
      "plugins",
      "settings.json",
      "skills",
    ]);
    const before = (await stat(settingsPath)).mtimeMs;
    expect(await mergeClaudeGuardSettings(settingsPath)).toEqual([]);
    expect((await stat(settingsPath)).mtimeMs).toBe(before);
  });

  it("creates a missing settings file and refuses to overwrite invalid JSON", async () => {
    const settingsPath = join(home, ".claude", "settings.json");
    await mergeClaudeGuardSettings(settingsPath);
    expect(JSON.parse(await readFile(settingsPath, "utf8"))).toEqual({
      disableClaudeAiConnectors: true,
      disableBundledSkills: true,
      syncClaudeAiSkills: false,
      enabledPlugins: {},
    });
    await writeFile(settingsPath, "{ broken");
    await expect(mergeClaudeGuardSettings(settingsPath)).rejects.toThrow(
      "not valid JSON",
    );
    expect(await readFile(settingsPath, "utf8")).toBe("{ broken");
  });
});

describe("Codex config editor", () => {
  const skill = "/h/.codex/skills/.system/imagegen/SKILL.md";

  it("creates the features table and skill entries in an empty config", () => {
    const edit = applyCodexGuardConfig("", [skill]);
    expect(edit.text).toBe(
      [
        "[features]",
        "remote_plugin = false",
        "plugins = false",
        "apps = false",
        "skill_mcp_dependency_install = false",
        "",
        "[[skills.config]]",
        `path = "${skill}"`,
        "enabled = false",
        "",
      ].join("\n"),
    );
    expect(applyCodexGuardConfig(edit.text, [skill])).toEqual({
      text: edit.text,
      features: [],
      skills: [],
    });
  });

  it("edits an existing features table in place and preserves every other line", () => {
    const edit = applyCodexGuardConfig(CODEX_CONFIG, []);
    expect(edit.features).toEqual([
      "remote_plugin",
      "plugins",
      "apps",
      "skill_mcp_dependency_install",
    ]);
    expect(edit.text).toBe(
      CODEX_CONFIG.replace(
        "[features]\napps = true\nunified_exec = true\n",
        "[features]\napps = false\nunified_exec = true\nremote_plugin = false\nplugins = false\nskill_mcp_dependency_install = false\n",
      ),
    );
    expect(applyCodexGuardConfig(edit.text, []).text).toBe(edit.text);
  });

  it("extends top-level dotted feature keys instead of adding a conflicting table", () => {
    const edit = applyCodexGuardConfig(
      'model = "x"\nfeatures.apps = false\n[tui]\nanimations = false',
      [],
    );
    expect(edit.text).toBe(
      'model = "x"\nfeatures.apps = false\nfeatures.remote_plugin = false\nfeatures.plugins = false\nfeatures.skill_mcp_dependency_install = false\n[tui]\nanimations = false\n',
    );
    expect(applyCodexGuardConfig(edit.text, []).text).toBe(edit.text);
  });

  it("disables existing skill entries and appends missing ones", () => {
    const other = "/h/.codex/skills/.system/skill-creator/SKILL.md";
    const base = [
      "[features]",
      "remote_plugin = false",
      "plugins = false",
      "apps = false",
      "skill_mcp_dependency_install = false",
      "",
      "[[skills.config]]",
      `path = "${skill}"`,
      "enabled = true",
      "",
      "[[skills.config]]",
      `path = '${other}'`,
    ].join("\n");
    const edit = applyCodexGuardConfig(base, [skill, other]);
    expect(edit.skills).toEqual([skill, other]);
    expect(edit.text).toBe(
      `${base.replace("enabled = true", "enabled = false")}\nenabled = false\n`,
    );
    expect(applyCodexGuardConfig(edit.text, [skill, other]).text).toBe(
      edit.text,
    );
  });

  it("refuses inline features or skills tables it cannot edit safely", () => {
    expect(() =>
      applyCodexGuardConfig("features = { apps = true }\n", []),
    ).toThrow("edit it by hand");
    expect(() =>
      applyCodexGuardConfig("[skills]\nconfig = []\n", [skill]),
    ).toThrow("edit it by hand");
  });
});

describe("provider guard fix", () => {
  it("locks both providers down, keeps skills, and changes nothing on a second run", async () => {
    await writeClaudeFixtures();
    const project = await writeCodexFixtures();
    const resolved = paths();
    const first = await fixProviderGuard(resolved, project);
    expect(first.changes).toEqual(
      expect.arrayContaining([
        `Deleted ${join(resolved.claudePluginsDir, "marketplaces", "official")}`,
        `Deleted ${join(resolved.claudePluginsDir, "known_marketplaces.json")}`,
        `Set features.remote_plugin = false in ${resolved.codexConfig}`,
        `Deleted ${join(home, "codex-home", "plugins", "cache")}`,
      ]),
    );
    expect(first.status.claude).toMatchObject({
      connectorsDisabled: true,
      bundledSkillsDisabled: true,
      skillSyncDisabled: true,
      enabledPlugins: [],
      marketplaces: [],
      knownMarketplacesFile: null,
      extraSkills: ["personal", "synced"],
    });
    expect(first.status.codex.features.map((feature) => feature.value)).toEqual(
      [false, false, false, false],
    );
    expect(
      first.status.codex.systemSkills.every((entry) => entry.disabled),
    ).toBe(true);
    expect(first.status.codex).toMatchObject({
      pluginCache: [],
      extraSkills: ["mine"],
    });
    expect(first.status.codex.mcpServers).toHaveLength(2);

    const config = await readFile(resolved.codexConfig, "utf8");
    const settings = await readFile(resolved.claudeSettings, "utf8");
    const second = await fixProviderGuard(resolved, project);
    expect(second.changes).toEqual([]);
    expect(await readFile(resolved.codexConfig, "utf8")).toBe(config);
    expect(await readFile(resolved.claudeSettings, "utf8")).toBe(settings);
    expect(second.status).toEqual(first.status);
  });

  it("keeps marketplace clones while installed_plugins.json lists plugins", async () => {
    await writeClaudeFixtures();
    const resolved = paths();
    await writeJson(join(resolved.claudePluginsDir, "installed_plugins.json"), {
      version: 2,
      plugins: { "notes@official": [{ scope: "user" }] },
    });
    const result = await fixProviderGuard(resolved, null);
    expect(result.status.claude).toMatchObject({
      installedPlugins: ["notes@official"],
      marketplaces: ["official"],
    });
    expect(result.status.claude.knownMarketplacesFile).not.toBeNull();
    expect(result.changes.some((change) => change.startsWith("Deleted"))).toBe(
      false,
    );
  });
});
