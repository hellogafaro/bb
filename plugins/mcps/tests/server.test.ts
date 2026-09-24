import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost, makePluginAgentConfigurationContext } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { McpGateway } from "../src/gateway";

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("mcps plugin surface", () => {
  it("lists an empty registry over CLI and registers lazy agent tools", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-"));
    temps.push(dataDir);
    const { bb, harness } = createFakePluginHost({
      pluginId: "mcps",
      sdk: {
        system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) },
      },
    });
    await plugin(bb);
    const listed = await harness.behavior.runCli(["list"]);
    expect(listed.exitCode).toBe(0);
    expect(listed.stdout).toContain("No MCP servers");
    const servers = await harness.behavior.callAgentTool("mcp_servers", {});
    const payload = typeof servers === "string" ? servers : JSON.stringify(servers);
    expect(payload).toContain("[]");
    const added = await harness.behavior.runCli([
      "add", "cloud", "https://mcp.example/mcp",
      "--header", "Authorization: Bearer tok",
    ]);
    expect(added.exitCode).toBe(0);
    const after = await harness.behavior.runCli(["list", "--json"]);
    expect(after.stdout).toContain("streamable-http");
    expect(after.stdout).not.toContain("headers");
    expect(after.stdout).not.toContain("sourceKind");
    const details = await harness.behavior.runCli(["show", "cloud", "--json"]);
    expect(details.stdout).toContain("***");
    expect(details.stdout).toContain("headers");
    const row = JSON.parse(after.stdout!)[0];
    expect(row.id).toMatch(/^mcp_[a-z0-9]{10}$/);
    expect(row.handle).toBe("cloud");
    expect((await harness.behavior.runCli(["show", row.id])).exitCode).toBe(0);
    const alias = await harness.behavior.runCli(["add-http", "legacy", "https://mcp.example/other"]);
    expect(alias.exitCode).toBe(0);
    const help = await harness.behavior.runCli(["--help"]);
    expect(help.stdout).toContain("bb mcp add <name> <url>");
    expect(help.stdout).toContain("bb mcp registry <query>");
    expect(help.stdout).toContain("bb mcp tools <query>");
    expect(help.stdout).toContain("bb mcp show <id>");
    expect(help.stdout).toContain("bb mcp remove <id>");
    expect(help.stdout).not.toContain("add-http");
    expect(help.stdout).not.toContain("bb mcp approve ");
    expect(help.stdout).not.toContain("bb mcp rm ");
    expect(help.stdout).not.toContain("bb mcp find ");
    const shown = await harness.behavior.runCli(["show", "cloud"]);
    expect(shown.exitCode).toBe(0);
    expect(shown.stdout).toContain("handle: cloud");
    const removed = await harness.behavior.runCli(["remove", "legacy"]);
    expect(removed.exitCode).toBe(0);
    await harness.lifecycle.dispose();
  });
});

it('preserves both concurrent installs with the same name', async () => {
  const dataDir = await mkdtemp(join(tmpdir(), 'bb-mcps-')); temps.push(dataDir);
  const {bb, harness} = createFakePluginHost({pluginId: 'mcps', sdk: {system: {config: async () => ({dataDir, primaryHostId: 'host_1'})}}});
  await plugin(bb);
  try {
    const results = await Promise.all(Array.from({length: 2}, () => harness.behavior.runCli(['add', 'same', '--', 'echo'])));
    expect(results.map((result) => result.exitCode)).toEqual([0, 0]);
    expect(results[0]).not.toEqual(results[1]);
    const snapshot = await harness.behavior.callRpc('snapshot', null) as {servers: unknown[]};
    expect(snapshot.servers).toHaveLength(2);
  } finally { await harness.lifecycle.dispose(); }
});


it("exposes descriptive IDs and accepts legacy IDs from existing sessions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-")); temps.push(dataDir);
  const { bb, harness } = createFakePluginHost({ pluginId: "mcps", sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } } });
  const tool = { opaqueId: "fixture-id", pluginId: "fixture", pluginName: "Fixture", serverId: "mcp", serverType: "stdio", name: "echo", description: "Echo", inputSchema: { type: "object" }, annotations: { readOnlyHint: true }, status: "ready" as const };
  vi.spyOn(McpGateway.prototype, "searchTools").mockResolvedValue({ tools: [{ opaqueId: tool.opaqueId, serverId: "mcp", serverName: "Fixture", name: "echo", description: "Echo", risk: "read", enabled: true }], unavailable: [] });
  vi.spyOn(McpGateway.prototype, "getTool").mockResolvedValue(tool);
  const call = vi.spyOn(McpGateway.prototype, "call").mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
  vi.spyOn(McpGateway.prototype, "listPrompts").mockResolvedValue([tool]);
  vi.spyOn(McpGateway.prototype, "listResources").mockResolvedValue([{ ...tool, uri: "fixture://data" }]);
  vi.spyOn(McpGateway.prototype, "listResourceTemplates").mockResolvedValue([]);
  const prompt = vi.spyOn(McpGateway.prototype, "getPrompt").mockResolvedValue({ messages: [] });
  const resource = vi.spyOn(McpGateway.prototype, "readResource").mockResolvedValue({ contents: [] });
  await plugin(bb);
  try {
    for (const [name, input, field] of [
      ["mcp_search", { query: "echo" }, "id"],
      ["mcp_prompts", {}, "id"],
      ["mcp_resources", {}, "id"],
    ] as const) {
      const result = JSON.stringify(await harness.behavior.callAgentTool(name, input));
      expect(result).toContain(field);
      expect(result).not.toContain("opaqueId");
    }
    for (const input of [{ id: tool.opaqueId }, { toolId: tool.opaqueId }, { opaqueId: tool.opaqueId }]) {
      const result = JSON.stringify(await harness.behavior.callAgentTool("mcp_schema", input));
      expect(result).toContain("id");
      expect(result).not.toContain("opaqueId");
      await harness.behavior.callAgentTool("mcp_call", input);
    }
    expect(call).toHaveBeenCalledTimes(3);
    expect(call.mock.calls.every(args => args[0] === tool.opaqueId)).toBe(true);
    for (const input of [{ id: tool.opaqueId }, { promptId: tool.opaqueId }, { opaqueId: tool.opaqueId }]) await harness.behavior.callAgentTool("mcp_get_prompt", input);
    for (const input of [{ id: tool.opaqueId }, { resourceId: tool.opaqueId }, { opaqueId: tool.opaqueId }]) await harness.behavior.callAgentTool("mcp_read_resource", input);
    expect(prompt).toHaveBeenCalledTimes(3);
    expect(resource).toHaveBeenCalledTimes(3);
    await expect(harness.behavior.callAgentTool("mcp_call", {})).rejects.toThrow("id is required");
    const cli = await harness.behavior.runCli(["tools", "echo", "--json"]);
    expect(cli.stdout).toContain("id");
    expect(cli.stdout).not.toContain("opaqueId");
  } finally { await harness.lifecycle.dispose(); vi.restoreAllMocks(); }
});

it("paginates lean discovery, distinguishes unknown counts, and keeps diagnostics opt-in", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-")); temps.push(dataDir);
  const { bb, harness } = createFakePluginHost({ pluginId: "mcps", sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } } });
  await plugin(bb);
  const unpack = (result: unknown) => JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
  try {
    for (let i = 0; i < 23; i++) await harness.behavior.runCli(["add", `server${String(i).padStart(2, "0")}`, "--", "echo"]);
    const first = unpack(await harness.behavior.callAgentTool("mcp_servers", {}));
    expect(first.servers).toHaveLength(20); expect(first.nextCursor).toBe(20);
    expect(Object.keys(first.servers[0]).sort()).toEqual(["handle", "id", "status", "type"]);
    const second = unpack(await harness.behavior.callAgentTool("mcp_servers", { cursor: first.nextCursor }));
    expect(second.servers).toHaveLength(3); expect(second.nextCursor).toBeUndefined();
    expect(new Set([...first.servers, ...second.servers].map(row => row.id)).size).toBe(23);
    const id = first.servers[0].id;
    const details = unpack(await harness.behavior.callAgentTool("mcp_servers", { query: id, details: true }));
    expect(details.servers).toHaveLength(1); expect(details.servers[0].sourceKind).toBe("manual");
    const snapshot = await harness.behavior.callRpc("snapshot", null) as { servers: Array<{ id: string; handle: string }> };
    expect(snapshot.servers.find(row => row.id === id)?.handle).toBe("server00");
    const compact = vi.spyOn(McpGateway.prototype, "compactServers").mockResolvedValue([{ id: "server00", serverId: "mcp", name: "server00", description: null, type: "stdio", status: "ready", sourceKind: "manual", toolCount: 0, promptCount: 0, resourceCount: 0 }]);
    expect(unpack(await harness.behavior.callAgentTool("mcp_servers", {})).servers[0].tools).toBe(0);
    compact.mockRestore();
  } finally { await harness.lifecycle.dispose(); vi.restoreAllMocks(); }
});

it("uses one input map and preserves full schemas on demand", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-")); temps.push(dataDir);
  const { bb, harness } = createFakePluginHost({ pluginId: "mcps", sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } } });
  const schema = { type: "object", properties: { query: { type: "string", minLength: 1 }, limit: { type: "integer", minimum: 1 } }, required: ["query"] };
  const { compactToolFromCatalog } = await import("../src/catalog.js");
  const tool = { opaqueId: "mcpt_test123abc", pluginId: "fixture", pluginName: "Fixture", serverId: "mcp", serverType: "stdio", name: "search", description: "Find things", inputSchema: schema, status: "ready" as const, annotations: { readOnlyHint: true } };
  vi.spyOn(McpGateway.prototype, "searchTools").mockResolvedValue({ tools: [compactToolFromCatalog(tool, { card: true })], unavailable: [] });
  vi.spyOn(McpGateway.prototype, "getTool").mockResolvedValue(tool);
  await plugin(bb);
  const unpack = (result: unknown) => JSON.parse((result as { content: Array<{ text: string }> }).content[0]!.text);
  try {
    const result = unpack(await harness.behavior.callAgentTool("mcp_search", { query: "search" }));
    expect(result.tools[0]).toEqual({ id: tool.opaqueId, server: "Fixture", name: "search", description: "Find things", input: { query: "string (minLength=1)", "limit?": "integer (minimum=1)" } });
    expect(result.unavailable).toBeUndefined();
    await expect(harness.behavior.callAgentTool("mcp_search", { query: "search", limit: 50 })).resolves.toBeDefined();
    expect(McpGateway.prototype.searchTools).toHaveBeenLastCalledWith("search", 12, undefined);
    const full = unpack(await harness.behavior.callAgentTool("mcp_schema", { id: tool.opaqueId }));
    expect(full.inputSchema).toEqual(schema);
    expect(full.card).toBeUndefined();
  } finally { await harness.lifecycle.dispose(); vi.restoreAllMocks(); }
});

const instructionsBlock = (...lines: string[]) => ["<connected_mcps>", ...lines, "</connected_mcps>", "Use mcp_search to find tools on connected MCPs, then mcp_call."].join("\n");

it("round-trips a server guide through RPC and CLI and renders it in agent instructions", async () => {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-")); temps.push(dataDir);
  const { bb, harness } = createFakePluginHost({ pluginId: "mcps", sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } } });
  await plugin(bb);
  const configure = (pluginMetadata = {}) => harness.behavior.resolveAgentConfiguration(makePluginAgentConfigurationContext({ pluginMetadata }));
  try {
    expect((await configure()).instructions).toBeNull();
    expect((await harness.behavior.runCli(["add", "docs", "--", "echo"])).exitCode).toBe(0);
    expect((await harness.behavior.runCli(["add", "files", "--", "echo"])).exitCode).toBe(0);
    expect((await configure()).instructions).toBe(instructionsBlock('  <mcp handle="docs" />', '  <mcp handle="files" />'));
    expect((await harness.behavior.runCli(["guide", "docs"])).stdout).toBe("No guide for docs.\n");

    const set = await harness.behavior.callRpc("setGuide", { id: "docs", guide: "  Search the Engineering space first.  " }) as { id: string; handle: string; guide: string | null };
    expect(set).toEqual({ id: expect.stringMatching(/^mcp_/), handle: "docs", guide: "Search the Engineering space first." });
    expect(JSON.parse((await harness.behavior.runCli(["guide", set.id, "--json"])).stdout!)).toEqual(set);
    const snapshot = await harness.behavior.callRpc("snapshot", null) as { servers: Array<{ handle: string; guide: string | null }> };
    expect(snapshot.servers.find((row) => row.handle === "docs")?.guide).toBe("Search the Engineering space first.");

    expect((await harness.behavior.runCli(["guide", "files", "Only", "read", "exports."])).stdout).toBe("Updated guide for files\n");
    expect((await harness.behavior.runCli(["show", "files"])).stdout).toContain("guide: Only read exports.");
    expect((await configure()).instructions).toBe(instructionsBlock(
      '  <mcp handle="docs">',
      "    Search the Engineering space first.",
      "  </mcp>",
      '  <mcp handle="files">',
      "    Only read exports.",
      "  </mcp>",
    ));
    expect((await configure({ servers: [set.id] })).instructions).toBe(instructionsBlock('  <mcp handle="docs">', "    Search the Engineering space first.", "  </mcp>"));

    expect((await harness.behavior.runCli(["guide", "docs", "text", "--clear"])).exitCode).toBe(2);
    expect((await harness.behavior.runCli(["guide", "docs", "--clear"])).stdout).toBe("Cleared guide for docs\n");
    expect((await harness.behavior.runCli(["guide", "missing", "x"])).exitCode).toBe(1);
    expect((await harness.behavior.runCli(["disable", "files"])).exitCode).toBe(0);
    expect((await configure()).instructions).toBe(instructionsBlock('  <mcp handle="docs" />'));
    expect((await harness.behavior.runCli(["--help"])).stdout).toContain("bb mcp guide <id> [text] [--clear]");
  } finally { await harness.lifecycle.dispose(); }
});
