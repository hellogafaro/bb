import { randomInt } from "node:crypto";
import type Database from "better-sqlite3";
import type { PolicyMode } from "./policy.js";
import type { McpServerStatus, McpServerType, McpSource, McpSourceKind, ToolRisk } from "./types.js";

const ID_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const HANDLE_MAX = 40;

export interface NewMcpSource {
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

type SourceRow = Omit<McpSource, "enabled"> & { enabled: number };

function toSource(row: SourceRow | undefined): McpSource | undefined {
  return row && { ...row, enabled: row.enabled === 1 };
}

export function handleFor(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9_-]+/gu, "_").replace(/^_+|_+$/gu, "").slice(0, HANDLE_MAX) || "mcp";
}

function randomSuffix(length: number): string {
  return Array.from({ length }, () => ID_CHARS[randomInt(ID_CHARS.length)]).join("");
}

export class McpStore {
  private readonly statements;

  constructor(
    readonly db: Database.Database,
    migrate: (db: Database.Database, statements: string[]) => void,
  ) {
    migrate(db, [
      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        description TEXT,
        type TEXT NOT NULL CHECK(type IN ('stdio','streamable-http','sse')),
        configJson TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('idle','ready','error','disabled','needs-auth')),
        lastError TEXT,
        enabled INTEGER NOT NULL DEFAULT 1,
        guide TEXT,
        sourceKind TEXT NOT NULL CHECK(sourceKind IN ('manual','registry')),
        sourceRef TEXT,
        registryName TEXT,
        registryVersion TEXT,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS tool_policies (
        sourceId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        toolName TEXT NOT NULL,
        risk TEXT NOT NULL CHECK(risk IN ('read','write','destructive')),
        mode TEXT NOT NULL CHECK(mode IN ('inherit','allow','deny','confirm')),
        PRIMARY KEY (sourceId, toolName)
      )`,
    ]);
    db.pragma("foreign_keys = ON");
    this.statements = {
      list: db.prepare<[], SourceRow>("SELECT * FROM sources ORDER BY createdAt DESC, handle"),
      listEnabled: db.prepare<[], SourceRow>("SELECT * FROM sources WHERE enabled = 1 ORDER BY handle"),
      get: db.prepare<[string], SourceRow>("SELECT * FROM sources WHERE id = ?"),
      resolve: db.prepare<{ ref: string }, SourceRow>(
        "SELECT * FROM sources WHERE id = @ref OR handle = @ref OR name = @ref COLLATE NOCASE ORDER BY id = @ref DESC, handle = @ref DESC LIMIT 1",
      ),
      exists: db.prepare<{ id: string; handle: string }, { found: number }>("SELECT 1 AS found FROM sources WHERE id = @id OR handle = @handle"),
      insert: db.prepare(
        `INSERT INTO sources (id, handle, name, description, type, configJson, status, lastError, enabled, guide, sourceKind, sourceRef, registryName, registryVersion, createdAt, updatedAt)
         VALUES (@id, @handle, @name, @description, @type, @configJson, 'idle', NULL, 1, NULL, @sourceKind, @sourceRef, @registryName, @registryVersion, @now, @now)`,
      ),
      delete: db.prepare<[string]>("DELETE FROM sources WHERE id = ?"),
      setConfig: db.prepare<{ id: string; configJson: string; now: number }>("UPDATE sources SET configJson = @configJson, lastError = NULL, updatedAt = @now WHERE id = @id"),
      setStatus: db.prepare<{ id: string; status: McpServerStatus; lastError: string | null }>("UPDATE sources SET status = @status, lastError = @lastError WHERE id = @id"),
      setEnabled: db.prepare<{ id: string; enabled: number; status: McpServerStatus }>("UPDATE sources SET enabled = @enabled, status = @status, lastError = NULL WHERE id = @id"),
      setGuide: db.prepare<{ id: string; guide: string | null }>("UPDATE sources SET guide = @guide WHERE id = @id"),
      seedPolicy: db.prepare<{ sourceId: string; toolName: string; risk: ToolRisk }>(
        `INSERT INTO tool_policies (sourceId, toolName, risk, mode) VALUES (@sourceId, @toolName, @risk, 'inherit')
         ON CONFLICT(sourceId, toolName) DO UPDATE SET risk = excluded.risk WHERE risk != excluded.risk`,
      ),
      getPolicy: db.prepare<[string, string], ToolPolicyRecord>("SELECT toolName, risk, mode FROM tool_policies WHERE sourceId = ? AND toolName = ?"),
      listPolicies: db.prepare<[string], ToolPolicyRecord>("SELECT toolName, risk, mode FROM tool_policies WHERE sourceId = ? ORDER BY toolName"),
      setPolicy: db.prepare<{ sourceId: string; toolName: string; mode: PolicyMode }>("UPDATE tool_policies SET mode = @mode WHERE sourceId = @sourceId AND toolName = @toolName"),
    };
  }

  list(): McpSource[] {
    return this.statements.list.all().map((row) => toSource(row)!);
  }

  listEnabled(): McpSource[] {
    return this.statements.listEnabled.all().map((row) => toSource(row)!);
  }

  get(id: string): McpSource | undefined {
    return toSource(this.statements.get.get(id));
  }

  resolve(ref: string): McpSource | undefined {
    return toSource(this.statements.resolve.get({ ref }));
  }

  insert(input: NewMcpSource): McpSource {
    const base = handleFor(input.name);
    let id: string;
    let handle = base;
    for (;;) {
      id = `mcp_${randomSuffix(10)}`;
      if (!this.statements.exists.get({ id, handle })) break;
      handle = `${base}_${randomSuffix(4)}`;
    }
    this.statements.insert.run({ ...input, id, handle, now: Date.now() });
    return this.get(id)!;
  }

  delete(id: string): boolean {
    return this.statements.delete.run(id).changes > 0;
  }

  setConfig(id: string, configJson: string): void {
    this.statements.setConfig.run({ id, configJson, now: Date.now() });
  }

  setStatus(id: string, status: McpServerStatus, lastError: string | null): void {
    this.statements.setStatus.run({ id, status, lastError });
  }

  setEnabled(id: string, enabled: boolean): McpSource | undefined {
    this.statements.setEnabled.run({ id, enabled: enabled ? 1 : 0, status: enabled ? "idle" : "disabled" });
    return this.get(id);
  }

  setGuide(id: string, guide: string | null): boolean {
    return this.statements.setGuide.run({ id, guide }).changes > 0;
  }

  seedToolPolicies(sourceId: string, tools: Array<{ name: string; risk: ToolRisk }>): void {
    if (tools.length === 0) return;
    this.db.transaction(() => {
      for (const tool of tools) this.statements.seedPolicy.run({ sourceId, toolName: tool.name, risk: tool.risk });
    })();
  }

  getToolPolicy(sourceId: string, toolName: string): ToolPolicyRecord | undefined {
    return this.statements.getPolicy.get(sourceId, toolName);
  }

  listToolPolicies(sourceId: string): ToolPolicyRecord[] {
    return this.statements.listPolicies.all(sourceId);
  }

  setToolPolicyMode(sourceId: string, toolName: string, mode: PolicyMode): ToolPolicyRecord | undefined {
    this.statements.setPolicy.run({ sourceId, toolName, mode });
    return this.getToolPolicy(sourceId, toolName);
  }
}
