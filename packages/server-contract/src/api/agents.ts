import {
  AGENT_DESCRIPTION_MAX_CHARS,
  AGENT_INSTRUCTIONS_MAX_CHARS,
  AGENT_NAME_MAX_CHARS,
  agentColorSchema,
  agentMascotSchema,
  agentSchema,
  reasoningLevelSchema,
} from "@bb/domain";
import { z } from "zod";

const agentNameSchema = z.string().trim().min(1).max(AGENT_NAME_MAX_CHARS);
const agentNameListSchema = z
  .array(z.string().trim().min(1).max(200))
  .max(200)
  .transform((names) => [...new Set(names)]);

export const agentResponseSchema = agentSchema
  .extend({ homePath: z.string() })
  .strict();
export type AgentResponse = z.infer<typeof agentResponseSchema>;

export const agentListResponseSchema = z
  .object({ agents: z.array(agentResponseSchema) })
  .strict();
export type AgentListResponse = z.infer<typeof agentListResponseSchema>;

export const createAgentRequestSchema = z
  .object({
    name: agentNameSchema,
    description: z.string().trim().max(AGENT_DESCRIPTION_MAX_CHARS).optional(),
    providerId: z.string().trim().min(1).optional(),
    model: z.string().trim().min(1).nullable().optional(),
    reasoningLevel: reasoningLevelSchema.optional(),
    skills: agentNameListSchema.optional(),
    mcpServers: agentNameListSchema.optional(),
    instructions: z.string().max(AGENT_INSTRUCTIONS_MAX_CHARS).optional(),
    mascot: agentMascotSchema.optional(),
    color: agentColorSchema.optional(),
  })
  .strict();
export type CreateAgentRequest = z.input<typeof createAgentRequestSchema>;

export const updateAgentRequestSchema = z
  .object({
    name: agentNameSchema,
    description: z.string().trim().max(AGENT_DESCRIPTION_MAX_CHARS),
    providerId: z.string().trim().min(1),
    model: z.string().trim().min(1).nullable(),
    reasoningLevel: reasoningLevelSchema,
    skills: agentNameListSchema,
    mcpServers: agentNameListSchema,
    instructions: z.string().max(AGENT_INSTRUCTIONS_MAX_CHARS),
    mascot: agentMascotSchema,
    color: agentColorSchema,
  })
  .partial()
  .strict()
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    "At least one field must be provided",
  );
export type UpdateAgentRequest = z.input<typeof updateAgentRequestSchema>;

export const deleteAgentResponseSchema = z
  .object({ deleted: z.literal(true), id: z.string() })
  .strict();
export type DeleteAgentResponse = z.infer<typeof deleteAgentResponseSchema>;
