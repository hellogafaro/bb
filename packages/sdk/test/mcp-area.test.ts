import { describe, expect, expectTypeOf, it } from "vitest";
import type { McpRealtimeEvent } from "@bb/sdk";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

const server = {
  id: "mcp_abcdefghij",
  handle: "notion",
  name: "Notion",
  description: null,
  type: "streamable-http",
  status: "ready",
  sourceKind: "registry",
  enabled: true,
  authStatus: "authenticated",
  lastError: null,
  sourceRef: "https://mcp.notion.com/mcp",
  registryName: "com.notion/mcp",
  registryVersion: "1.0.0",
  config: {
    type: "streamable-http",
    url: "https://mcp.notion.com/mcp",
    headers: {},
  },
  toolCount: 12,
  promptCount: 0,
  resourceCount: 0,
  guide: null,
};

function sdkWith(responses: Record<string, unknown>) {
  const requests: CapturedRequest[] = [];
  const fetch: FetchImplementation = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push({
      method,
      url: `${url.pathname}${url.search}`,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const key = `${method} ${url.pathname}`;
    if (!(key in responses)) {
      return new Response(
        JSON.stringify({ code: "not_found", message: "Not found" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    return new Response(JSON.stringify(responses[key]), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const sdk = createBbSdk({
    transport: createHttpTransport({
      baseUrl: "http://bb.test",
      fetch,
      runtime: "node",
    }),
  });
  return { sdk, requests };
}

describe("sdk.mcp", () => {
  it("lists compact rows by default and full rows with details", async () => {
    const { sdk, requests } = sdkWith({
      "GET /api/v1/mcp/servers": { servers: [server] },
    });
    await expect(sdk.mcp.list({ details: true })).resolves.toEqual([server]);
    expect(requests[0]?.url).toBe("/api/v1/mcp/servers?details=true");
    const compact = sdkWith({
      "GET /api/v1/mcp/servers": {
        servers: [
          {
            id: server.id,
            handle: "notion",
            type: "streamable-http",
            status: "ready",
            tools: 12,
          },
        ],
      },
    });
    await expect(compact.sdk.mcp.list()).resolves.toEqual([
      {
        id: server.id,
        handle: "notion",
        type: "streamable-http",
        status: "ready",
        tools: 12,
      },
    ]);
  });

  it("encodes server references and sends typed bodies", async () => {
    const { sdk, requests } = sdkWith({
      "POST /api/v1/mcp/servers": {
        id: server.id,
        handle: "notion",
        name: "Notion",
      },
      "PUT /api/v1/mcp/servers/io.github%2Fnotion/guide": {
        id: server.id,
        handle: "notion",
        guide: "Use docs",
      },
      "PUT /api/v1/mcp/servers/notion/policies": {
        tool: "search",
        risk: "read",
        mode: "deny",
        policy: "deny",
      },
      "POST /api/v1/mcp/tools/call": {
        content: [{ type: "text", text: "ok" }],
      },
    });
    await sdk.mcp.add({
      kind: "http",
      url: "https://mcp.notion.com/mcp",
      transport: "streamable-http",
    });
    await sdk.mcp.setGuide({ server: "io.github/notion", guide: "Use docs" });
    await sdk.mcp.setPolicy({ server: "notion", tool: "search", mode: "deny" });
    await expect(
      sdk.mcp.callTool({
        id: "mcpt_0123456789",
        args: { q: "x" },
        threadId: "thr_1",
      }),
    ).resolves.toEqual({ content: [{ type: "text", text: "ok" }] });
    expect(requests.map((item) => [item.method, item.url, item.body])).toEqual([
      [
        "POST",
        "/api/v1/mcp/servers",
        {
          kind: "http",
          url: "https://mcp.notion.com/mcp",
          transport: "streamable-http",
        },
      ],
      [
        "PUT",
        "/api/v1/mcp/servers/io.github%2Fnotion/guide",
        { guide: "Use docs" },
      ],
      [
        "PUT",
        "/api/v1/mcp/servers/notion/policies",
        { tool: "search", mode: "deny" },
      ],
      [
        "POST",
        "/api/v1/mcp/tools/call",
        { id: "mcpt_0123456789", args: { q: "x" }, threadId: "thr_1" },
      ],
    ]);
  });

  it("builds search queries and surfaces server errors", async () => {
    const { sdk, requests } = sdkWith({
      "GET /api/v1/mcp/tools/search": { tools: [], unavailable: ["Slow"] },
    });
    await expect(
      sdk.mcp.searchTools({ query: "create page", limit: 3, server: "notion" }),
    ).resolves.toEqual({ tools: [], unavailable: ["Slow"] });
    expect(requests[0]?.url).toBe(
      "/api/v1/mcp/tools/search?q=create+page&limit=3&server=notion",
    );
    await expect(sdk.mcp.get({ server: "missing" })).rejects.toThrow();
  });

  it("types the mcp realtime event", () => {
    expectTypeOf<McpRealtimeEvent["entity"]>().toEqualTypeOf<"mcp">();
    expectTypeOf<McpRealtimeEvent["changes"][number]>().toEqualTypeOf<
      "servers-changed" | "runtime-changed" | "policies-changed"
    >();
  });
});
