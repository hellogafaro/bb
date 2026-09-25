import { z } from "zod";

export const APPROVAL_RENDERER_ID = "mcp-approval";

export const elicitationFieldSchema = z.object({
  name: z.string(),
  title: z.string().nullable(),
  description: z.string().nullable(),
  type: z.enum(["string", "number", "integer", "boolean"]),
  options: z.array(z.object({ value: z.string(), label: z.string() })).nullable(),
  required: z.boolean(),
  defaultValue: z.union([z.string(), z.number(), z.boolean()]).nullable(),
}).strict();

export const toolApprovalPayloadSchema = z.object({
  kind: z.literal("tool"),
  server: z.string(),
  tool: z.string(),
  risk: z.enum(["read", "write", "destructive"]),
  args: z.string(),
  truncated: z.boolean(),
}).strict();

export const elicitationPayloadSchema = z.object({
  kind: z.literal("elicitation"),
  server: z.string(),
  message: z.string(),
  fields: z.array(elicitationFieldSchema),
}).strict();

export const approvalPayloadSchema = z.discriminatedUnion("kind", [toolApprovalPayloadSchema, elicitationPayloadSchema]);

export const toolApprovalResponseSchema = z.object({ allowed: z.boolean() }).strict();

export const elicitationValueSchema = z.union([z.string(), z.number(), z.boolean()]);

export const elicitationResponseSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("accept"), content: z.record(z.string(), elicitationValueSchema) }).strict(),
  z.object({ action: z.literal("decline") }).strict(),
]);

export type ElicitationField = z.infer<typeof elicitationFieldSchema>;
