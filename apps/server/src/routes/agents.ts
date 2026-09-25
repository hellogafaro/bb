import type { Context, Hono } from "hono";
import type { z } from "zod";
import {
  createAgentRequestSchema,
  updateAgentRequestSchema,
  type AgentListResponse,
  type AgentResponse,
  type DeleteAgentResponse,
} from "@bb/server-contract";
import { ApiError } from "../errors.js";
import {
  createAgent,
  deleteAgentByRef,
  listAllAgents,
  requireAgentByRef,
  toAgentResponse,
  updateAgentByRef,
} from "../services/agents/agents.js";
import type { AppDeps } from "../types.js";

async function parseBody<Schema extends z.ZodType>(
  context: Context,
  schema: Schema,
): Promise<z.output<Schema>> {
  const parsed = schema.safeParse(await context.req.json().catch(() => null));
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_request",
      parsed.error.issues
        .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
        .join("; "),
    );
  }
  return parsed.data;
}

export function registerAgentRoutes(app: Hono, deps: AppDeps): void {
  app.get("/agents", (context) =>
    context.json({
      agents: listAllAgents(deps).map((agent) => toAgentResponse(deps, agent)),
    } satisfies AgentListResponse),
  );

  app.post("/agents", async (context) => {
    const body = await parseBody(context, createAgentRequestSchema);
    return context.json(
      toAgentResponse(deps, createAgent(deps, body)) satisfies AgentResponse,
      201,
    );
  });

  app.get("/agents/:ref", (context) =>
    context.json(
      toAgentResponse(
        deps,
        requireAgentByRef(deps, context.req.param("ref")),
      ) satisfies AgentResponse,
    ),
  );

  app.patch("/agents/:ref", async (context) => {
    const body = await parseBody(context, updateAgentRequestSchema);
    return context.json(
      toAgentResponse(
        deps,
        updateAgentByRef(deps, context.req.param("ref"), body),
      ) satisfies AgentResponse,
    );
  });

  app.delete("/agents/:ref", (context) => {
    const agent = deleteAgentByRef(deps, context.req.param("ref"));
    return context.json({
      deleted: true,
      id: agent.id,
    } satisfies DeleteAgentResponse);
  });
}
