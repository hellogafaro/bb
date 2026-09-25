import { insertThreadPluginMetadata } from "@bb/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactToolFromCatalog } from "../../../src/services/mcp/catalog.js";
import { McpGateway } from "../../../src/services/mcp/gateway.js";
import { resolveThreadRuntimeCommandConfig } from "../../../src/services/threads/thread-runtime-config.js";
import {
  MCP_TOOL_NAMES,
  mcpDynamicToolContributions,
} from "../../../src/services/threads/mcp-tools.js";
import { RESERVED_AGENT_TOOL_NAMES } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { callAgentTool, responseJson } from "./harness.js";

afterEach(() => {
  vi.restoreAllMocks();
});

const instructionsBlock = (...lines: string[]) =>
  [
    "<connected_mcps>",
    ...lines,
    "</connected_mcps>",
    "Use mcp_search to find tools on connected MCPs, then mcp_call.",
  ].join("\n");

async function addStdio(harness: TestAppHarness, name: string) {
  return harness.mcpService.admin.add({
    kind: "stdio",
    name,
    command: "echo",
    args: [],
  });
}

function seedRuntimeThread(harness: TestAppHarness) {
  const hostId = "host-mcp-runtime";
  seedHostSession(harness.deps, { id: hostId });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId,
    path: "/tmp/mcp-runtime-root",
  });
  const environment = seedEnvironment(harness.deps, {
    hostId,
    projectId: project.id,
    path: "/tmp/mcp-runtime-root",
    environmentProviderId: "project-checkout",
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
  });
  const resolveConfig = () =>
    resolveThreadRuntimeCommandConfig(harness.deps, {
      thread,
      model: "test-model",
      environment: {
        hostId,
        id: environment.id,
        path: environment.path,
        status: environment.status,
      },
    });
  return { thread, resolveConfig };
}

describe("MCP agent tools", () => {
  it("reserves every MCP tool name and exposes JSON input schemas", () => {
    for (const name of MCP_TOOL_NAMES)
      expect(RESERVED_AGENT_TOOL_NAMES).toContain(name);
    const contributions = mcpDynamicToolContributions();
    expect(contributions.map((item) => item.tool.name)).toEqual([
      ...MCP_TOOL_NAMES,
    ]);
    const search = contributions.find(
      (item) => item.tool.name === "mcp_search",
    );
    expect(search?.tool.inputSchema).toMatchObject({
      type: "object",
      required: ["query"],
      additionalProperties: false,
    });
    expect(search?.instructions).toContain("Do not list servers first.");
    expect(
      contributions.find((item) => item.tool.name === "mcp_prompts")
        ?.instructions,
    ).toBeNull();
  });

  it("lists an empty registry, then paginates lean discovery with opt-in details", async () => {
    await withTestHarness(async (harness) => {
      expect(
        responseJson(
          await callAgentTool(harness, "mcp_servers", {}, "thr_none"),
        ),
      ).toEqual({ servers: [] });
      for (let i = 0; i < 23; i++)
        await addStdio(harness, `server${String(i).padStart(2, "0")}`);
      const first = responseJson(
        await callAgentTool(harness, "mcp_servers", {}, "thr_none"),
      ) as { servers: Array<Record<string, unknown>>; nextCursor?: number };
      expect(first.servers).toHaveLength(20);
      expect(first.nextCursor).toBe(20);
      expect(Object.keys(first.servers[0] ?? {}).sort()).toEqual([
        "handle",
        "id",
        "status",
        "type",
      ]);
      const second = responseJson(
        await callAgentTool(harness, "mcp_servers", { cursor: 20 }, "thr_none"),
      ) as { servers: unknown[]; nextCursor?: number };
      expect(second.servers).toHaveLength(3);
      expect(second.nextCursor).toBeUndefined();
      const id = String(first.servers[0]?.id);
      const details = responseJson(
        await callAgentTool(
          harness,
          "mcp_servers",
          { query: id, details: true },
          "thr_none",
        ),
      ) as { servers: Array<Record<string, unknown>> };
      expect(details.servers).toHaveLength(1);
      expect(details.servers[0]?.sourceKind).toBe("manual");
    });
  });

  it("preserves both concurrent installs with the same name", async () => {
    await withTestHarness(async (harness) => {
      const results = await Promise.all([
        addStdio(harness, "same"),
        addStdio(harness, "same"),
      ]);
      expect(new Set(results.map((item) => item.handle)).size).toBe(2);
      expect(harness.mcpService.admin.summaries()).toHaveLength(2);
    });
  });

  it("takes a strict id on every agent tool and rejects other id fields", async () => {
    await withTestHarness(async (harness) => {
      const tool = {
        id: "mcpt_0123456789",
        sourceId: "mcp_fixture000",
        handle: "fixture",
        name: "echo",
        description: "Echo",
        inputSchema: { type: "object" },
        annotations: { readOnlyHint: true },
      };
      vi.spyOn(McpGateway.prototype, "searchTools").mockResolvedValue({
        tools: [compactToolFromCatalog(tool)],
        unavailable: [],
      });
      vi.spyOn(McpGateway.prototype, "getTool").mockResolvedValue(tool);
      const call = vi
        .spyOn(McpGateway.prototype, "call")
        .mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
      vi.spyOn(McpGateway.prototype, "listPrompts").mockResolvedValue([
        {
          id: "mcpp_0123456789",
          sourceId: tool.sourceId,
          handle: tool.handle,
          name: "echo",
        },
      ]);
      vi.spyOn(McpGateway.prototype, "listResources").mockResolvedValue([
        {
          id: "mcpr_0123456789",
          sourceId: tool.sourceId,
          handle: tool.handle,
          name: "echo",
          uri: "fixture://data",
        },
      ]);
      vi.spyOn(McpGateway.prototype, "listResourceTemplates").mockResolvedValue(
        [],
      );
      const prompt = vi
        .spyOn(McpGateway.prototype, "getPrompt")
        .mockResolvedValue({ messages: [] });
      const resource = vi
        .spyOn(McpGateway.prototype, "readResource")
        .mockResolvedValue({ contents: [] });
      for (const [name, input] of [
        ["mcp_search", { query: "echo" }],
        ["mcp_prompts", {}],
        ["mcp_resources", {}],
      ] as const) {
        const result = responseJson(
          await callAgentTool(harness, name, input, "thr_x"),
        );
        expect(Object.values(result as Record<string, unknown>)[0]).toEqual([
          expect.objectContaining({
            id: expect.stringMatching(/^mcp[tpr]_/),
            server: "fixture",
          }),
        ]);
      }
      expect(
        JSON.stringify(
          await callAgentTool(harness, "mcp_schema", { id: tool.id }, "thr_x"),
        ),
      ).toContain(tool.id);
      await callAgentTool(harness, "mcp_call", { id: tool.id }, "thr_x");
      await callAgentTool(
        harness,
        "mcp_get_prompt",
        { id: "mcpp_0123456789" },
        "thr_x",
      );
      await callAgentTool(
        harness,
        "mcp_read_resource",
        { id: "mcpr_0123456789" },
        "thr_x",
      );
      expect(call).toHaveBeenCalledWith(tool.id, {}, expect.anything());
      expect(prompt).toHaveBeenCalledTimes(1);
      expect(resource).toHaveBeenCalledTimes(1);
      for (const [name, field] of [
        ["mcp_call", "toolId"],
        ["mcp_schema", "opaqueId"],
        ["mcp_get_prompt", "promptId"],
        ["mcp_read_resource", "resourceId"],
      ] as const) {
        const rejected = await callAgentTool(
          harness,
          name,
          { [field]: tool.id },
          "thr_x",
        );
        expect(rejected.success).toBe(false);
      }
      expect(call).toHaveBeenCalledTimes(1);
    });
  });

  it("rejects unknown ids through mcp_call with a clear error", async () => {
    await withTestHarness(async (harness) => {
      await expect(
        callAgentTool(
          harness,
          "mcp_call",
          { id: "notion__mcp__search_0123456789" },
          "thr_x",
        ),
      ).rejects.toThrow(
        "Invalid MCP tool id: notion__mcp__search_0123456789. Use an id returned by mcp_search.",
      );
    });
  });

  it("uses one input map and preserves full schemas on demand", async () => {
    await withTestHarness(async (harness) => {
      const schema = {
        type: "object",
        properties: {
          query: { type: "string", minLength: 1 },
          limit: { type: "integer", minimum: 1 },
        },
        required: ["query"],
      };
      const tool = {
        id: "mcpt_test123abc",
        sourceId: "mcp_fixture000",
        handle: "fixture",
        name: "search",
        description: "Find things",
        inputSchema: schema,
        annotations: { readOnlyHint: true },
      };
      const search = vi
        .spyOn(McpGateway.prototype, "searchTools")
        .mockResolvedValue({
          tools: [compactToolFromCatalog(tool, { card: true })],
          unavailable: [],
        });
      vi.spyOn(McpGateway.prototype, "getTool").mockResolvedValue(tool);
      const result = responseJson(
        await callAgentTool(
          harness,
          "mcp_search",
          { query: "search" },
          "thr_x",
        ),
      ) as { tools: unknown[]; unavailable?: unknown };
      expect(result.tools[0]).toEqual({
        id: tool.id,
        server: "fixture",
        name: "search",
        description: "Find things",
        input: {
          query: "string (minLength=1)",
          "limit?": "integer (minimum=1)",
        },
      });
      expect(result.unavailable).toBeUndefined();
      await callAgentTool(
        harness,
        "mcp_search",
        { query: "search", limit: 50 },
        "thr_x",
      );
      expect(search).toHaveBeenLastCalledWith("search", 12, undefined);
      const full = responseJson(
        await callAgentTool(harness, "mcp_schema", { id: tool.id }, "thr_x"),
      ) as Record<string, unknown>;
      expect(full.inputSchema).toEqual(schema);
      expect(full.card).toBeUndefined();
    });
  });
});

describe("MCP thread runtime configuration", () => {
  it("adds MCP tools and connected-MCP instructions only when servers are enabled, honoring thread metadata", async () => {
    await withTestHarness(async (harness) => {
      const { thread, resolveConfig } = seedRuntimeThread(harness);
      const empty = await resolveConfig();
      expect(empty.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
      ]);
      expect(empty.instructions).not.toContain("<connected_mcps>");

      const docs = await addStdio(harness, "docs");
      await addStdio(harness, "files");
      harness.mcpService.admin.setGuide(
        "docs",
        "  Search the Engineering space first.  ",
      );
      const configured = await resolveConfig();
      expect(configured.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
        ...MCP_TOOL_NAMES,
      ]);
      expect(configured.instructions).toContain(
        instructionsBlock(
          '  <mcp handle="docs">',
          "    Search the Engineering space first.",
          "  </mcp>",
          '  <mcp handle="files" />',
        ),
      );
      expect(configured.instructions).toContain(
        "Use id from mcp_search. Report the result to the user",
      );

      insertThreadPluginMetadata(harness.deps.db, {
        threadId: thread.id,
        pluginId: "mcp",
        metadata: { servers: [docs.id] },
      });
      const filtered = await resolveConfig();
      expect(filtered.instructions).toContain(
        instructionsBlock(
          '  <mcp handle="docs">',
          "    Search the Engineering space first.",
          "  </mcp>",
        ),
      );
      expect(filtered.instructions).not.toContain('<mcp handle="files" />');

      await harness.mcpService.admin.setEnabled("docs", false);
      await harness.mcpService.admin.setEnabled("files", false);
      const disabled = await resolveConfig();
      expect(disabled.dynamicTools.map((tool) => tool.name)).toEqual([
        "update_environment_directory",
      ]);
      expect(disabled.instructions).not.toContain("<connected_mcps>");
    });
  });
});
