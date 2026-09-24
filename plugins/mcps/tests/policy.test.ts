import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { McpGateway, type McpStdioHost } from "../src/gateway.js";
import { effectivePolicy } from "../src/policy.js";
import { McpsStore } from "../src/store.js";

const catalog = {
  tools: [
    { name: "read_notes", description: "Read notes", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } },
    { name: "write_note", description: "Write a note", inputSchema: { type: "object" } },
    { name: "drop_notes", description: "Drop every note", inputSchema: { type: "object" }, annotations: { destructiveHint: true } },
  ],
  prompts: [],
  resources: [],
  resourceTemplates: [],
};

const cleanStatus = {
  claude: { settingsPath: "/home/u/.claude/settings.json", connectorsDisabled: true, mcpServers: [] },
  codex: { configPath: "/home/u/.codex/config.toml", mcpServers: [] },
};

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function memoryStore() {
  const db = new Database(":memory:");
  const store = new McpsStore(db, (target, statements) => statements.forEach((statement) => target.exec(statement)));
  return { db, store };
}

function addSource(store: McpsStore, id: string, enabled = 1) {
  store.upsertSource({ id, name: id, description: null, sourceKind: "manual", sourceRef: null, registryName: null, registryVersion: null, pluginRoot: "/tmp", pluginData: "/tmp", createdAt: 0, updatedAt: 0 });
  store.upsertMcpServer({ pluginId: id, serverId: "mcp", type: "stdio", configJson: JSON.stringify({ type: "stdio", command: "node", args: [], cwd: "/tmp" }), status: "idle", lastError: null, approved: 1, enabled });
}

function fakeStdioHost(started: string[]): McpStdioHost {
  return {
    async start(config) { started.push(config.key); return structuredClone(catalog) as never; },
    async refresh() { return structuredClone(catalog) as never; },
    async close() {},
    async callTool() { return { content: [] }; },
    async getPrompt() { return {}; },
    async readResource() { return {}; },
    async complete() { return {}; },
    async subscribeResource() {},
    async unsubscribeResource() {},
    async setLoggingLevel() {},
  };
}

const silent = { info() {}, warn() {}, error() {} };

describe("tool policies", () => {
  it("resolves inherit from risk and keeps explicit modes", () => {
    expect(effectivePolicy("inherit", "read")).toBe("allow");
    expect(effectivePolicy("inherit", "write")).toBe("confirm");
    expect(effectivePolicy("inherit", "destructive")).toBe("confirm");
    expect(effectivePolicy("deny", "read")).toBe("deny");
    expect(effectivePolicy("allow", "destructive")).toBe("allow");
    expect(effectivePolicy("confirm", "read")).toBe("confirm");
  });

  it("seeds risk from annotations on catalog load and keeps a chosen mode when the risk changes", async () => {
    const { db, store } = memoryStore();
    addSource(store, "notes");
    const gateway = new McpGateway(store, silent, { stdioHost: fakeStdioHost([]) });
    try {
      await gateway.inspectServer("notes");
      expect(store.listToolPolicies("notes", "mcp")).toEqual([
        { toolName: "drop_notes", risk: "destructive", mode: "inherit" },
        { toolName: "read_notes", risk: "read", mode: "inherit" },
        { toolName: "write_note", risk: "write", mode: "inherit" },
      ]);
      store.setToolPolicyMode("notes", "mcp", "write_note", "deny");
      store.seedToolPolicies("notes", "mcp", [{ name: "write_note", risk: "destructive" }]);
      expect(store.getToolPolicy("notes", "mcp", "write_note")).toEqual({ toolName: "write_note", risk: "destructive", mode: "deny" });
      store.deleteSource("notes");
      expect(store.listToolPolicies("notes", "mcp")).toEqual([]);
    } finally { await gateway.close(); db.close(); }
  });

  it("warms catalogs only for enabled servers and skips ones already cached", async () => {
    const { db, store } = memoryStore();
    addSource(store, "on");
    addSource(store, "off", 0);
    const started: string[] = [];
    const gateway = new McpGateway(store, silent, { stdioHost: fakeStdioHost(started) });
    try {
      await gateway.warm();
      expect(started).toEqual(["on:mcp"]);
      expect((await gateway.compactServers()).find((row) => row.id === "on")?.toolCount).toBe(3);
      await gateway.warm();
      expect(started).toEqual(["on:mcp"]);
    } finally { await gateway.close(); db.close(); }
  });
});

async function pluginFixture() {
  const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-policy-"));
  temps.push(dataDir);
  const ran: string[] = [];
  const { bb, harness } = createFakePluginHost({
    pluginId: "mcps",
    sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) } },
    experimental_callHostRpc: async (call) => {
      const input = call.input as { name?: string };
      if (call.method === "start" || call.method === "refresh") return structuredClone(catalog);
      if (call.method === "close") return { closed: true };
      if (call.method === "callTool") { ran.push(input.name ?? ""); return { content: [{ type: "text", text: `ran ${input.name}` }] }; }
      if (call.method === "providerMcpStatus") return cleanStatus;
      throw new Error(`unexpected host call ${call.method}`);
    },
  });
  await plugin(bb);
  expect((await harness.behavior.runCli(["add", "notes", "--", "node", "server.js"])).exitCode).toBe(0);
  const search = async (query: string) => {
    const result = await harness.behavior.runCli(["tools", query, "--json"]);
    return (JSON.parse(result.stdout!) as { tools: Array<{ id: string; name: string; risk?: string; policy?: string }> }).tools;
  };
  const idOf = async (name: string) => (await search(name)).find((row) => row.name === name)!.id;
  const call = (id: string, threadId = "thr_1") => harness.behavior.callAgentTool("mcp_call", { id, args: { text: "hi" } }, { threadId }) as Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
  return { harness, ran, search, idOf, call };
}

describe("policy enforcement in mcp_call", () => {
  it("runs allowed tools, blocks denied tools, and waits for approval on confirm", async () => {
    const { harness, ran, search, idOf, call } = await pluginFixture();
    try {
      const rows = await search("notes");
      expect(rows.find((row) => row.name === "read_notes")).not.toHaveProperty("policy");
      expect(rows.find((row) => row.name === "drop_notes")).toMatchObject({ risk: "destructive", policy: "confirm" });

      expect((await call(await idOf("read_notes"))).content[0]!.text).toBe("ran read_notes");

      const writeId = await idOf("write_note");
      const pending = call(writeId);
      await vi.waitFor(() => expect(harness.inspection.pendingInteractions).toHaveLength(1));
      const interaction = harness.inspection.pendingInteractions[0]!;
      expect(interaction).toMatchObject({ threadId: "thr_1", rendererId: "mcp-approval", payload: { kind: "tool", server: "notes", tool: "write_note", risk: "write", truncated: false } });
      expect(ran).toEqual(["read_notes"]);
      harness.behavior.submitInteraction(interaction.id, { approved: true });
      expect((await pending).content[0]!.text).toBe("ran write_note");

      const denied = call(writeId);
      await vi.waitFor(() => expect(harness.inspection.pendingInteractions).toHaveLength(1));
      harness.behavior.submitInteraction(harness.inspection.pendingInteractions[0]!.id, { approved: false });
      const refused = await denied;
      expect(refused.isError).toBe(true);
      expect(refused.content[0]!.text).toContain("denied");

      expect((await harness.behavior.runCli(["policy", "notes", "drop_notes", "deny"])).exitCode).toBe(0);
      const blocked = await call(await idOf("drop_notes"));
      expect(blocked.isError).toBe(true);
      expect(blocked.content[0]!.text).toContain("blocked by the user's MCP policy");
      expect(harness.inspection.pendingInteractions).toHaveLength(0);
      expect(ran).toEqual(["read_notes", "write_note"]);

      const cli = await harness.behavior.runCli(["call", writeId, "{}", "--json"]);
      expect(JSON.parse(cli.stdout!)).toMatchObject({ isError: true });
      expect(cli.stdout).toContain("can only run from a BB thread");
      expect(ran).toEqual(["read_notes", "write_note"]);
    } finally { await harness.lifecycle.dispose(); }
  });

  it("round-trips policies through the CLI and RPC", async () => {
    const { harness, search } = await pluginFixture();
    try {
      const listed = await harness.behavior.runCli(["policy", "notes"]);
      expect(listed.exitCode).toBe(0);
      expect(listed.stdout).toMatch(/drop_notes\s+destructive\s+confirm \(default\)/);
      expect(listed.stdout).toMatch(/read_notes\s+read\s+allow \(default\)/);

      const set = await harness.behavior.runCli(["policy", "notes", "write_note", "allow", "--json"]);
      expect(JSON.parse(set.stdout!)).toEqual({ tool: "write_note", risk: "write", mode: "allow", policy: "allow" });
      expect((await search("write")).find((row) => row.name === "write_note")).not.toHaveProperty("policy");

      const one = await harness.behavior.runCli(["policy", "notes", "write_note", "--json"]);
      expect(JSON.parse(one.stdout!)).toMatchObject({ mode: "allow" });

      await harness.behavior.callRpc("setToolPolicy", { id: "notes", tool: "read_notes", mode: "deny" });
      const rpc = await harness.behavior.callRpc("listToolPolicies", { id: "notes" }) as { tools: Array<{ tool: string; policy: string }> };
      expect(rpc.tools.map((row) => [row.tool, row.policy])).toEqual([["drop_notes", "confirm"], ["read_notes", "deny"], ["write_note", "allow"]]);

      expect((await harness.behavior.runCli(["policy", "notes", "write_note", "sometimes"])).exitCode).toBe(2);
      expect((await harness.behavior.runCli(["policy", "notes", "missing_tool", "allow"])).exitCode).toBe(1);
      expect((await harness.behavior.runCli(["policy", "notes", "write_note", "inherit"])).stdout).toContain("confirm (default)");
    } finally { await harness.lifecycle.dispose(); }
  });

  it("warms a newly added server in the background", async () => {
    const { harness } = await pluginFixture();
    try {
      await vi.waitFor(() => expect(harness.inspection.experimental_hostRpcCalls.some((call) => call.method === "start")).toBe(true), { timeout: 3_000 });
      const listed = await harness.behavior.runCli(["list", "--json"]);
      expect(JSON.parse(listed.stdout!)[0]).toMatchObject({ handle: "notes", tools: 3 });
    } finally { await harness.lifecycle.dispose(); }
  });
});
