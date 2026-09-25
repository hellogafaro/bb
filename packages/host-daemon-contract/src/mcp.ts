import { z } from "zod";

const mcpServerIdSchema = z.string().min(1).max(128);
const mcpJsonRecordSchema = z.record(z.string(), z.unknown());
const mcpPathSchema = z.string().min(1).max(16_384);

export const mcpStdioCatalogSchema = z
  .object({
    tools: z.array(mcpJsonRecordSchema),
    prompts: z.array(mcpJsonRecordSchema),
    resources: z.array(mcpJsonRecordSchema),
    resourceTemplates: z.array(mcpJsonRecordSchema),
  })
  .strict();
export type McpStdioCatalog = z.infer<typeof mcpStdioCatalogSchema>;

export const mcpCommandSchemas = {
  "mcp.stdio.start": z
    .object({
      type: z.literal("mcp.stdio.start"),
      id: mcpServerIdSchema,
      command: mcpPathSchema,
      args: z.array(z.string().max(16_384)).max(256),
      cwd: mcpPathSchema,
      env: z.record(z.string(), z.string().max(16_384)),
    })
    .strict(),
  "mcp.stdio.refresh": z
    .object({ type: z.literal("mcp.stdio.refresh"), id: mcpServerIdSchema })
    .strict(),
  "mcp.stdio.close": z
    .object({ type: z.literal("mcp.stdio.close"), id: mcpServerIdSchema })
    .strict(),
  "mcp.stdio.callTool": z
    .object({
      type: z.literal("mcp.stdio.callTool"),
      id: mcpServerIdSchema,
      name: z.string().min(1).max(512),
      args: mcpJsonRecordSchema,
      toolDefinition: mcpJsonRecordSchema.nullable(),
    })
    .strict(),
  "mcp.stdio.getPrompt": z
    .object({
      type: z.literal("mcp.stdio.getPrompt"),
      id: mcpServerIdSchema,
      name: z.string().min(1).max(512),
      args: z.record(z.string(), z.string()),
    })
    .strict(),
  "mcp.stdio.readResource": z
    .object({
      type: z.literal("mcp.stdio.readResource"),
      id: mcpServerIdSchema,
      uri: mcpPathSchema,
    })
    .strict(),
} as const;

export const mcpResultSchemas = {
  "mcp.stdio.start": mcpStdioCatalogSchema,
  "mcp.stdio.refresh": mcpStdioCatalogSchema,
  "mcp.stdio.close": z.object({ closed: z.boolean() }).strict(),
  "mcp.stdio.callTool": mcpJsonRecordSchema,
  "mcp.stdio.getPrompt": mcpJsonRecordSchema,
  "mcp.stdio.readResource": mcpJsonRecordSchema,
} as const;

export const mcpCatalogChangedMessageSchema = z
  .object({
    type: z.literal("mcp.catalog-changed"),
    id: mcpServerIdSchema,
    kind: z.enum(["tools", "prompts", "resources"]),
    error: z.string().nullable(),
  })
  .strict();
export type McpCatalogChangedMessage = z.infer<
  typeof mcpCatalogChangedMessageSchema
>;

export const mcpConnectionChangedMessageSchema = z
  .object({
    type: z.literal("mcp.connection-changed"),
    id: mcpServerIdSchema,
    status: z.enum(["closed", "error"]),
    error: z.string().nullable(),
  })
  .strict();
export type McpConnectionChangedMessage = z.infer<
  typeof mcpConnectionChangedMessageSchema
>;
