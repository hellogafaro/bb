import { z } from "zod";
import { PLUGIN_INTERACTION_MAX_TITLE_LENGTH } from "./plugin-interaction-limits.js";

export const mcpToolRiskSchema = z.enum(["read", "write", "destructive"]);
export type McpToolRisk = z.infer<typeof mcpToolRiskSchema>;

export const mcpElicitationFieldSchema = z
  .object({
    name: z.string(),
    title: z.string().nullable(),
    description: z.string().nullable(),
    type: z.enum(["string", "number", "integer", "boolean"]),
    options: z
      .array(z.object({ value: z.string(), label: z.string() }).strict())
      .nullable(),
    required: z.boolean(),
    defaultValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
  })
  .strict();
export type McpElicitationField = z.infer<typeof mcpElicitationFieldSchema>;

const titleSchema = z
  .string()
  .trim()
  .min(1)
  .max(PLUGIN_INTERACTION_MAX_TITLE_LENGTH);

export const mcpApprovalPendingInteractionPayloadSchema = z
  .object({
    kind: z.literal("mcp_approval"),
    title: titleSchema,
    server: z.string(),
    tool: z.string(),
    risk: mcpToolRiskSchema,
    args: z.string(),
    truncated: z.boolean(),
  })
  .strict();
export type McpApprovalPendingInteractionPayload = z.infer<
  typeof mcpApprovalPendingInteractionPayloadSchema
>;

export const mcpElicitationPendingInteractionPayloadSchema = z
  .object({
    kind: z.literal("mcp_elicitation"),
    title: titleSchema,
    server: z.string(),
    message: z.string(),
    fields: z.array(mcpElicitationFieldSchema),
  })
  .strict();
export type McpElicitationPendingInteractionPayload = z.infer<
  typeof mcpElicitationPendingInteractionPayloadSchema
>;

export const corePendingInteractionPayloadSchema = z.discriminatedUnion(
  "kind",
  [
    mcpApprovalPendingInteractionPayloadSchema,
    mcpElicitationPendingInteractionPayloadSchema,
  ],
);
export type CorePendingInteractionPayload = z.infer<
  typeof corePendingInteractionPayloadSchema
>;

export const mcpElicitationValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
]);

export const mcpApprovalResolutionSchema = z
  .object({
    kind: z.literal("mcp_approval"),
    allowed: z.boolean(),
  })
  .strict();
export type McpApprovalResolution = z.infer<typeof mcpApprovalResolutionSchema>;

export const mcpElicitationResolutionSchema = z.union([
  z
    .object({
      kind: z.literal("mcp_elicitation"),
      action: z.literal("accept"),
      content: z.record(z.string(), mcpElicitationValueSchema),
    })
    .strict(),
  z
    .object({
      kind: z.literal("mcp_elicitation"),
      action: z.literal("decline"),
    })
    .strict(),
]);
export type McpElicitationResolution = z.infer<
  typeof mcpElicitationResolutionSchema
>;

export const corePendingInteractionResolutionSchema = z.union([
  mcpApprovalResolutionSchema,
  mcpElicitationResolutionSchema,
]);
export type CorePendingInteractionResolution = z.infer<
  typeof corePendingInteractionResolutionSchema
>;

export const pendingInteractionCoreOriginSchema = z
  .object({ kind: z.literal("core") })
  .strict();

export function isCorePendingInteractionPayloadKind(
  kind: string,
): kind is CorePendingInteractionPayload["kind"] {
  return kind === "mcp_approval" || kind === "mcp_elicitation";
}
