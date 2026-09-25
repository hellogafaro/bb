import type { Context, Hono } from "hono";
import type { z } from "zod";
import {
  mcpAddServerRequestSchema,
  mcpCallRequestSchema,
  mcpGetPromptRequestSchema,
  mcpReadResourceRequestSchema,
  mcpSetEnabledRequestSchema,
  mcpSetGuideRequestSchema,
  mcpSetHeadersRequestSchema,
  mcpSetToolPolicyRequestSchema,
  type McpCallResultResponse,
} from "@bb/server-contract";
import { getThread } from "@bb/db";
import { ApiError } from "../errors.js";
import { SEARCH_LIMIT, SEARCH_MAX } from "../services/mcp/catalog.js";
import { classifyTool } from "../services/mcp/policy.js";
import type { McpService } from "../services/mcp/service.js";
import type { AppDeps } from "../types.js";

const REGISTRY_DEFAULT_LIMIT = 12;
const REGISTRY_MAX_LIMIT = 50;
const QUERY_MAX_CHARS = 200;

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function parseBody<T>(
  context: Context,
  schema: z.ZodType<T>,
): Promise<T> {
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

function queryText(context: Context, name: string): string {
  const value = context.req.query(name)?.trim() ?? "";
  if (value.length > QUERY_MAX_CHARS)
    throw new ApiError(
      400,
      "invalid_request",
      `${name} is longer than ${QUERY_MAX_CHARS} characters`,
    );
  return value;
}

function optionalQuery(context: Context, name: string): string | null {
  const value = context.req.query(name)?.trim();
  return value ? value : null;
}

function limitQuery(context: Context, fallback: number, max: number): number {
  const raw = context.req.query("limit");
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1)
    throw new ApiError(
      400,
      "invalid_request",
      "limit must be a positive integer",
    );
  return Math.min(value, max);
}

async function runtime<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(422, "invalid_request", errorText(error));
  }
}

function callbackPage(message: string, status: 200 | 400): Response {
  return new Response(`<p>${message}</p>`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

export function registerMcpRoutes(
  app: Hono,
  deps: AppDeps,
  mcp: McpService,
): void {
  const admin = mcp.admin;

  app.get("/mcp/servers", async (context) => {
    if (context.req.query("details") === "true")
      return context.json({ servers: await admin.list() });
    return context.json({ servers: admin.summaries() });
  });

  app.post("/mcp/servers", async (context) => {
    const body = await parseBody(context, mcpAddServerRequestSchema);
    return context.json(await runtime(() => admin.add(body)), 201);
  });

  app.get("/mcp/servers/:ref", async (context) => {
    return context.json(
      await admin.view(admin.requireServer(context.req.param("ref"))),
    );
  });

  app.delete("/mcp/servers/:ref", async (context) => {
    const ref = context.req.param("ref");
    const removed = await admin.remove(ref);
    if (!removed)
      throw new ApiError(404, "not_found", `MCP server not found: ${ref}`);
    return context.json({ deleted: true, id: removed.id });
  });

  app.put("/mcp/servers/:ref/enabled", async (context) => {
    const body = await parseBody(context, mcpSetEnabledRequestSchema);
    return context.json(
      await admin.setEnabled(context.req.param("ref"), body.enabled),
    );
  });

  app.put("/mcp/servers/:ref/headers", async (context) => {
    const body = await parseBody(context, mcpSetHeadersRequestSchema);
    await runtime(() =>
      admin.setHeaders(context.req.param("ref"), body.headers),
    );
    return context.json(
      await admin.view(admin.requireServer(context.req.param("ref"))),
    );
  });

  app.put("/mcp/servers/:ref/guide", async (context) => {
    const body = await parseBody(context, mcpSetGuideRequestSchema);
    return context.json(admin.setGuide(context.req.param("ref"), body.guide));
  });

  app.post("/mcp/servers/:ref/auth", async (context) => {
    return context.json(
      await runtime(() => admin.authenticate(context.req.param("ref"))),
    );
  });

  app.post("/mcp/servers/:ref/auth/cancel", async (context) => {
    await runtime(() => admin.cancelAuthentication(context.req.param("ref")));
    return context.json({ canceled: true });
  });

  app.post("/mcp/servers/:ref/reconnect", async (context) => {
    return context.json(
      await runtime(() => admin.reconnect(context.req.param("ref"))),
    );
  });

  app.get("/mcp/servers/:ref/tools", async (context) => {
    const server = admin.requireServer(context.req.param("ref"));
    return context.json(await mcp.gateway.inspectServer(server.id));
  });

  app.get("/mcp/servers/:ref/policies", async (context) => {
    return context.json({
      tools: await admin.listPolicies(context.req.param("ref")),
    });
  });

  app.put("/mcp/servers/:ref/policies", async (context) => {
    const body = await parseBody(context, mcpSetToolPolicyRequestSchema);
    return context.json(
      await admin.setPolicy(context.req.param("ref"), body.tool, body.mode),
    );
  });

  app.get("/mcp/registry", async (context) => {
    const query = queryText(context, "q");
    if (!query)
      throw new ApiError(400, "invalid_request", "Expected a registry query");
    const servers = await runtime(() =>
      admin.searchRegistry(
        query,
        limitQuery(context, REGISTRY_DEFAULT_LIMIT, REGISTRY_MAX_LIMIT),
        context.req.query("remoteOnly") === "true",
      ),
    );
    return context.json({ servers });
  });

  app.get("/mcp/tools/search", async (context) => {
    const query = queryText(context, "q");
    if (!query)
      throw new ApiError(400, "invalid_request", "Expected a tool query");
    const limit = limitQuery(context, SEARCH_LIMIT, SEARCH_MAX);
    return context.json(
      await runtime(() =>
        admin.searchTools(query, limit, optionalQuery(context, "server")),
      ),
    );
  });

  app.get("/mcp/tools/:id/schema", async (context) => {
    const tool = await runtime(() =>
      mcp.gateway.getTool(context.req.param("id")),
    );
    return context.json({
      id: tool.id,
      name: tool.name,
      description: tool.description,
      risk: classifyTool(tool.annotations),
      inputSchema: tool.inputSchema,
    });
  });

  app.post("/mcp/tools/call", async (context) => {
    const body = await parseBody(context, mcpCallRequestSchema);
    if (body.threadId !== null) {
      const thread = getThread(deps.db, body.threadId);
      if (!thread || thread.deletedAt !== null)
        throw new ApiError(
          404,
          "not_found",
          `Thread not found: ${body.threadId}`,
        );
    }
    const result: McpCallResultResponse = await runtime(() =>
      mcp.invokeTool(body.id, body.args, {
        threadId: body.threadId,
        signal: context.req.raw.signal,
      }),
    );
    return context.json(result);
  });

  app.get("/mcp/prompts", async (context) => {
    const prompts = await runtime(() =>
      admin.searchPrompts(
        queryText(context, "q"),
        optionalQuery(context, "server"),
      ),
    );
    return context.json({ prompts });
  });

  app.post("/mcp/prompts/get", async (context) => {
    const body = await parseBody(context, mcpGetPromptRequestSchema);
    return context.json(
      await runtime(() =>
        mcp.gateway.getPrompt(body.id, body.args, context.req.raw.signal),
      ),
    );
  });

  app.get("/mcp/resources", async (context) => {
    const resources = await runtime(() =>
      admin.searchResources(
        queryText(context, "q"),
        optionalQuery(context, "server"),
      ),
    );
    return context.json({ resources });
  });

  app.post("/mcp/resources/read", async (context) => {
    const body = await parseBody(context, mcpReadResourceRequestSchema);
    return context.json(
      await runtime(() =>
        mcp.gateway.readResource(body.id, context.req.raw.signal),
      ),
    );
  });

  app.get("/mcp/oauth/callback", async (context) => {
    const url = new URL(context.req.url);
    const id = url.searchParams.get("id");
    if (!id) return callbackPage("Missing MCP OAuth callback context", 400);
    try {
      await admin.finishAuthentication(id, url.searchParams);
      return callbackPage(
        "Authentication completed. You can close this window.",
        200,
      );
    } catch (error) {
      deps.logger.warn(
        `[mcp] OAuth callback failed for ${id}: ${errorText(error)}`,
      );
      return callbackPage(
        "Authentication failed. Return to BB and try again.",
        400,
      );
    }
  });
}
