import {
  mcpAddServerRequestSchema,
  mcpAddServerResponseSchema,
  mcpAuthResponseSchema,
  mcpCallResultSchema,
  mcpCancelAuthResponseSchema,
  mcpGuideResponseSchema,
  mcpPromptsResponseSchema,
  mcpProviderStatusResponseSchema,
  mcpRecordResponseSchema,
  mcpRegistrySearchResponseSchema,
  mcpRemoveServerResponseSchema,
  mcpResourcesResponseSchema,
  mcpServerListSchema,
  mcpServerSchema,
  mcpServerSummaryListSchema,
  mcpServerToolsResponseSchema,
  mcpSetEnabledResponseSchema,
  mcpToolPoliciesResponseSchema,
  mcpToolPolicySchema,
  mcpToolSchemaResponseSchema,
  mcpToolSearchResponseSchema,
  type McpAddServerRequest,
} from "@bb/server-contract";
import type { z } from "zod";
import type { CreateSdkAreaArgs } from "./common.js";

type Parsed<Schema extends z.ZodType> = z.output<Schema>;

export type McpServerRecordResult = Parsed<typeof mcpServerSchema>;
export type McpServerSummaryResult = Parsed<
  typeof mcpServerSummaryListSchema
>["servers"][number];
export type McpAddServerResult = Parsed<typeof mcpAddServerResponseSchema>;
export type McpAuthResult = Parsed<typeof mcpAuthResponseSchema>;
export type McpCallResult = Parsed<typeof mcpCallResultSchema>;
export type McpToolPolicyResult = Parsed<typeof mcpToolPolicySchema>;
export type McpToolSearchResult = Parsed<typeof mcpToolSearchResponseSchema>;
export type McpToolSchemaResult = Parsed<typeof mcpToolSchemaResponseSchema>;
export type McpServerToolsResult = Parsed<typeof mcpServerToolsResponseSchema>;
export type McpRegistryHitResult = Parsed<
  typeof mcpRegistrySearchResponseSchema
>["servers"][number];
export type McpPromptRowResult = Parsed<
  typeof mcpPromptsResponseSchema
>["prompts"][number];
export type McpResourceRowResult = Parsed<
  typeof mcpResourcesResponseSchema
>["resources"][number];
export type McpProviderStatusResult = Parsed<
  typeof mcpProviderStatusResponseSchema
>;
export type McpPolicyMode = McpToolPolicyResult["mode"];
export type McpAddServerArgs = McpAddServerRequest;

interface AbortableArgs {
  signal?: AbortSignal;
}

export interface McpServerArgs extends AbortableArgs {
  server: string;
}

export interface McpListArgs extends AbortableArgs {
  details?: false;
}

export interface McpListDetailsArgs extends AbortableArgs {
  details: true;
}

export interface McpSearchArgs extends AbortableArgs {
  query?: string;
  server?: string;
}

export interface McpToolSearchArgs extends AbortableArgs {
  query: string;
  limit?: number;
  server?: string;
}

export interface McpRegistrySearchArgs extends AbortableArgs {
  query: string;
  limit?: number;
  remoteOnly?: boolean;
}

export interface McpProviderArgs extends AbortableArgs {
  hostId?: string;
  projectPath?: string;
}

export interface McpArea {
  list(args?: McpListArgs): Promise<McpServerSummaryResult[]>;
  list(args: McpListDetailsArgs): Promise<McpServerRecordResult[]>;
  get(args: McpServerArgs): Promise<McpServerRecordResult>;
  add(args: McpAddServerArgs): Promise<McpAddServerResult>;
  remove(args: McpServerArgs): Promise<{ deleted: boolean; id: string }>;
  setEnabled(
    args: McpServerArgs & { enabled: boolean },
  ): Promise<Parsed<typeof mcpSetEnabledResponseSchema>>;
  setHeaders(
    args: McpServerArgs & { headers: Record<string, string> },
  ): Promise<McpServerRecordResult>;
  setGuide(
    args: McpServerArgs & { guide: string | null },
  ): Promise<Parsed<typeof mcpGuideResponseSchema>>;
  authenticate(args: McpServerArgs): Promise<McpAuthResult>;
  reconnect(args: McpServerArgs): Promise<McpAuthResult>;
  cancelAuthentication(args: McpServerArgs): Promise<{ canceled: boolean }>;
  serverTools(args: McpServerArgs): Promise<McpServerToolsResult>;
  listPolicies(args: McpServerArgs): Promise<McpToolPolicyResult[]>;
  setPolicy(
    args: McpServerArgs & { tool: string; mode: McpPolicyMode },
  ): Promise<McpToolPolicyResult>;
  searchRegistry(args: McpRegistrySearchArgs): Promise<McpRegistryHitResult[]>;
  searchTools(args: McpToolSearchArgs): Promise<McpToolSearchResult>;
  toolSchema(
    args: AbortableArgs & { id: string },
  ): Promise<McpToolSchemaResult>;
  callTool(
    args: AbortableArgs & {
      id: string;
      args: Record<string, unknown>;
      threadId: string | null;
    },
  ): Promise<McpCallResult>;
  searchPrompts(args?: McpSearchArgs): Promise<McpPromptRowResult[]>;
  getPrompt(
    args: AbortableArgs & { id: string; args: Record<string, unknown> },
  ): Promise<Record<string, unknown>>;
  searchResources(args?: McpSearchArgs): Promise<McpResourceRowResult[]>;
  readResource(
    args: AbortableArgs & { id: string },
  ): Promise<Record<string, unknown>>;
  providerStatus(args?: McpProviderArgs): Promise<McpProviderStatusResult>;
  fixProviders(args?: McpProviderArgs): Promise<McpProviderStatusResult>;
}

function serverPath(server: string, suffix = ""): string {
  return `/api/v1/mcp/servers/${encodeURIComponent(server)}${suffix}`;
}

function withQuery(
  path: string,
  values: Record<string, string | undefined>,
): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== "") query.set(key, value);
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

export function createMcpArea(args: CreateSdkAreaArgs): McpArea {
  const { transport } = args;

  async function request<T>(
    path: string,
    schema: { parse(value: unknown): T },
    init?: RequestInit,
  ): Promise<T> {
    const baseUrl = transport.baseUrl.replace(/\/$/u, "");
    const response = await transport.resolve(
      transport.fetch(`${baseUrl}${path}`, init),
    );
    return schema.parse(await response.json());
  }

  function send<T>(
    method: string,
    path: string,
    schema: { parse(value: unknown): T },
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<T> {
    return request(path, schema, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
      ...(signal ? { signal } : {}),
    });
  }

  async function list(input?: McpListArgs): Promise<McpServerSummaryResult[]>;
  async function list(
    input: McpListDetailsArgs,
  ): Promise<McpServerRecordResult[]>;
  async function list(
    input: McpListArgs | McpListDetailsArgs = {},
  ): Promise<McpServerSummaryResult[] | McpServerRecordResult[]> {
    if (input.details === true) {
      return (
        await send(
          "GET",
          "/api/v1/mcp/servers?details=true",
          mcpServerListSchema,
          undefined,
          input.signal,
        )
      ).servers;
    }
    return (
      await send(
        "GET",
        "/api/v1/mcp/servers",
        mcpServerSummaryListSchema,
        undefined,
        input.signal,
      )
    ).servers;
  }

  return {
    list,
    get: (input) =>
      send(
        "GET",
        serverPath(input.server),
        mcpServerSchema,
        undefined,
        input.signal,
      ),
    add: (input) =>
      send(
        "POST",
        "/api/v1/mcp/servers",
        mcpAddServerResponseSchema,
        mcpAddServerRequestSchema.parse(input),
      ),
    remove: (input) =>
      send(
        "DELETE",
        serverPath(input.server),
        mcpRemoveServerResponseSchema,
        undefined,
        input.signal,
      ),
    setEnabled: (input) =>
      send(
        "PUT",
        serverPath(input.server, "/enabled"),
        mcpSetEnabledResponseSchema,
        { enabled: input.enabled },
        input.signal,
      ),
    setHeaders: (input) =>
      send(
        "PUT",
        serverPath(input.server, "/headers"),
        mcpServerSchema,
        { headers: input.headers },
        input.signal,
      ),
    setGuide: (input) =>
      send(
        "PUT",
        serverPath(input.server, "/guide"),
        mcpGuideResponseSchema,
        { guide: input.guide },
        input.signal,
      ),
    authenticate: (input) =>
      send(
        "POST",
        serverPath(input.server, "/auth"),
        mcpAuthResponseSchema,
        undefined,
        input.signal,
      ),
    reconnect: (input) =>
      send(
        "POST",
        serverPath(input.server, "/reconnect"),
        mcpAuthResponseSchema,
        undefined,
        input.signal,
      ),
    cancelAuthentication: (input) =>
      send(
        "POST",
        serverPath(input.server, "/auth/cancel"),
        mcpCancelAuthResponseSchema,
        undefined,
        input.signal,
      ),
    serverTools: (input) =>
      send(
        "GET",
        serverPath(input.server, "/tools"),
        mcpServerToolsResponseSchema,
        undefined,
        input.signal,
      ),
    listPolicies: async (input) =>
      (
        await send(
          "GET",
          serverPath(input.server, "/policies"),
          mcpToolPoliciesResponseSchema,
          undefined,
          input.signal,
        )
      ).tools,
    setPolicy: (input) =>
      send(
        "PUT",
        serverPath(input.server, "/policies"),
        mcpToolPolicySchema,
        { tool: input.tool, mode: input.mode },
        input.signal,
      ),
    searchRegistry: async (input) => {
      const path = withQuery("/api/v1/mcp/registry", {
        q: input.query,
        limit: input.limit === undefined ? undefined : String(input.limit),
        remoteOnly: input.remoteOnly ? "true" : undefined,
      });
      return (
        await send(
          "GET",
          path,
          mcpRegistrySearchResponseSchema,
          undefined,
          input.signal,
        )
      ).servers;
    },
    searchTools: (input) =>
      send(
        "GET",
        withQuery("/api/v1/mcp/tools/search", {
          q: input.query,
          limit: input.limit === undefined ? undefined : String(input.limit),
          server: input.server,
        }),
        mcpToolSearchResponseSchema,
        undefined,
        input.signal,
      ),
    toolSchema: (input) =>
      send(
        "GET",
        `/api/v1/mcp/tools/${encodeURIComponent(input.id)}/schema`,
        mcpToolSchemaResponseSchema,
        undefined,
        input.signal,
      ),
    callTool: (input) =>
      send(
        "POST",
        "/api/v1/mcp/tools/call",
        mcpCallResultSchema,
        { id: input.id, args: input.args, threadId: input.threadId },
        input.signal,
      ),
    searchPrompts: async (input = {}) =>
      (
        await send(
          "GET",
          withQuery("/api/v1/mcp/prompts", {
            q: input.query,
            server: input.server,
          }),
          mcpPromptsResponseSchema,
          undefined,
          input.signal,
        )
      ).prompts,
    getPrompt: (input) =>
      send(
        "POST",
        "/api/v1/mcp/prompts/get",
        mcpRecordResponseSchema,
        { id: input.id, args: input.args },
        input.signal,
      ),
    searchResources: async (input = {}) =>
      (
        await send(
          "GET",
          withQuery("/api/v1/mcp/resources", {
            q: input.query,
            server: input.server,
          }),
          mcpResourcesResponseSchema,
          undefined,
          input.signal,
        )
      ).resources,
    readResource: (input) =>
      send(
        "POST",
        "/api/v1/mcp/resources/read",
        mcpRecordResponseSchema,
        { id: input.id },
        input.signal,
      ),
    providerStatus: (input = {}) =>
      send(
        "GET",
        withQuery("/api/v1/mcp/providers", {
          hostId: input.hostId,
          projectPath: input.projectPath,
        }),
        mcpProviderStatusResponseSchema,
        undefined,
        input.signal,
      ),
    fixProviders: (input = {}) =>
      send(
        "POST",
        "/api/v1/mcp/providers/fix",
        mcpProviderStatusResponseSchema,
        {
          hostId: input.hostId ?? null,
          projectPath: input.projectPath ?? null,
        },
        input.signal,
      ),
  };
}
