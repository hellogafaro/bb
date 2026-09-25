import {
  agentListResponseSchema,
  agentResponseSchema,
  deleteAgentResponseSchema,
  type AgentResponse,
  type CreateAgentRequest,
  type DeleteAgentResponse,
  type UpdateAgentRequest,
} from "@bb/server-contract";
import type { CreateSdkAreaArgs } from "./common.js";

export type AgentResult = AgentResponse;
export type AgentDeleteResult = DeleteAgentResponse;
export type AgentCreateArgs = CreateAgentRequest & { signal?: AbortSignal };
export type AgentUpdateArgs = UpdateAgentRequest & {
  agent: string;
  signal?: AbortSignal;
};

export interface AgentRefArgs {
  agent: string;
  signal?: AbortSignal;
}

export interface AgentListArgs {
  signal?: AbortSignal;
}

export interface AgentsArea {
  list(args?: AgentListArgs): Promise<AgentResult[]>;
  get(args: AgentRefArgs): Promise<AgentResult>;
  create(args: AgentCreateArgs): Promise<AgentResult>;
  update(args: AgentUpdateArgs): Promise<AgentResult>;
  remove(args: AgentRefArgs): Promise<AgentDeleteResult>;
}

function agentPath(agent: string): string {
  return `/api/v1/agents/${encodeURIComponent(agent)}`;
}

export function createAgentsArea(args: CreateSdkAreaArgs): AgentsArea {
  const { transport } = args;

  async function send<T>(
    method: string,
    path: string,
    schema: { parse(value: unknown): T },
    body: unknown,
    signal: AbortSignal | undefined,
  ): Promise<T> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}${path}`, {
        method,
        ...(body === undefined
          ? {}
          : {
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            }),
        ...(signal ? { signal } : {}),
      }),
    );
    return schema.parse(await response.json());
  }

  return {
    async list(input = {}) {
      const response = await send(
        "GET",
        "/api/v1/agents",
        agentListResponseSchema,
        undefined,
        input.signal,
      );
      return response.agents;
    },
    get: (input) =>
      send(
        "GET",
        agentPath(input.agent),
        agentResponseSchema,
        undefined,
        input.signal,
      ),
    create: ({ signal, ...body }) =>
      send("POST", "/api/v1/agents", agentResponseSchema, body, signal),
    update: ({ agent, signal, ...body }) =>
      send("PATCH", agentPath(agent), agentResponseSchema, body, signal),
    remove: (input) =>
      send(
        "DELETE",
        agentPath(input.agent),
        deleteAgentResponseSchema,
        undefined,
        input.signal,
      ),
  };
}
