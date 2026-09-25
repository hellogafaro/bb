import { describe, expect, it } from "vitest";
import {
  formatProviderStatus,
  providerGuardIssues,
} from "../../../src/services/mcp/provider-guard.js";

const status = {
  claude: {
    settingsPath: "/home/u/.claude/settings.json",
    connectorsDisabled: false,
    mcpServers: [
      { name: "notion", file: "/home/u/.claude.json", scope: "user" },
      {
        name: "github",
        file: "/home/u/.claude.json",
        scope: "project /work/app",
      },
      { name: "local", file: "/work/app/.mcp.json", scope: "project" },
    ],
  },
  codex: {
    configPath: "/home/u/.codex/config.toml",
    mcpServers: [
      { name: "linear", file: "/home/u/.codex/config.toml", scope: "user" },
      {
        name: "quoted name",
        file: "/home/u/.codex/config.toml",
        scope: "user",
      },
    ],
  },
};

describe("provider MCP guard issues", () => {
  it("lists connectors and every provider MCP entry with a fix hint", () => {
    const issues = providerGuardIssues(status);
    expect(issues.map((issue) => issue.provider)).toEqual([
      "claude",
      "claude",
      "claude",
      "claude",
      "codex",
      "codex",
    ]);
    expect(issues[0]?.message).toContain("disableClaudeAiConnectors");
    expect(issues[2]?.message).toContain(
      '"github" (project /work/app) in /home/u/.claude.json',
    );
    expect(issues[4]?.message).toContain("[mcp_servers.linear]");
    expect(
      providerGuardIssues({
        ...status,
        claude: { ...status.claude, connectorsDisabled: true, mcpServers: [] },
        codex: { ...status.codex, mcpServers: [] },
      }),
    ).toEqual([]);
  });

  it("formats the status with per-entry instructions", () => {
    const text = formatProviderStatus(
      { hostId: "host_1", status, issues: providerGuardIssues(status) },
      false,
    );
    expect(text).toContain("machine: host_1");
    expect(text).toContain(
      "claude.ai connectors: ENABLED (/home/u/.claude/settings.json)",
    );
    expect(text).toContain(
      'Remove "notion" from the top-level mcpServers by hand.',
    );
    expect(text).toContain(
      'Remove "github" from projects["/work/app"].mcpServers by hand.',
    );
    expect(text).toContain("Delete the [mcp_servers.linear] table by hand.");
    expect(text).toContain(
      'Delete the [mcp_servers."quoted name"] table by hand.',
    );
    expect(text).toContain(
      "guard: 6 issue(s); run bb mcp providers --fix to disable claude.ai connectors",
    );
    const fixed = {
      ...status,
      claude: { ...status.claude, connectorsDisabled: true },
    };
    expect(
      formatProviderStatus(
        { hostId: "host_2", status: fixed, issues: providerGuardIssues(fixed) },
        true,
      ),
    ).toContain(
      'Set "disableClaudeAiConnectors": true in /home/u/.claude/settings.json',
    );
  });
});
