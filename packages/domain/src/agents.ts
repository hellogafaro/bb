import { z } from "zod";
import { reasoningLevelSchema } from "./shared-types.js";

export const AGENT_NAME_MAX_CHARS = 80;
export const AGENT_DESCRIPTION_MAX_CHARS = 500;
export const AGENT_INSTRUCTIONS_MAX_CHARS = 20_000;
export const AGENT_PERMISSION_MODE = "full";
export const DEFAULT_AGENT_NAME = "BB";

export const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    providerId: z.string(),
    model: z.string().nullable(),
    reasoningLevel: reasoningLevelSchema,
    skills: z.array(z.string()),
    mcpServers: z.array(z.string()),
    instructions: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Agent = z.infer<typeof agentSchema>;
