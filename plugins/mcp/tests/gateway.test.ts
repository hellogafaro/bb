import { afterEach, describe, expect, it, vi } from "vitest";
import { isMcpRequest, redirectGuardFetch, McpGateway, type McpGatewayOptions, type McpStdioHost } from "../src/gateway.js";
import type { McpStore } from "../src/store.js";
import type { Tool } from "@modelcontextprotocol/client";
import { addSource, memoryStore, serverDirs, silent, stdioHost } from "./helpers.js";

function hostWithTools(tools: Tool[], onCall: () => void = () => {}): McpStdioHost {
  return stdioHost(() => ({ tools, prompts: [], resources: [], resourceTemplates: [] }), onCall);
}

function seed(store: McpStore, name = "Fixture") {
  return addSource(store, { name, description: "test server", sourceRef: "echo" }).id;
}

const echoTool = { name: "echo", description: "Echo a message", inputSchema: { type: "object" } } as Tool;
const writeTool = { name: "write_file", description: "Write a file", inputSchema: { type: "object" }, annotations: { destructiveHint: true } } as Tool;
const queryTool = {
  name: "query_data_sources",
  description: "Run a structured lookup",
  inputSchema: {
    type: "object",
    properties: {
      data: {
        type: "object",
        properties: {
          query: { type: "string" },
          data_source_urls: { type: "array", items: { type: "string" } },
        },
        required: ["query", "data_source_urls"],
      },
    },
    required: ["data"],
  },
} as Tool;

describe("lazy MCP gateway", () => {
  const gateways: McpGateway[] = [];
  afterEach(async () => {
    await Promise.all(gateways.splice(0).map((gateway) => gateway.close()));
  });
  const open = (store: McpStore, options: Omit<McpGatewayOptions, "serverDirs">) => {
    const gateway = new McpGateway(store, silent, { serverDirs, ...options });
    gateways.push(gateway);
    return gateway;
  };

  it("reports a failed TTL refresh instead of silently returning stale tools", async () => {
    const store = memoryStore(); const id = seed(store);
    const host = hostWithTools([echoTool]);
    const gateway = open(store, { stdioHost: host });
    await gateway.inspectServer(id);
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
    host.refresh = async () => { throw new Error("authorization expired"); };
    try {
      const result = await gateway.inspectServer(id);
      expect(result.error).toContain("authorization expired");
      expect(result.tools).toEqual([]);
      vi.mocked(Date.now).mockReturnValue(Date.now() + 5001);
      const retry = await gateway.inspectServer(id);
      expect(retry.error).toContain("authorization expired");
      expect(retry.tools).toEqual([]);
    } finally { vi.restoreAllMocks(); }
  });

  it("deduplicates concurrent connections and backs off failed servers", async () => {
    const store = memoryStore(); const id = seed(store);
    const host = hostWithTools([echoTool]);
    const start = vi.spyOn(host, "start");
    const gateway = open(store, { stdioHost: host });
    await Promise.all(Array.from({length: 30}, () => gateway.inspectServer(id)));
    expect(start).toHaveBeenCalledTimes(1);
    await gateway.closeServer(id);
    start.mockRejectedValue(new Error("offline"));
    await Promise.all(Array.from({length: 30}, () => gateway.inspectServer(id)));
    await gateway.inspectServer(id);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("keeps duplicate tool names on different servers distinct", async () => {
    const store = memoryStore();
    for (let i = 0; i < 140; i++) seed(store, `server${i}`);
    const gateway = open(store, { stdioHost: hostWithTools([echoTool]), searchWaitMs: 2000 });
    const result = await gateway.searchTools("echo", 12);
    expect(result.unavailable).toEqual([]);
    expect(new Set(result.tools.map(t => t.id)).size).toBe(12);
    expect(new Set(result.tools.map(t => t.sourceId)).size).toBe(12);
    expect((await gateway.getTool(result.tools[0]!.id)).name).toBe("echo");
  });

  it("searches 25000 tools across 50 servers", async () => {
    const store = memoryStore();
    for (let i = 0; i < 50; i++) seed(store, `server${i}`);
    const host = hostWithTools(Array.from({length: 500}, (_, i) => ({...echoTool, name: `tool_${i}`})));
    const start = vi.spyOn(host, "start");
    const gateway = open(store, { stdioHost: host, searchWaitMs: 2000 });
    const cold = performance.now();
    await gateway.searchTools("tool_499");
    const coldMs = performance.now() - cold;
    const warm = performance.now();
    const result = await gateway.searchTools("tool_499");
    const warmMs = performance.now() - warm;
    expect(result.tools).toHaveLength(5);
    expect(start).toHaveBeenCalledTimes(50);
    console.log(JSON.stringify({servers: 50, tools: 25000, coldMs, warmMs}));
  });

  it("coalesces reconnect bursts until the old transport has closed", async () => {
    const store = memoryStore(); const id = seed(store);
    const host = hostWithTools([echoTool]);
    const start = vi.spyOn(host, "start");
    let release!: () => void;
    host.close = () => new Promise<void>(resolve => { release = resolve; });
    const gateway = open(store, { stdioHost: host });
    await gateway.startServer(id);
    const burst = Array.from({length: 20}, () => gateway.reconnectServer(id));
    await new Promise(resolve => setTimeout(resolve, 10));
    const startsBeforeClose = start.mock.calls.length;
    release();
    await Promise.all(burst);
    host.close = async () => {};
    expect(startsBeforeClose).toBe(1);
    expect(start).toHaveBeenCalledTimes(2);
  });

  it("aborts catalog refresh on disable and survives repeated enable/disable", async () => {
    const store = memoryStore(); const id = seed(store);
    const host = hostWithTools([echoTool]);
    const gateway = open(store, { stdioHost: host });
    await gateway.inspectServer(id);
    let refreshing!: () => void;
    const started = new Promise<void>(resolve => { refreshing = resolve; });
    let aborted = false;
    host.refresh = (_id, signal) => new Promise((_resolve, reject) => {
      refreshing();
      signal!.addEventListener("abort", () => { aborted = true; reject(new Error("cancelled")); }, {once: true});
    });
    vi.spyOn(Date, "now").mockReturnValue(Date.now() + 300001);
    try {
      const read = gateway.inspectServer(id);
      await started;
      store.setEnabled(id, false);
      await gateway.closeServer(id);
      expect((await read).tools).toEqual([]);
      expect(aborted).toBe(true);
      for (let i = 0; i < 10; i++) {
        store.setEnabled(id, true);
        expect((await gateway.inspectServer(id)).tools).toHaveLength(1);
        store.setEnabled(id, false);
        await gateway.closeServer(id);
        expect((await gateway.inspectServer(id)).tools).toEqual([]);
      }
      const state = gateway as unknown as {serverEpochs: Map<string, unknown>; catalogGenerations: Map<string, unknown>};
      expect(state.serverEpochs.size).toBe(0);
      expect(state.catalogGenerations.size).toBe(0);
    } finally { vi.restoreAllMocks(); }
  });

  it("bounds a slow OAuth HTTP request with the existing timeout", async () => {
    vi.stubGlobal("fetch", (_input: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener("abort", () => reject(init.signal!.reason), {once: true});
    }));
    try {
      const fetch = redirectGuardFetch(new URL("https://mcp.example/mcp"), undefined, 20);
      await expect(fetch("https://mcp.example/oauth/token")).rejects.toThrow("timed out");
    } finally { vi.unstubAllGlobals(); }
  });

  it("drops a loaded search result when the server is disabled while another loads", async () => {
    const store = memoryStore(); const first = seed(store, "first"); const slow = seed(store, "slow");
    const host = hostWithTools([echoTool]);
    const originalStart = host.start;
    let release!: () => void;
    host.start = async (config, signal) => {
      if (config.id === slow) await new Promise<void>(r => { release = r; });
      return originalStart(config, signal);
    };
    const gateway = open(store, { stdioHost: host });
    await gateway.inspectServer(first);
    const search = gateway.searchTools("echo");
    await new Promise(resolve => setTimeout(resolve, 10));
    store.setEnabled(first, false);
    await gateway.closeServer(first);
    release();
    const result = await search;
    expect(result.tools).toHaveLength(1);
  });

  it("calls one tool found by search", async () => {
    const store = memoryStore();
    seed(store);
    const gateway = open(store, { stdioHost: hostWithTools([echoTool, writeTool]) });
    const { tools: hits } = await gateway.searchTools("echo");
    expect(hits[0]?.name).toBe("echo");
    expect(hits).toHaveLength(1);
    const result = await gateway.call(hits[0]!.id, {});
    expect(result.content).toEqual([{ type: "text", text: "ok" }]);
    const schema = await gateway.getTool(hits[0]!.id);
    expect(schema.inputSchema).toEqual({ type: "object" });
  });

  it("ranks tools by parameter names and attaches a call card", async () => {
    const store = memoryStore();
    seed(store);
    const gateway = open(store, { stdioHost: hostWithTools([echoTool, queryTool]) });
    const { tools } = await gateway.searchTools("data_source_urls");
    expect(tools[0]?.name).toBe("query_data_sources");
    expect(tools[0]?.card?.shape).toBe("{ data: { query, data_source_urls } }");
    expect(tools[0]?.card?.example).toEqual({ data: { query: "", data_source_urls: [""] } });
  });

  it("reports unknown catalog counts without connecting", async () => {
    const store = memoryStore();
    const id = seed(store);
    const host = hostWithTools([echoTool]);
    const start = vi.spyOn(host, "start");
    const gateway = open(store, { stdioHost: host });
    expect(gateway.catalogCounts(id)).toBeNull();
    expect(start).not.toHaveBeenCalled();
    await gateway.inspectServer(id);
    expect(gateway.catalogCounts(id)).toEqual({ tools: 1, prompts: 0, resources: 0 });
  });

  it("rejects invalid arguments without invoking the tool", async () => {
    const store = memoryStore();
    seed(store);
    let calls = 0;
    const gateway = open(store, { stdioHost: hostWithTools([queryTool], () => { calls += 1; }) });
    const { tools } = await gateway.searchTools("query_data_sources");
    await expect(gateway.call(tools[0]!.id, { query: "today" })).rejects.toThrow(/Invalid arguments/);
    expect(calls).toBe(0);
    expect(gateway.peekTool(tools[0]!.id)?.name).toBe("query_data_sources");
  });

  it("rejects ids that are not current MCP ids without connecting", async () => {
    const store = memoryStore();
    seed(store);
    const host = hostWithTools([echoTool]);
    const start = vi.spyOn(host, "start");
    const gateway = open(store, { stdioHost: host });
    await expect(gateway.getTool("fixture__mcp__echo_0123456789")).rejects.toThrow("Invalid MCP tool id: fixture__mcp__echo_0123456789. Use an id returned by mcp_search.");
    await expect(gateway.getPrompt("mcpt_0123456789")).rejects.toThrow("Invalid MCP prompt id");
    await expect(gateway.readResource("mcpp_0123456789")).rejects.toThrow("Invalid MCP resource id");
    expect(start).not.toHaveBeenCalled();
    await expect(gateway.getTool("mcpt_0123456789")).rejects.toThrow("MCP tool not found: mcpt_0123456789");
  });

  it("returns ready catalogs without waiting for a hung server", async () => {
    const store = memoryStore();
    seed(store, "Echo");
    const slow = seed(store, "Slow");
    const host = hostWithTools([echoTool]);
    const originalStart = host.start;
    host.start = async (config, signal) => {
      if (config.id === slow) {
        await new Promise<never>((_, reject) => {
          const fail = () => reject(new Error("aborted"));
          if (signal?.aborted) fail();
          else signal?.addEventListener("abort", fail, { once: true });
        });
      }
      return originalStart(config, signal);
    };
    const gateway = open(store, { stdioHost: host, searchWaitMs: 80 });
    const started = Date.now();
    const result = await gateway.searchTools("echo");
    expect(Date.now() - started).toBeLessThan(1500);
    expect(result.tools.some((tool) => tool.handle === "echo")).toBe(true);
    expect(result.unavailable.some((item) => item.startsWith("Slow"))).toBe(true);
  });
});

describe("MCP header attachment", () => {
  const configured = new URL("https://mcp.example/mcp");
  const jsonrpc = { method: "POST", body: JSON.stringify({ jsonrpc: "2.0", method: "initialize", id: 1 }) };

  it("keeps configured headers off cross-origin JSON-RPC and event-stream requests", () => {
    expect(isMcpRequest(new URL("https://evil.example/mcp"), configured, configured, jsonrpc)).toBe(false);
    expect(isMcpRequest(
      new URL("https://evil.example/events"),
      configured,
      configured,
      { method: "GET", headers: { accept: "text/event-stream" } },
    )).toBe(false);
    expect(isMcpRequest(configured, configured, configured, jsonrpc)).toBe(true);
  });
});
