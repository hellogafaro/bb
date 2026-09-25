import { and, asc, desc, eq, or, sql } from "drizzle-orm";
import {
  createMcpServerId,
  isSqliteUniqueConstraintOnColumns,
  mcpServers,
  mcpToolPolicies,
  type DbConnection,
} from "@bb/db";
import type { PolicyMode } from "./policy.js";
import type {
  McpServerRecord,
  McpServerStatus,
  McpServerType,
  McpSourceKind,
  ToolRisk,
} from "./types.js";

const HANDLE_MAX = 40;
const HANDLE_SUFFIX_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const INSERT_ATTEMPTS = 8;

export interface NewMcpServer {
  name: string;
  description: string | null;
  type: McpServerType;
  configJson: string;
  sourceKind: McpSourceKind;
  sourceRef: string | null;
  registryName: string | null;
  registryVersion: string | null;
}

export interface ToolPolicyRecord {
  toolName: string;
  risk: ToolRisk;
  mode: PolicyMode;
}

export function handleFor(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/gu, "_")
      .replace(/^_+|_+$/gu, "")
      .slice(0, HANDLE_MAX) || "mcp"
  );
}

function handleSuffix(): string {
  return Array.from(
    { length: 4 },
    () =>
      HANDLE_SUFFIX_CHARS[
        Math.floor(Math.random() * HANDLE_SUFFIX_CHARS.length)
      ],
  ).join("");
}

const policyColumns = {
  toolName: mcpToolPolicies.toolName,
  risk: mcpToolPolicies.risk,
  mode: mcpToolPolicies.mode,
};

export class McpStore {
  constructor(private readonly db: DbConnection) {}

  list(): McpServerRecord[] {
    return this.db
      .select()
      .from(mcpServers)
      .orderBy(desc(mcpServers.createdAt), asc(mcpServers.handle))
      .all();
  }

  listEnabled(): McpServerRecord[] {
    return this.db
      .select()
      .from(mcpServers)
      .where(eq(mcpServers.enabled, true))
      .orderBy(asc(mcpServers.handle))
      .all();
  }

  hasEnabled(): boolean {
    return (
      this.db
        .select({ id: mcpServers.id })
        .from(mcpServers)
        .where(eq(mcpServers.enabled, true))
        .limit(1)
        .get() !== undefined
    );
  }

  get(id: string): McpServerRecord | undefined {
    return this.db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
  }

  resolve(ref: string): McpServerRecord | undefined {
    return this.db
      .select()
      .from(mcpServers)
      .where(
        or(
          eq(mcpServers.id, ref),
          eq(mcpServers.handle, ref),
          sql`${mcpServers.name} = ${ref} COLLATE NOCASE`,
        ),
      )
      .orderBy(
        desc(sql`${mcpServers.id} = ${ref}`),
        desc(sql`${mcpServers.handle} = ${ref}`),
      )
      .limit(1)
      .get();
  }

  insert(input: NewMcpServer): McpServerRecord {
    const base = handleFor(input.name);
    const now = Date.now();
    for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt += 1) {
      const handle = attempt === 0 ? base : `${base}_${handleSuffix()}`;
      try {
        return this.db
          .insert(mcpServers)
          .values({
            ...input,
            id: createMcpServerId(),
            handle,
            status: "idle",
            lastError: null,
            enabled: true,
            guide: null,
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .get();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !isSqliteUniqueConstraintOnColumns(error, {
            tableName: "mcp_servers",
            columnNames: ["handle"],
            indexName: "mcp_servers_handle_idx",
          })
        ) {
          throw error;
        }
      }
    }
    throw new Error(`Could not allocate a unique handle for ${input.name}`);
  }

  delete(id: string): boolean {
    return (
      this.db.delete(mcpServers).where(eq(mcpServers.id, id)).run().changes > 0
    );
  }

  setConfig(id: string, configJson: string): void {
    this.db
      .update(mcpServers)
      .set({ configJson, lastError: null, updatedAt: Date.now() })
      .where(eq(mcpServers.id, id))
      .run();
  }

  setStatus(
    id: string,
    status: McpServerStatus,
    lastError: string | null,
  ): void {
    this.db
      .update(mcpServers)
      .set({ status, lastError })
      .where(eq(mcpServers.id, id))
      .run();
  }

  setEnabled(id: string, enabled: boolean): McpServerRecord | undefined {
    return this.db
      .update(mcpServers)
      .set({ enabled, status: enabled ? "idle" : "disabled", lastError: null })
      .where(eq(mcpServers.id, id))
      .returning()
      .get();
  }

  setGuide(id: string, guide: string | null): boolean {
    return (
      this.db
        .update(mcpServers)
        .set({ guide })
        .where(eq(mcpServers.id, id))
        .run().changes > 0
    );
  }

  seedToolPolicies(
    serverId: string,
    tools: ReadonlyArray<{ name: string; risk: ToolRisk }>,
  ): void {
    if (tools.length === 0) return;
    this.db.transaction((tx) => {
      for (const tool of tools) {
        tx.insert(mcpToolPolicies)
          .values({
            serverId,
            toolName: tool.name,
            risk: tool.risk,
            mode: "inherit",
          })
          .onConflictDoUpdate({
            target: [mcpToolPolicies.serverId, mcpToolPolicies.toolName],
            set: { risk: tool.risk },
            setWhere: sql`${mcpToolPolicies.risk} != excluded.risk`,
          })
          .run();
      }
    });
  }

  getToolPolicy(
    serverId: string,
    toolName: string,
  ): ToolPolicyRecord | undefined {
    return this.db
      .select(policyColumns)
      .from(mcpToolPolicies)
      .where(
        and(
          eq(mcpToolPolicies.serverId, serverId),
          eq(mcpToolPolicies.toolName, toolName),
        ),
      )
      .get();
  }

  listToolPolicies(serverId: string): ToolPolicyRecord[] {
    return this.db
      .select(policyColumns)
      .from(mcpToolPolicies)
      .where(eq(mcpToolPolicies.serverId, serverId))
      .orderBy(asc(mcpToolPolicies.toolName))
      .all();
  }

  setToolPolicyMode(
    serverId: string,
    toolName: string,
    mode: PolicyMode,
  ): ToolPolicyRecord | undefined {
    return this.db
      .update(mcpToolPolicies)
      .set({ mode })
      .where(
        and(
          eq(mcpToolPolicies.serverId, serverId),
          eq(mcpToolPolicies.toolName, toolName),
        ),
      )
      .returning(policyColumns)
      .get();
  }
}
