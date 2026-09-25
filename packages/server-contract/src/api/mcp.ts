import { mcpToolRiskSchema } from "@bb/domain";
import { z } from "zod";

const stringRecordSchema = z.record(z.string(), z.string());
const jsonRecordSchema = z.record(z.string(), z.unknown());

export const MCP_GUIDE_MAX_CHARS = 4000;

export const mcpServerTypeSchema = z.enum(["stdio", "streamable-http", "sse"]);
export type McpServerTypeValue = z.infer<typeof mcpServerTypeSchema>;

export const mcpServerStatusSchema = z.enum([
  "idle",
  "ready",
  "error",
  "disabled",
  "needs-auth",
]);

export const mcpAuthStatusSchema = z.enum([
  "not-applicable",
  "unknown",
  "unauthenticated",
  "authorizing",
  "authenticated",
]);
export type McpAuthStatusValue = z.infer<typeof mcpAuthStatusSchema>;

export const mcpPolicyModeSchema = z.enum([
  "inherit",
  "allow",
  "confirm",
  "deny",
]);
export const mcpEffectivePolicySchema = z.enum(["allow", "confirm", "deny"]);

export const mcpServerConfigViewSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("stdio"),
      command: z.string(),
      args: z.array(z.string()),
      env: stringRecordSchema,
      cwd: z.string().nullable(),
    })
    .strict(),
  z
    .object({
      type: z.enum(["streamable-http", "sse"]),
      url: z.string(),
      headers: stringRecordSchema,
    })
    .strict(),
]);
export type McpServerConfigView = z.infer<typeof mcpServerConfigViewSchema>;

export const mcpServerSchema = z
  .object({
    id: z.string(),
    handle: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    type: mcpServerTypeSchema,
    status: mcpServerStatusSchema,
    sourceKind: z.enum(["manual", "registry"]),
    enabled: z.boolean(),
    authStatus: mcpAuthStatusSchema,
    lastError: z.string().nullable(),
    sourceRef: z.string().nullable(),
    registryName: z.string().nullable(),
    registryVersion: z.string().nullable(),
    config: mcpServerConfigViewSchema,
    toolCount: z.number().int().nullable(),
    promptCount: z.number().int().nullable(),
    resourceCount: z.number().int().nullable(),
    guide: z.string().nullable(),
  })
  .strict();
export type McpServer = z.infer<typeof mcpServerSchema>;

export const mcpServerSummarySchema = z
  .object({
    id: z.string(),
    handle: z.string(),
    type: mcpServerTypeSchema,
    status: mcpServerStatusSchema,
    tools: z.number().int().optional(),
  })
  .strict();
export type McpServerSummary = z.infer<typeof mcpServerSummarySchema>;

export const mcpServerSummaryListSchema = z
  .object({ servers: z.array(mcpServerSummarySchema) })
  .strict();
export const mcpServerListSchema = z
  .object({ servers: z.array(mcpServerSchema) })
  .strict();

export const mcpAddServerRequestSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("registry"),
      registryName: z.string().trim().min(1).max(512),
      name: z.string().trim().min(1).max(200).optional(),
      headers: stringRecordSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("http"),
      url: z.string().trim().min(1).max(4096),
      transport: z.enum(["streamable-http", "sse"]),
      name: z.string().trim().min(1).max(200).optional(),
      headers: stringRecordSchema.optional(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("stdio"),
      name: z.string().trim().min(1).max(200),
      command: z.string().min(1).max(1024),
      args: z.array(z.string().max(16_384)).max(256),
      env: stringRecordSchema.optional(),
      cwd: z.string().min(1).max(4096).optional(),
    })
    .strict(),
]);
export type McpAddServerRequest = z.infer<typeof mcpAddServerRequestSchema>;

export const mcpAddServerResponseSchema = z
  .object({ id: z.string(), handle: z.string(), name: z.string() })
  .strict();
export type McpAddServerResponse = z.infer<typeof mcpAddServerResponseSchema>;

export const mcpRemoveServerResponseSchema = z
  .object({ deleted: z.boolean(), id: z.string() })
  .strict();

export const mcpSetEnabledRequestSchema = z
  .object({ enabled: z.boolean() })
  .strict();
export const mcpSetEnabledResponseSchema = z
  .object({ enabled: z.boolean(), status: mcpServerStatusSchema })
  .strict();

export const mcpSetHeadersRequestSchema = z
  .object({ headers: stringRecordSchema })
  .strict();

export const mcpSetGuideRequestSchema = z
  .object({ guide: z.string().max(MCP_GUIDE_MAX_CHARS).nullable() })
  .strict();
export const mcpGuideResponseSchema = z
  .object({ id: z.string(), handle: z.string(), guide: z.string().nullable() })
  .strict();

export const mcpCancelAuthResponseSchema = z
  .object({ canceled: z.boolean() })
  .strict();

export const mcpAuthResponseSchema = z
  .object({ url: z.string().nullable(), status: mcpAuthStatusSchema })
  .strict();
export type McpAuthResponse = z.infer<typeof mcpAuthResponseSchema>;

export const mcpToolCardSchema = z
  .object({
    truncated: z.boolean().optional(),
    shape: z.string(),
    fields: z.array(
      z
        .object({
          name: z.string(),
          type: z.string(),
          required: z.boolean(),
          enum: z.array(z.string()).optional(),
        })
        .strict(),
    ),
    example: jsonRecordSchema,
  })
  .strict();

export const mcpCompactToolSchema = z
  .object({
    schemaRequired: z.boolean().optional(),
    id: z.string(),
    sourceId: z.string(),
    handle: z.string(),
    name: z.string(),
    description: z.string(),
    risk: mcpToolRiskSchema,
    card: mcpToolCardSchema.optional(),
  })
  .strict();

export const mcpServerToolsResponseSchema = z
  .object({
    tools: z.array(mcpCompactToolSchema),
    error: z.string().nullable(),
  })
  .strict();

export const mcpToolRowSchema = z
  .object({
    id: z.string(),
    server: z.string(),
    name: z.string(),
    description: z.string(),
    risk: z.enum(["write", "destructive"]).optional(),
    policy: z.enum(["confirm", "deny"]).optional(),
    input: stringRecordSchema.optional(),
    schemaRequired: z.literal(true).optional(),
  })
  .strict();
export type McpToolRow = z.infer<typeof mcpToolRowSchema>;

export const mcpToolSearchResponseSchema = z
  .object({
    tools: z.array(mcpToolRowSchema),
    unavailable: z.array(z.string()).optional(),
  })
  .strict();
export type McpToolSearchResponse = z.infer<typeof mcpToolSearchResponseSchema>;

export const mcpToolSchemaResponseSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    risk: mcpToolRiskSchema,
    inputSchema: jsonRecordSchema,
  })
  .strict();

export const mcpCallRequestSchema = z
  .object({
    id: z.string().trim().min(1),
    args: jsonRecordSchema,
    threadId: z.string().min(1).nullable(),
  })
  .strict();
export type McpCallRequest = z.infer<typeof mcpCallRequestSchema>;

export const mcpCallResultSchema = z.union([
  z
    .object({
      content: z.array(jsonRecordSchema),
      isError: z.boolean().optional(),
      structuredContent: z.unknown().optional(),
      _meta: jsonRecordSchema.optional(),
    })
    .strict(),
  z.object({ isError: z.literal(true), error: z.string() }).strict(),
]);
export type McpCallResultResponse = z.infer<typeof mcpCallResultSchema>;

export const mcpToolPolicySchema = z
  .object({
    tool: z.string(),
    risk: mcpToolRiskSchema,
    mode: mcpPolicyModeSchema,
    policy: mcpEffectivePolicySchema,
  })
  .strict();
export type McpToolPolicy = z.infer<typeof mcpToolPolicySchema>;

export const mcpToolPoliciesResponseSchema = z
  .object({ tools: z.array(mcpToolPolicySchema) })
  .strict();

export const mcpSetToolPolicyRequestSchema = z
  .object({ tool: z.string().min(1).max(512), mode: mcpPolicyModeSchema })
  .strict();

export const mcpPromptRowSchema = z
  .object({
    id: z.string(),
    server: z.string(),
    name: z.string(),
    description: z.string(),
  })
  .strict();
export const mcpPromptsResponseSchema = z
  .object({ prompts: z.array(mcpPromptRowSchema) })
  .strict();

export const mcpResourceRowSchema = z
  .object({
    id: z.string(),
    server: z.string(),
    uri: z.string(),
    name: z.string(),
  })
  .strict();
export const mcpResourcesResponseSchema = z
  .object({ resources: z.array(mcpResourceRowSchema) })
  .strict();

export const mcpGetPromptRequestSchema = z
  .object({ id: z.string().trim().min(1), args: jsonRecordSchema })
  .strict();
export const mcpReadResourceRequestSchema = z
  .object({ id: z.string().trim().min(1) })
  .strict();
export const mcpRecordResponseSchema = jsonRecordSchema;

export const mcpRegistryHitSchema = z
  .object({
    name: z.string(),
    description: z.string(),
    version: z.string(),
    status: z.string(),
    installable: z.boolean(),
    sourceRef: z.string().nullable(),
    type: mcpServerTypeSchema.nullable(),
    remote: z.boolean(),
    requiredHeaders: z.array(z.string()),
  })
  .strict();
export type McpRegistryHit = z.infer<typeof mcpRegistryHitSchema>;
export const mcpRegistrySearchResponseSchema = z
  .object({ servers: z.array(mcpRegistryHitSchema) })
  .strict();

const mcpProviderEntrySchema = z
  .object({ name: z.string(), file: z.string(), scope: z.string() })
  .strict();

export const mcpProviderStatusResponseSchema = z
  .object({
    hostId: z.string(),
    status: z
      .object({
        claude: z
          .object({
            settingsPath: z.string(),
            connectorsDisabled: z.boolean(),
            mcpServers: z.array(mcpProviderEntrySchema),
          })
          .strict(),
        codex: z
          .object({
            configPath: z.string(),
            mcpServers: z.array(mcpProviderEntrySchema),
          })
          .strict(),
      })
      .strict(),
    issues: z.array(
      z
        .object({ provider: z.enum(["claude", "codex"]), message: z.string() })
        .strict(),
    ),
    text: z.string(),
  })
  .strict();
export type McpProviderStatusResponse = z.infer<
  typeof mcpProviderStatusResponseSchema
>;

export const mcpProviderFixRequestSchema = z
  .object({
    hostId: z.string().min(1).nullable(),
    projectPath: z.string().min(1).nullable(),
  })
  .strict();
