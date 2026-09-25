import { describe, expect, it } from "vitest";
import type { ProviderGuardStatus } from "@bb/host-daemon-contract";
import {
  formatProviderGuard,
  providerGuardIssues,
} from "../../../src/services/providers/provider-guard.js";

const status: ProviderGuardStatus = {
  claude: {
    settingsPath: "/home/u/.claude/settings.json",
    connectorsDisabled: false,
    bundledSkillsDisabled: false,
    skillSyncDisabled: false,
    enabledPlugins: ["notes@official"],
    mcpServers: [
      { name: "notion", file: "/home/u/.claude.json", scope: "user" },
      {
        name: "github",
        file: "/home/u/.claude.json",
        scope: "project /work/app",
      },
      { name: "local", file: "/work/app/.mcp.json", scope: "project" },
    ],
    pluginsDir: "/home/u/.claude/plugins",
    marketplaces: ["claude-plugins-official"],
    knownMarketplacesFile: "/home/u/.claude/plugins/known_marketplaces.json",
    installedPlugins: [],
    skillsDir: "/home/u/.claude/skills",
    extraSkills: ["synced"],
  },
  codex: {
    configPath: "/home/u/.codex/config.toml",
    features: [
      { key: "remote_plugin", value: null },
      { key: "plugins", value: false },
      { key: "apps", value: true },
      { key: "skill_mcp_dependency_install", value: false },
    ],
    systemSkills: [
      {
        name: "imagegen",
        path: "/home/u/.codex/skills/.system/imagegen/SKILL.md",
        disabled: false,
      },
      {
        name: "skill-creator",
        path: "/home/u/.codex/skills/.system/skill-creator/SKILL.md",
        disabled: true,
      },
    ],
    mcpServers: [
      { name: "linear", file: "/home/u/.codex/config.toml", scope: "user" },
      {
        name: "quoted name",
        file: "/home/u/.codex/config.toml",
        scope: "user",
      },
    ],
    pluginCacheDir: "/home/u/.codex/plugins/cache",
    pluginCache: ["openai-curated-remote"],
    skillsDir: "/home/u/.codex/skills",
    extraSkills: [],
  },
};

const clean: ProviderGuardStatus = {
  claude: {
    ...status.claude,
    connectorsDisabled: true,
    bundledSkillsDisabled: true,
    skillSyncDisabled: true,
    enabledPlugins: [],
    mcpServers: [],
    marketplaces: [],
    knownMarketplacesFile: null,
    extraSkills: [],
  },
  codex: {
    ...status.codex,
    features: status.codex.features.map((feature) => ({
      ...feature,
      value: false,
    })),
    systemSkills: status.codex.systemSkills.map((skill) => ({
      ...skill,
      disabled: true,
    })),
    mcpServers: [],
    pluginCache: [],
  },
};

describe("provider guard issues", () => {
  it("separates fixable settings from sources that need a hand edit", () => {
    const issues = providerGuardIssues(status);
    expect(
      issues.map((issue) => [issue.provider, issue.fixable, issue.message]),
    ).toEqual([
      ["claude", true, expect.stringContaining("disableClaudeAiConnectors")],
      ["claude", true, expect.stringContaining("disableBundledSkills")],
      ["claude", true, expect.stringContaining("syncClaudeAiSkills")],
      ["claude", true, expect.stringContaining("(notes@official)")],
      ["claude", true, expect.stringContaining("claude-plugins-official")],
      ["claude", false, expect.stringContaining('"notion" (user)')],
      [
        "claude",
        false,
        expect.stringContaining('"github" (project /work/app)'),
      ],
      ["claude", false, expect.stringContaining('"local" (project)')],
      ["claude", false, expect.stringContaining("(synced)")],
      ["codex", true, expect.stringContaining("(remote_plugin, apps)")],
      ["codex", true, expect.stringContaining("(imagegen)")],
      ["codex", true, expect.stringContaining("openai-curated-remote")],
      ["codex", false, expect.stringContaining("[mcp_servers.linear]")],
      ["codex", false, expect.stringContaining('[mcp_servers."quoted name"]')],
    ]);
    expect(providerGuardIssues(clean)).toEqual([]);
  });

  it("keeps marketplaces while Claude Code still lists installed plugins", () => {
    const issues = providerGuardIssues({
      ...clean,
      claude: {
        ...clean.claude,
        marketplaces: ["official"],
        installedPlugins: ["notes@official"],
      },
    });
    expect(issues).toEqual([
      {
        provider: "claude",
        fixable: false,
        message: expect.stringContaining(
          "kept because installed_plugins.json lists notes@official",
        ),
      },
    ]);
  });
});

describe("provider guard text", () => {
  it("prints each provider source with hand-edit instructions", () => {
    const text = formatProviderGuard({
      hostId: "host_1",
      status,
      issues: providerGuardIssues(status),
      changes: [],
    });
    expect(text).toContain("machine: host_1");
    expect(text).toContain(
      "claude.ai connectors: ENABLED (/home/u/.claude/settings.json)",
    );
    expect(text).toContain("bundled skills: ENABLED");
    expect(text).toContain("claude.ai skill sync: ENABLED");
    expect(text).toContain(
      "plugin marketplaces: claude-plugins-official (/home/u/.claude/plugins)",
    );
    expect(text).toContain(
      'Remove "github" from projects["/work/app"].mcpServers by hand.',
    );
    expect(text).toContain(
      "skills outside BB: synced (/home/u/.claude/skills, report only)",
    );
    expect(text).toContain(
      "features: remote_plugin=unset, plugins=false, apps=true, skill_mcp_dependency_install=false",
    );
    expect(text).toContain("system skills: ENABLED imagegen");
    expect(text).toContain(
      "plugin cache: openai-curated-remote (/home/u/.codex/plugins/cache)",
    );
    expect(text).toContain(
      'Delete the [mcp_servers."quoted name"] table by hand.',
    );
    expect(text).toContain(
      "guard: 14 issue(s); run bb provider guard --fix to apply 8 fix(es)",
    );
  });

  it("lists the changes a fix made before a clean status", () => {
    const text = formatProviderGuard({
      hostId: "host_2",
      status: clean,
      issues: [],
      changes: ['Set "enabledPlugins": {} in /home/u/.claude/settings.json'],
    });
    expect(text.split("\n").slice(0, 2)).toEqual([
      "machine: host_2",
      'Set "enabledPlugins": {} in /home/u/.claude/settings.json',
    ]);
    expect(text).toContain("system skills: all disabled");
    expect(text.endsWith("guard: ok")).toBe(true);
  });
});
