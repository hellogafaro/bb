import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginUi } from "@get-bb/plugin-sdk";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server";
import { elicitationFields, McpApprovals, validElicitationContent } from "../src/approvals.js";

const origin = "https://elicit.example";
const requestedSchema = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name" },
    age: { type: "integer", description: "Years" },
    plan: { type: "string", enum: ["free", "pro"], enumNames: ["Free", "Pro"] },
  },
  required: ["name"],
};

const temps: string[] = [];
afterEach(async () => {
  await Promise.all(temps.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  vi.unstubAllGlobals();
});

function sse(message: unknown): Uint8Array {
  return new TextEncoder().encode(`event: message\ndata: ${JSON.stringify(message)}\n\n`);
}

function stubElicitingServer() {
  const answers: unknown[] = [];
  let open: { id: unknown; controller: ReadableStreamDefaultController<Uint8Array> } | null = null;
  const json = (value: unknown, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json", ...headers } });
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    if (url.origin !== origin || url.pathname !== "/mcp") return new Response(null, { status: 404 });
    if (init?.method !== "POST") return new Response(null, { status: 405 });
    const message = JSON.parse(String(init.body)) as { id?: unknown; method?: string; result?: unknown };
    if (message.id !== undefined && message.method === undefined) {
      answers.push(message.result);
      const call = open!;
      open = null;
      call.controller.enqueue(sse({ jsonrpc: "2.0", id: call.id, result: { content: [{ type: "text", text: `answer ${JSON.stringify(message.result)}` }] } }));
      call.controller.close();
      return new Response(null, { status: 202 });
    }
    if (message.id === undefined) return new Response(null, { status: 202 });
    if (message.method === "server/discover") return json({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
    if (message.method === "initialize") {
      return json({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2025-11-25", capabilities: { tools: {} }, serverInfo: { name: "elicit", version: "1" } } }, 200, { "mcp-session-id": "session-1" });
    }
    if (message.method === "tools/list") {
      return json({ jsonrpc: "2.0", id: message.id, result: { tools: [{ name: "ask_name", description: "Ask for a name", inputSchema: { type: "object" }, annotations: { readOnlyHint: true } }] } });
    }
    if (message.method === "tools/call") {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          open = { id: message.id, controller };
          controller.enqueue(sse({ jsonrpc: "2.0", id: "elicit-1", method: "elicitation/create", params: { mode: "form", message: "What is your name?", requestedSchema } }));
        },
      });
      return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream", "mcp-session-id": "session-1" } });
    }
    return json({ jsonrpc: "2.0", id: message.id, result: {} });
  }));
  return { answers };
}

describe("MCP elicitation", () => {
  it("asks the user through a BB interaction in the calling thread and returns the answer to the server", async () => {
    const { answers } = stubElicitingServer();
    const dataDir = await mkdtemp(join(tmpdir(), "bb-mcps-elicit-"));
    temps.push(dataDir);
    const { bb, harness } = createFakePluginHost({ pluginId: "mcps", sdk: { system: { config: async () => ({ dataDir, primaryHostId: "host_1" }) }, plugins: { updateSettings: async () => ({}) } } });
    await plugin(bb);
    try {
      expect((await harness.behavior.runCli(["add", "elicit", `${origin}/mcp`])).exitCode).toBe(0);
      const tools = JSON.parse((await harness.behavior.runCli(["tools", "ask", "--json"])).stdout!) as { tools: Array<{ id: string }> };
      const id = tools.tools[0]!.id;

      const pending = harness.behavior.callAgentTool("mcp_call", { id, args: {} }, { threadId: "thr_ask" }) as Promise<{ content: Array<{ text: string }> }>;
      await vi.waitFor(() => expect(harness.inspection.pendingInteractions).toHaveLength(1));
      const interaction = harness.inspection.pendingInteractions[0]!;
      expect(interaction).toMatchObject({
        threadId: "thr_ask",
        rendererId: "mcp-approval",
        payload: {
          kind: "elicitation",
          server: "elicit",
          message: "What is your name?",
          fields: [
            { name: "name", title: "Name", type: "string", required: true, options: null },
            { name: "age", description: "Years", type: "integer", required: false },
            { name: "plan", type: "string", options: [{ value: "free", label: "Free" }, { value: "pro", label: "Pro" }] },
          ],
        },
      });
      harness.behavior.submitInteraction(interaction.id, { action: "accept", content: { name: "Ada", age: 36, plan: "pro" } });
      expect((await pending).content[0]!.text).toContain("Ada");
      expect(answers).toEqual([{ action: "accept", content: { name: "Ada", age: 36, plan: "pro" } }]);

      const cli = await harness.behavior.runCli(["call", id, "{}", "--json"]);
      expect(cli.exitCode).toBe(0);
      expect(answers[1]).toEqual({ action: "decline" });
      expect(harness.inspection.pendingInteractions).toHaveLength(0);
    } finally { await harness.lifecycle.dispose(); }
  });

  it("declines after the interaction times out and rejects answers that do not fit the form", async () => {
    const results: Array<Awaited<ReturnType<PluginUi["requestInput"]>>> = [
      { outcome: "cancelled", reason: "timeout" },
      { outcome: "submitted", value: { action: "accept", content: { age: 3 } } },
      { outcome: "cancelled", reason: "user" },
    ];
    const ui: PluginUi = {
      requestInput: async () => results.shift()!,
      registerMentionProvider() {},
    };
    const approvals = new McpApprovals(ui, { info() {}, warn() {} }, 50);
    const request = { method: "elicitation/create", params: { mode: "form", message: "Name?", requestedSchema } };
    const ask = () => approvals.runCall("srv:mcp", { threadId: "thr_1" }, () => approvals.elicit(request, "srv:mcp", "srv"));
    await expect(ask()).resolves.toEqual({ action: "decline" });
    await expect(ask()).resolves.toEqual({ action: "decline" });
    await expect(ask()).resolves.toEqual({ action: "cancel" });
    await expect(approvals.elicit(request, "srv:mcp", "srv")).resolves.toEqual({ action: "decline" });
    await expect(approvals.runCall("srv:mcp", { threadId: "thr_1" }, () => approvals.elicit({ params: { mode: "url", message: "Open", url: "https://x" } }, "srv:mcp", "srv"))).resolves.toEqual({ action: "decline" });
  });

  it("maps supported form fields and validates submitted values", () => {
    const fields = elicitationFields(requestedSchema)!;
    expect(validElicitationContent(fields, { name: "Ada" })).toEqual({ name: "Ada" });
    expect(validElicitationContent(fields, { name: "Ada", age: 1.5 })).toBeNull();
    expect(validElicitationContent(fields, { name: "Ada", plan: "enterprise" })).toBeNull();
    expect(validElicitationContent(fields, { age: 3 })).toBeNull();
    expect(elicitationFields({ type: "object", properties: { tags: { type: "array" } }, required: ["tags"] })).toBeNull();
    expect(elicitationFields({ type: "object", properties: { tags: { type: "array" } } })).toEqual([]);
  });
});
