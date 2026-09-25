import type { ElicitRequest } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { McpApprovals } from "../../../src/services/mcp/approvals.js";
import {
  elicitationFields,
  validElicitationContent,
} from "../../../src/services/mcp/elicitation.js";
import type { PluginInteractionResult } from "../../../src/services/interactions/pending-interactions.js";
import { withTestHarness } from "../../helpers/test-app.js";
import {
  callAgentTool,
  mcpHostFixture,
  responseText,
  waitFor,
} from "./harness.js";

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

afterEach(() => {
  vi.unstubAllGlobals();
});

function sse(message: unknown): Uint8Array {
  return new TextEncoder().encode(
    `event: message\ndata: ${JSON.stringify(message)}\n\n`,
  );
}

function stubElicitingServer() {
  const answers: unknown[] = [];
  let open: {
    id: unknown;
    controller: ReadableStreamDefaultController<Uint8Array>;
  } | null = null;
  const json = (
    value: unknown,
    status = 200,
    headers: Record<string, string> = {},
  ) =>
    new Response(JSON.stringify(value), {
      status,
      headers: { "content-type": "application/json", ...headers },
    });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(
        input instanceof Request ? input.url : input.toString(),
      );
      if (url.origin !== origin || url.pathname !== "/mcp")
        return new Response(null, { status: 404 });
      if (init?.method !== "POST") return new Response(null, { status: 405 });
      const message = JSON.parse(String(init.body)) as {
        id?: unknown;
        method?: string;
        result?: unknown;
      };
      if (message.id !== undefined && message.method === undefined) {
        answers.push(message.result);
        const call = open!;
        open = null;
        call.controller.enqueue(
          sse({
            jsonrpc: "2.0",
            id: call.id,
            result: {
              content: [
                {
                  type: "text",
                  text: `answer ${JSON.stringify(message.result)}`,
                },
              ],
            },
          }),
        );
        call.controller.close();
        return new Response(null, { status: 202 });
      }
      if (message.id === undefined) return new Response(null, { status: 202 });
      if (message.method === "server/discover")
        return json({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: "Method not found" },
        });
      if (message.method === "initialize") {
        return json(
          {
            jsonrpc: "2.0",
            id: message.id,
            result: {
              protocolVersion: "2025-11-25",
              capabilities: { tools: {} },
              serverInfo: { name: "elicit", version: "1" },
            },
          },
          200,
          { "mcp-session-id": "session-1" },
        );
      }
      if (message.method === "tools/list") {
        return json({
          jsonrpc: "2.0",
          id: message.id,
          result: {
            tools: [
              {
                name: "ask_name",
                description: "Ask for a name",
                inputSchema: { type: "object" },
                annotations: { readOnlyHint: true },
              },
            ],
          },
        });
      }
      if (message.method === "tools/call") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            open = { id: message.id, controller };
            controller.enqueue(
              sse({
                jsonrpc: "2.0",
                id: "elicit-1",
                method: "elicitation/create",
                params: {
                  mode: "form",
                  message: "What is your name?",
                  requestedSchema,
                },
              }),
            );
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "content-type": "text/event-stream",
            "mcp-session-id": "session-1",
          },
        });
      }
      return json({ jsonrpc: "2.0", id: message.id, result: {} });
    }),
  );
  return { answers };
}

describe("MCP elicitation", () => {
  it("asks the user through a core interaction in the calling thread and returns the answer to the server", async () => {
    const { answers } = stubElicitingServer();
    await withTestHarness(async (harness) => {
      const host = mcpHostFixture(harness);
      await harness.mcpService.admin.add({
        kind: "http",
        name: "elicit",
        url: `${origin}/mcp`,
        transport: "streamable-http",
      });
      const { tools } = await harness.mcpService.admin.searchTools(
        "ask",
        5,
        null,
      );
      const id = tools[0]?.id;
      if (!id) throw new Error("ask_name not found");

      const pending = callAgentTool(
        harness,
        "mcp_call",
        { id, args: {} },
        host.threadId,
      );
      let interactionId = "";
      await waitFor(() => {
        const interaction =
          harness.deps.pendingInteractions.listPendingThreadInteractions(
            host.threadId,
          )[0];
        interactionId = interaction?.id ?? "";
        return interaction !== undefined;
      });
      const [interaction] =
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          host.threadId,
        );
      expect(interaction).toMatchObject({
        origin: { kind: "core" },
        payload: {
          kind: "mcp_elicitation",
          server: "elicit",
          message: "What is your name?",
          fields: [
            {
              name: "name",
              title: "Name",
              type: "string",
              required: true,
              options: null,
            },
            {
              name: "age",
              description: "Years",
              type: "integer",
              required: false,
            },
            {
              name: "plan",
              type: "string",
              options: [
                { value: "free", label: "Free" },
                { value: "pro", label: "Pro" },
              ],
            },
          ],
        },
      });
      const invalid = await harness.app.request(
        `/api/v1/threads/${host.threadId}/interactions/${interactionId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "mcp_elicitation",
            action: "accept",
            content: { age: 3 },
          }),
        },
      );
      expect(invalid.status).toBe(400);
      const resolved = await harness.app.request(
        `/api/v1/threads/${host.threadId}/interactions/${interactionId}/resolve`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            kind: "mcp_elicitation",
            action: "accept",
            content: { name: "Ada", age: 36, plan: "pro" },
          }),
        },
      );
      expect(resolved.status).toBe(200);
      expect(responseText(await pending)).toContain("Ada");
      expect(answers).toEqual([
        { action: "accept", content: { name: "Ada", age: 36, plan: "pro" } },
      ]);

      await harness.mcpService.invokeTool(id, {}, { threadId: null });
      expect(answers[1]).toEqual({ action: "decline" });
      expect(
        harness.deps.pendingInteractions.listPendingThreadInteractions(
          host.threadId,
        ),
      ).toEqual([]);
    });
  });

  it("declines after a timeout and on unsupported forms, and cancels when the user cancels", async () => {
    const results: PluginInteractionResult[] = [
      { outcome: "cancelled", reason: "timeout" },
      {
        outcome: "submitted",
        value: {
          kind: "mcp_elicitation",
          action: "accept",
          content: { age: 3 },
        },
      },
      { outcome: "cancelled", reason: "user" },
    ];
    const approvals = new McpApprovals(
      {
        requestCoreInteraction: async () => {
          const next = results.shift();
          if (!next) throw new Error("no scripted result");
          return next;
        },
      },
      { info() {}, warn() {} },
      50,
    );
    const request: ElicitRequest = {
      method: "elicitation/create",
      params: {
        mode: "form",
        message: "Name?",
        requestedSchema: {
          type: "object",
          properties: { name: { type: "string" } },
          required: ["name"],
        },
      },
    };
    const ask = () =>
      approvals.runCall("srv", { threadId: "thr_1" }, () =>
        approvals.elicit(request, "srv", "srv"),
      );
    await expect(ask()).resolves.toEqual({ action: "decline" });
    await expect(ask()).resolves.toEqual({ action: "decline" });
    await expect(ask()).resolves.toEqual({ action: "cancel" });
    await expect(approvals.elicit(request, "srv", "srv")).resolves.toEqual({
      action: "decline",
    });
    const urlRequest: ElicitRequest = {
      method: "elicitation/create",
      params: {
        mode: "url",
        message: "Open",
        url: "https://x",
        elicitationId: "e1",
      },
    };
    await expect(
      approvals.runCall("srv", { threadId: "thr_1" }, () =>
        approvals.elicit(urlRequest, "srv", "srv"),
      ),
    ).resolves.toEqual({ action: "decline" });
  });

  it("maps supported form fields and validates submitted values", () => {
    const fields = elicitationFields(requestedSchema);
    if (!fields) throw new Error("fields expected");
    expect(validElicitationContent(fields, { name: "Ada" })).toEqual({
      name: "Ada",
    });
    expect(
      validElicitationContent(fields, { name: "Ada", age: 1.5 }),
    ).toBeNull();
    expect(
      validElicitationContent(fields, { name: "Ada", plan: "enterprise" }),
    ).toBeNull();
    expect(validElicitationContent(fields, { age: 3 })).toBeNull();
    expect(
      elicitationFields({
        type: "object",
        properties: { tags: { type: "array" } },
        required: ["tags"],
      }),
    ).toBeNull();
    expect(
      elicitationFields({
        type: "object",
        properties: { tags: { type: "array" } },
      }),
    ).toEqual([]);
  });
});
