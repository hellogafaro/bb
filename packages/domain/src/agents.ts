import { z } from "zod";
import { reasoningLevelSchema } from "./shared-types.js";

export const AGENT_NAME_MAX_CHARS = 80;
export const AGENT_DESCRIPTION_MAX_CHARS = 500;
export const AGENT_INSTRUCTIONS_MAX_CHARS = 20_000;
export const AGENT_PERMISSION_MODE = "full";
export const DEFAULT_AGENT_NAME = "bb";

export function agentHandle(name: string): string {
  const handle = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return handle.length > 0 ? handle : "agent";
}

export const AGENT_MASCOTS = [
  "invader",
  "ghost",
  "robot",
  "cat",
  "skull",
  "crab",
  "mushroom",
  "rocket",
  "dino",
  "frog",
] as const;
export const agentMascotSchema = z.enum(AGENT_MASCOTS);
export type AgentMascot = z.infer<typeof agentMascotSchema>;

export const AGENT_NEUTRAL_COLOR = 0;
export const AGENT_COLOR_COUNT = 8;
export const agentColorSchema = z
  .number()
  .int()
  .min(AGENT_NEUTRAL_COLOR)
  .max(AGENT_COLOR_COUNT);

export const DEFAULT_AGENT_MASCOT: AgentMascot = "robot";
export const DEFAULT_AGENT_COLOR = 1;

export function agentMascotForName(name: string): AgentMascot {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 131 + name.charCodeAt(index)) >>> 0;
  }
  return AGENT_MASCOTS[hash % AGENT_MASCOTS.length] ?? DEFAULT_AGENT_MASCOT;
}

export function agentColorForName(name: string): number {
  let hash = 0;
  for (let index = 0; index < name.length; index++) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return (hash % AGENT_COLOR_COUNT) + 1;
}

export const agentSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    description: z.string(),
    providerId: z.string(),
    model: z.string().nullable(),
    reasoningLevel: reasoningLevelSchema,
    secondaryModel: z.string().nullable(),
    secondaryReasoningLevel: reasoningLevelSchema.nullable(),
    skills: z.array(z.string()),
    mcpServers: z.array(z.string()),
    instructions: z.string(),
    mascot: agentMascotSchema,
    color: agentColorSchema,
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Agent = z.infer<typeof agentSchema>;
