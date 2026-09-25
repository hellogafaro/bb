import { describe, expect, expectTypeOf, it } from "vitest";
import type { AgentRealtimeEvent } from "@bb/sdk";
import { createBbSdk } from "../src/core.js";
import { createHttpTransport } from "../src/transport-http.js";
import type { FetchImplementation } from "../src/response.js";

interface CapturedRequest {
  method: string;
  url: string;
  body: unknown;
}

const agent = {
  id: "agent_abcdefghij",
  name: "Coder",
  description: "Writes code",
  providerId: "codex",
  model: null,
  reasoningLevel: "high",
  skills: ["bb-cli"],
  mcpServers: [],
  instructions: "",
  mascot: "robot",
  color: 1,
  createdAt: 1,
  updatedAt: 2,
};

const thread = {
  id: "thr_abcdefghij",
  projectId: "proj_abcdefghij",
  environmentId: null,
  providerId: "codex",
  title: null,
  titleFallback: null,
  sectionId: null,
  status: "pending",
  parentThreadId: null,
  lifecycleOwnerThreadId: null,
  sourceThreadId: null,
  originKind: null,
  originPluginId: null,
  visibility: "visible",
  archivedAt: null,
  pinnedAt: null,
  snoozedUntil: null,
  agentId: agent.id,
  deletedAt: null,
  lastReadAt: null,
  latestAttentionAt: 1,
  createdAt: 1,
  updatedAt: 1,
  runtime: { displayStatus: "pending" },
  activeBackgroundAgentCount: 0,
  canSpawnChild: true,
  queuedMessageCount: 0,
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
        JSON.stringify({ code: "agent_not_found", message: "Agent not found" }),
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

describe("sdk.agents", () => {
  it("lists, gets, creates, updates, and removes agents by ref", async () => {
    const { sdk, requests } = sdkWith({
      "GET /api/v1/agents": { agents: [agent] },
      "GET /api/v1/agents/Coder%20One": agent,
      "POST /api/v1/agents": agent,
      "PATCH /api/v1/agents/agent_abcdefghij": { ...agent, name: "Builder" },
      "DELETE /api/v1/agents/Coder": { deleted: true, id: agent.id },
    });
    await expect(sdk.agents.list()).resolves.toEqual([agent]);
    await expect(sdk.agents.get({ agent: "Coder One" })).resolves.toEqual(
      agent,
    );
    await sdk.agents.create({ name: "Coder", providerId: "codex" });
    await expect(
      sdk.agents.update({ agent: agent.id, name: "Builder" }),
    ).resolves.toMatchObject({ name: "Builder" });
    await expect(sdk.agents.remove({ agent: "Coder" })).resolves.toEqual({
      deleted: true,
      id: agent.id,
    });
    expect(requests).toEqual([
      { method: "GET", url: "/api/v1/agents", body: undefined },
      { method: "GET", url: "/api/v1/agents/Coder%20One", body: undefined },
      {
        method: "POST",
        url: "/api/v1/agents",
        body: { name: "Coder", providerId: "codex" },
      },
      {
        method: "PATCH",
        url: "/api/v1/agents/agent_abcdefghij",
        body: { name: "Builder" },
      },
      { method: "DELETE", url: "/api/v1/agents/Coder", body: undefined },
    ]);
  });

  it("surfaces server errors", async () => {
    const { sdk } = sdkWith({});
    await expect(sdk.agents.get({ agent: "missing" })).rejects.toThrow(
      /Agent not found/,
    );
  });

  it("spawns threads with an agent name or id", async () => {
    const { sdk, requests } = sdkWith({ "POST /api/v1/threads": thread });
    await sdk.threads.spawn({
      agent: "Coder",
      projectId: "proj_abcdefghij",
      prompt: "hello",
      environment: { type: "project-default" },
    });
    expect(requests[0]?.body).toMatchObject({ agentId: "Coder" });
    await expect(
      sdk.threads.spawn({
        agent: "Coder",
        agentId: agent.id,
        projectId: "proj_abcdefghij",
        prompt: "hello",
        environment: { type: "project-default" },
      }),
    ).rejects.toThrow("Provide only one of agent or agentId.");
  });

  it("types agent realtime events", () => {
    expectTypeOf<AgentRealtimeEvent["entity"]>().toEqualTypeOf<"agent">();
  });
});
