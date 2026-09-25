import type {
  DynamicTool,
  ThreadEventItemPresentation,
  ToolCallResponse,
} from "@bb/domain";
import { z } from "zod";
import { agentData, agentReply } from "../mcp/agent-output.js";
import {
  SCHEMA_INLINE_CHARS,
  SEARCH_LIMIT,
  SEARCH_MAX,
  writeArtifact,
} from "../mcp/catalog.js";
import { classifyTool } from "../mcp/policy.js";
import type { McpService } from "../mcp/service.js";
import type { JsonRecord } from "../mcp/types.js";

export const MCP_TOOL_NAMES = [
  "mcp_servers",
  "mcp_search",
  "mcp_schema",
  "mcp_call",
  "mcp_prompts",
  "mcp_get_prompt",
  "mcp_resources",
  "mcp_read_resource",
] as const;
export type McpToolName = (typeof MCP_TOOL_NAMES)[number];

export interface McpToolContext {
  threadId: string;
  signal: AbortSignal;
}

interface McpAgentTool<Schema extends z.ZodType> {
  name: McpToolName;
  description: string;
  instructions: string | null;
  presentation: ThreadEventItemPresentation;
  parameters: Schema;
  execute(
    service: McpService,
    input: z.output<Schema>,
    ctx: McpToolContext,
  ): Promise<ToolCallResponse>;
}

const idSchema = z.string().trim().min(1).describe("ID from discovery.");
const jsonRecordSchema = z.record(z.string(), z.unknown());

function label(
  pending: string,
  completed: string,
): ThreadEventItemPresentation {
  return { label: { pending, completed }, icon: { glyph: "Layers" } };
}

function defineTool<Schema extends z.ZodType>(
  tool: McpAgentTool<Schema>,
): McpAgentTool<Schema> {
  return tool;
}

const serversTool = defineTool({
  name: "mcp_servers",
  description:
    "List installed MCPs with stable IDs, handles, status and known tool counts. Paginated; details opt-in.",
  instructions:
    "Use only to inspect installed servers, status, or handles. mcp_search does not require this first.",
  presentation: label("Listing MCP servers", "Listed MCP servers"),
  parameters: z
    .object({
      query: z.string().max(200).optional(),
      limit: z.number().int().min(1).max(50).default(20),
      cursor: z.number().int().min(0).default(0),
      details: z.boolean().default(false),
    })
    .strict(),
  async execute(service, { query, limit, cursor, details }) {
    const records = service.store.list();
    const q = query?.toLowerCase();
    const matched =
      q === undefined
        ? records
        : records.filter(
            (record) =>
              record.id === query ||
              record.handle.includes(q) ||
              record.name.toLowerCase().includes(q),
          );
    const rows = matched.map((record) => {
      const counts = service.gateway.catalogCounts(record.id);
      return {
        id: record.id,
        handle: record.handle,
        type: record.type,
        status: record.status,
        ...(counts ? { tools: counts.tools } : {}),
        ...(details
          ? {
              name: record.name,
              ...(record.description
                ? { description: record.description }
                : {}),
              sourceKind: record.sourceKind,
              ...(counts
                ? { prompts: counts.prompts, resources: counts.resources }
                : {}),
              ...(record.lastError ? { error: record.lastError } : {}),
            }
          : {}),
      };
    });
    rows.sort((a, b) => a.handle.localeCompare(b.handle));
    const servers = rows.slice(cursor, cursor + limit);
    return agentData(
      {
        servers,
        ...(cursor + limit < rows.length ? { nextCursor: cursor + limit } : {}),
      },
      "servers",
      service.artifactDir(),
    );
  },
});

const searchTool = defineTool({
  name: "mcp_search",
  description:
    "Search MCP tools directly; returns id, server handle, description and input fields (? optional, dots nested). Default 5 results; optional limit is capped at 12.",
  instructions:
    "Do not list servers first. Search a short capability phrase, optionally filtering by a known server ID or handle. Do not repeat an unchanged query after it succeeds. Usually omit limit; oversized values are capped. Call by id. Request mcp_schema only for missing constraints or schemaRequired results.",
  presentation: label("Searching MCP tools", "Searched MCP tools"),
  parameters: z
    .object({
      query: z.string().trim().min(1).max(200),
      server: z.string().max(128).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Desired result count; values above 12 are capped. Usually omit.",
        ),
    })
    .strict(),
  async execute(service, { query, limit, server }) {
    const result = await service.admin.searchTools(
      query,
      Math.min(limit ?? SEARCH_LIMIT, SEARCH_MAX),
      server ?? null,
    );
    return agentData(result, "search", service.artifactDir());
  },
});

const schemaTool = defineTool({
  name: "mcp_schema",
  description:
    "Get one tool's full description and input schema by id. Large schemas are saved as artifacts.",
  instructions:
    "Use when search input is insufficient. Read artifactPath for schemas too large to inline.",
  presentation: label("Loading MCP schema", "Loaded MCP schema"),
  parameters: z.object({ id: idSchema }).strict(),
  async execute(service, { id }) {
    const tool = await service.gateway.getTool(id);
    const schemaJson = JSON.stringify(tool.inputSchema);
    const payload: JsonRecord = {
      id: tool.id,
      name: tool.name,
      description: tool.description,
      risk: classifyTool(tool.annotations),
    };
    if (schemaJson.length <= SCHEMA_INLINE_CHARS)
      payload.inputSchema = tool.inputSchema;
    else {
      payload.bytes = Buffer.byteLength(schemaJson, "utf8");
      payload.artifactPath = await writeArtifact(
        JSON.stringify(tool.inputSchema, null, 2),
        { artifactDir: service.artifactDir(), name: "schema" },
      );
    }
    return agentData(payload, "schema", service.artifactDir());
  },
});

const callTool = defineTool({
  name: "mcp_call",
  description: "Call one MCP tool by id. Does not re-list the catalog.",
  instructions:
    "Use id from mcp_search. Report the result to the user; the UI may show only a success envelope.",
  presentation: label("Calling MCP tool", "Called MCP tool"),
  parameters: z
    .object({ id: idSchema, args: jsonRecordSchema.default({}) })
    .strict(),
  async execute(service, { id, args }, ctx) {
    const result = await service.invokeTool(id, args, {
      threadId: ctx.threadId,
      signal: ctx.signal,
    });
    return agentReply(result, "call", service.artifactDir());
  },
});

const promptsTool = defineTool({
  name: "mcp_prompts",
  description: "Search compact MCP prompts. Pass query; default 5 hits.",
  instructions: null,
  presentation: label("Searching MCP prompts", "Searched MCP prompts"),
  parameters: z
    .object({
      query: z.string().trim().max(200).optional(),
      server: z.string().max(128).optional(),
    })
    .strict(),
  async execute(service, { query, server }) {
    return agentData(
      {
        prompts: await service.admin.searchPrompts(query ?? "", server ?? null),
      },
      "prompts",
      service.artifactDir(),
    );
  },
});

const getPromptTool = defineTool({
  name: "mcp_get_prompt",
  description: "Get one MCP prompt by id.",
  instructions: "Use id from mcp_prompts.",
  presentation: label("Getting MCP prompt", "Got MCP prompt"),
  parameters: z
    .object({ id: idSchema, args: jsonRecordSchema.default({}) })
    .strict(),
  async execute(service, { id, args }, ctx) {
    return agentReply(
      await service.gateway.getPrompt(id, args, ctx.signal),
      "prompt",
      service.artifactDir(),
    );
  },
});

const resourcesTool = defineTool({
  name: "mcp_resources",
  description: "Search compact MCP resources. Pass query; default 5 hits.",
  instructions: null,
  presentation: label("Searching MCP resources", "Searched MCP resources"),
  parameters: z
    .object({
      query: z.string().trim().max(200).optional(),
      server: z.string().max(128).optional(),
    })
    .strict(),
  async execute(service, { query, server }) {
    return agentData(
      {
        resources: await service.admin.searchResources(
          query ?? "",
          server ?? null,
        ),
      },
      "resources",
      service.artifactDir(),
    );
  },
});

const readResourceTool = defineTool({
  name: "mcp_read_resource",
  description: "Read one MCP resource by id.",
  instructions: "Use id from mcp_resources.",
  presentation: label("Reading MCP resource", "Read MCP resource"),
  parameters: z.object({ id: idSchema }).strict(),
  async execute(service, { id }, ctx) {
    return agentReply(
      await service.gateway.readResource(id, ctx.signal),
      "resource",
      service.artifactDir(),
    );
  },
});

const MCP_AGENT_TOOLS = {
  mcp_servers: serversTool,
  mcp_search: searchTool,
  mcp_schema: schemaTool,
  mcp_call: callTool,
  mcp_prompts: promptsTool,
  mcp_get_prompt: getPromptTool,
  mcp_resources: resourcesTool,
  mcp_read_resource: readResourceTool,
} satisfies Record<McpToolName, McpAgentTool<z.ZodType>>;

export function isMcpToolName(name: string): name is McpToolName {
  return Object.hasOwn(MCP_AGENT_TOOLS, name);
}

export interface McpDynamicToolContribution {
  tool: DynamicTool;
  instructions: string | null;
}

export function mcpDynamicToolContributions(): McpDynamicToolContribution[] {
  return MCP_TOOL_NAMES.map((name) => {
    const definition = MCP_AGENT_TOOLS[name];
    return {
      tool: {
        name: definition.name,
        description: definition.description,
        inputSchema: z.toJSONSchema(definition.parameters, { io: "input" }),
        presentation: definition.presentation,
      },
      instructions: definition.instructions,
    };
  });
}

function failure(text: string): ToolCallResponse {
  return { success: false, contentItems: [{ type: "inputText", text }] };
}

async function run<Schema extends z.ZodType>(
  tool: McpAgentTool<Schema>,
  service: McpService,
  input: unknown,
  ctx: McpToolContext,
): Promise<ToolCallResponse> {
  const parsed = tool.parameters.safeParse(input);
  if (!parsed.success) {
    return failure(
      `Invalid ${tool.name} input: ${parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; ")}`,
    );
  }
  return tool.execute(service, parsed.data, ctx);
}

export function executeMcpToolCall(
  service: McpService,
  args: { name: McpToolName; input: unknown; ctx: McpToolContext },
): Promise<ToolCallResponse> {
  switch (args.name) {
    case "mcp_servers":
      return run(serversTool, service, args.input, args.ctx);
    case "mcp_search":
      return run(searchTool, service, args.input, args.ctx);
    case "mcp_schema":
      return run(schemaTool, service, args.input, args.ctx);
    case "mcp_call":
      return run(callTool, service, args.input, args.ctx);
    case "mcp_prompts":
      return run(promptsTool, service, args.input, args.ctx);
    case "mcp_get_prompt":
      return run(getPromptTool, service, args.input, args.ctx);
    case "mcp_resources":
      return run(resourcesTool, service, args.input, args.ctx);
    case "mcp_read_resource":
      return run(readResourceTool, service, args.input, args.ctx);
  }
}
