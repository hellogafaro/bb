import type { HostDaemonOnlineRpcRequestMessage } from "@bb/host-daemon-contract";
import type { ToolCallResponse } from "@bb/domain";
import {
  executeMcpToolCall,
  type McpToolName,
} from "../../../src/services/threads/mcp-tools.js";
import {
  registerHostRpcResponder,
  type HostRpcHandlerResult,
} from "../../helpers/host-rpc.js";
import { seedPrimaryHost, seedThreadFixture } from "../../helpers/seed.js";
import type { TestAppHarness } from "../../helpers/test-app.js";

export const notesCatalog = {
  tools: [
    {
      name: "read_notes",
      description: "Read notes",
      inputSchema: { type: "object" },
      annotations: { readOnlyHint: true },
    },
    {
      name: "write_note",
      description: "Write a note",
      inputSchema: { type: "object" },
    },
    {
      name: "drop_notes",
      description: "Drop every note",
      inputSchema: { type: "object" },
      annotations: { destructiveHint: true },
    },
  ],
  prompts: [],
  resources: [],
  resourceTemplates: [],
};

export const cleanProviderStatus = {
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
    features: [
      { key: "remote_plugin", value: false },
      { key: "plugins", value: false },
      { key: "apps", value: false },
      { key: "skill_mcp_dependency_install", value: false },
    ],
    systemSkills: [],
    mcpServers: [],
    pluginCacheDir: "/home/u/.codex/plugins/cache",
    pluginCache: [],
    skillsDir: "/home/u/.codex/skills",
    extraSkills: [],
  },
};

export interface McpHostFixture {
  hostId: string;
  threadId: string;
  ran: string[];
  started: string[];
  requests: HostDaemonOnlineRpcRequestMessage[];
}

function answer(
  request: HostDaemonOnlineRpcRequestMessage,
  fixture: Pick<McpHostFixture, "ran" | "started">,
): HostRpcHandlerResult {
  const { command } = request;
  switch (command.type) {
    case "mcp.stdio.start":
      fixture.started.push(command.id);
      return { ok: true, result: structuredClone(notesCatalog) };
    case "mcp.stdio.refresh":
      return { ok: true, result: structuredClone(notesCatalog) };
    case "mcp.stdio.close":
      return { ok: true, result: { closed: true } };
    case "mcp.stdio.callTool":
      fixture.ran.push(command.name);
      return {
        ok: true,
        result: { content: [{ type: "text", text: `ran ${command.name}` }] },
      };
    case "providers.guardStatus":
      return { ok: true, result: structuredClone(cleanProviderStatus) };
    case "providers.guardFix":
      return {
        ok: true,
        result: {
          status: structuredClone(cleanProviderStatus),
          changes: [
            'Set "disableBundledSkills": true in /home/u/.claude/settings.json',
          ],
        },
      };
    default:
      return {
        ok: false,
        errorCode: "unexpected",
        errorMessage: `unexpected ${command.type}`,
      };
  }
}

export function mcpHostFixture(harness: TestAppHarness): McpHostFixture {
  const { host, session, thread } = seedThreadFixture(harness);
  seedPrimaryHost(harness.deps, host.id);
  const fixture = { ran: [] as string[], started: [] as string[] };
  const responder = registerHostRpcResponder(harness, {
    hostId: host.id,
    sessionId: session.id,
    handle: (request) => answer(request, fixture),
  });
  return {
    hostId: host.id,
    threadId: thread.id,
    requests: responder.requests,
    ...fixture,
  };
}

export function callAgentTool(
  harness: TestAppHarness,
  name: McpToolName,
  input: unknown,
  threadId: string,
): Promise<ToolCallResponse> {
  return executeMcpToolCall(harness.mcpService, {
    name,
    input,
    ctx: { threadId, signal: new AbortController().signal },
  });
}

export function responseText(response: ToolCallResponse): string {
  const item = response.contentItems[0];
  if (item?.type !== "inputText")
    throw new Error("expected a text tool response");
  return item.text;
}

export function responseJson(response: ToolCallResponse): unknown {
  return JSON.parse(responseText(response));
}

export async function waitFor(
  check: () => boolean,
  timeoutMs = 3_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
