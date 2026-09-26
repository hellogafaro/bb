import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import type {
  Agent,
  AgentMascot,
  ProjectExecutionDefaults,
  ReasoningLevel,
} from "@bb/domain";
import type { DbConnection, DbTransaction } from "../connection.js";
import { createAgentId } from "../ids.js";
import { agents, projectExecutionDefaults, threads } from "../schema.js";

type AgentRow = typeof agents.$inferSelect;
type AgentConnection = DbConnection | DbTransaction;

export interface InsertAgentArgs {
  name: string;
  description: string;
  providerId: string;
  model: string | null;
  reasoningLevel: ReasoningLevel;
  secondaryModel?: string | null;
  secondaryReasoningLevel?: ReasoningLevel | null;
  skills: readonly string[];
  mcpServers: readonly string[];
  instructions: string;
  mascot: AgentMascot;
  color: number;
  now?: number;
}

export interface UpdateAgentArgs {
  id: string;
  name?: string;
  description?: string;
  providerId?: string;
  model?: string | null;
  reasoningLevel?: ReasoningLevel;
  secondaryModel?: string | null;
  secondaryReasoningLevel?: ReasoningLevel | null;
  skills?: readonly string[];
  mcpServers?: readonly string[];
  instructions?: string;
  mascot?: AgentMascot;
  color?: number;
  now?: number;
}

export interface SetThreadAgentIdArgs {
  threadId: string;
  agentId: string | null;
}

function parseNameList(json: string): string[] {
  const parsed: unknown = JSON.parse(json);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter((item): item is string => typeof item === "string");
}

function toAgent(row: AgentRow): Agent {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    providerId: row.providerId,
    model: row.model,
    reasoningLevel: row.reasoningLevel,
    secondaryModel: row.secondaryModel,
    secondaryReasoningLevel: row.secondaryReasoningLevel,
    skills: parseNameList(row.skillsJson),
    mcpServers: parseNameList(row.mcpServersJson),
    instructions: row.instructions,
    mascot: row.mascot,
    color: row.color,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function listAgents(db: AgentConnection): Agent[] {
  return db
    .select()
    .from(agents)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .all()
    .map(toAgent);
}

export function countAgents(db: AgentConnection): number {
  const row = db
    .select({ count: sql<number>`count(*)` })
    .from(agents)
    .get();
  return row?.count ?? 0;
}

export function getAgent(db: AgentConnection, id: string): Agent | null {
  const row = db.select().from(agents).where(eq(agents.id, id)).get();
  return row ? toAgent(row) : null;
}

export function getAgentByName(
  db: AgentConnection,
  name: string,
): Agent | null {
  const row = db
    .select()
    .from(agents)
    .where(sql`lower(${agents.name}) = lower(${name.trim()})`)
    .get();
  return row ? toAgent(row) : null;
}

export function getDefaultAgent(db: AgentConnection): Agent | null {
  const row = db
    .select()
    .from(agents)
    .orderBy(asc(agents.createdAt), asc(agents.id))
    .limit(1)
    .get();
  return row ? toAgent(row) : null;
}

export function listAgentNamesByIds(
  db: AgentConnection,
  ids: readonly string[],
): Map<string, string> {
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const rows = db
    .select({ id: agents.id, name: agents.name })
    .from(agents)
    .where(inArray(agents.id, [...new Set(ids)]))
    .all();
  for (const row of rows) names.set(row.id, row.name);
  return names;
}

export function insertAgent(db: AgentConnection, args: InsertAgentArgs): Agent {
  const now = args.now ?? Date.now();
  const row = db
    .insert(agents)
    .values({
      id: createAgentId(),
      name: args.name,
      description: args.description,
      providerId: args.providerId,
      model: args.model,
      reasoningLevel: args.reasoningLevel,
      secondaryModel: args.secondaryModel ?? null,
      secondaryReasoningLevel: args.secondaryReasoningLevel ?? null,
      skillsJson: JSON.stringify(args.skills),
      mcpServersJson: JSON.stringify(args.mcpServers),
      instructions: args.instructions,
      mascot: args.mascot,
      color: args.color,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  return toAgent(row);
}

export function updateAgent(
  db: AgentConnection,
  args: UpdateAgentArgs,
): Agent | null {
  const set: Partial<typeof agents.$inferInsert> = {
    updatedAt: args.now ?? Date.now(),
  };
  if (args.name !== undefined) set.name = args.name;
  if (args.description !== undefined) set.description = args.description;
  if (args.providerId !== undefined) set.providerId = args.providerId;
  if (args.model !== undefined) set.model = args.model;
  if (args.reasoningLevel !== undefined)
    set.reasoningLevel = args.reasoningLevel;
  if (args.secondaryModel !== undefined)
    set.secondaryModel = args.secondaryModel;
  if (args.secondaryReasoningLevel !== undefined)
    set.secondaryReasoningLevel = args.secondaryReasoningLevel;
  if (args.skills !== undefined) set.skillsJson = JSON.stringify(args.skills);
  if (args.mcpServers !== undefined)
    set.mcpServersJson = JSON.stringify(args.mcpServers);
  if (args.instructions !== undefined) set.instructions = args.instructions;
  if (args.mascot !== undefined) set.mascot = args.mascot;
  if (args.color !== undefined) set.color = args.color;
  const row = db
    .update(agents)
    .set(set)
    .where(eq(agents.id, args.id))
    .returning()
    .get();
  return row ? toAgent(row) : null;
}

export function deleteAgent(db: AgentConnection, id: string): boolean {
  const row = db
    .delete(agents)
    .where(eq(agents.id, id))
    .returning({ id: agents.id })
    .get();
  return row !== undefined;
}

export function setThreadAgentId(
  db: AgentConnection,
  args: SetThreadAgentIdArgs,
): boolean {
  const row = db
    .update(threads)
    .set({ agentId: args.agentId, updatedAt: Date.now() })
    .where(eq(threads.id, args.threadId))
    .returning({ id: threads.id })
    .get();
  return row !== undefined;
}

export function getLatestProjectExecutionDefaults(
  db: AgentConnection,
): ProjectExecutionDefaults | null {
  const row = db
    .select({
      providerId: projectExecutionDefaults.providerId,
      model: projectExecutionDefaults.model,
      reasoningLevel: projectExecutionDefaults.reasoningLevel,
      permissionMode: projectExecutionDefaults.permissionMode,
      serviceTier: projectExecutionDefaults.serviceTier,
    })
    .from(projectExecutionDefaults)
    .orderBy(desc(projectExecutionDefaults.updatedAt))
    .limit(1)
    .get();
  return row ?? null;
}
