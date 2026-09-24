import { randomInt } from "node:crypto";
import type Database from "better-sqlite3";
import type { PolicyMode } from "./policy.js";
import type { McpServerRecord, McpSourceRecord, ToolRisk } from "./types.js";

const SOURCE_COLUMNS = "id, name, description, sourceKind, sourceRef, registryName, registryVersion, pluginRoot, pluginData, createdAt, updatedAt";

export interface ConnectedSource {
  id: string;
  handle: string;
  description: string | null;
  guide: string | null;
}

export interface ToolPolicyRecord {
  toolName: string;
  risk: ToolRisk;
  mode: PolicyMode;
}

export class McpsStore {
  private readonly identities = new Map<string, { id: string; handle: string }>();
  constructor(
    readonly db: Database.Database,
    migrate: (db: Database.Database, statements: string[]) => void,
  ) {
    try { db.exec("PRAGMA foreign_keys = ON"); } catch {}
    migrate(db, [
      `PRAGMA foreign_keys = ON`,
      `CREATE TABLE IF NOT EXISTS sources (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        sourceKind TEXT NOT NULL CHECK(sourceKind IN ('manual','registry')),
        sourceRef TEXT,
        registryName TEXT,
        registryVersion TEXT,
        pluginRoot TEXT NOT NULL,
        pluginData TEXT NOT NULL,
        createdAt INTEGER NOT NULL,
        updatedAt INTEGER NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS mcp_servers (
        pluginId TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
        serverId TEXT NOT NULL,
        type TEXT NOT NULL,
        configJson TEXT NOT NULL,
        status TEXT NOT NULL,
        lastError TEXT,
        approved INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        PRIMARY KEY (pluginId, serverId)
      )`,
      `CREATE TABLE IF NOT EXISTS tool_policies (
        pluginId TEXT NOT NULL,
        serverId TEXT NOT NULL,
        toolName TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        risk TEXT NOT NULL CHECK(risk IN ('read','write','destructive')),
        mode TEXT NOT NULL CHECK(mode IN ('inherit','allow','deny','confirm')),
        PRIMARY KEY (pluginId, serverId, toolName),
        FOREIGN KEY (pluginId, serverId) REFERENCES mcp_servers(pluginId, serverId) ON DELETE CASCADE
      )`,
      `UPDATE mcp_servers SET approved = 1, status = CASE WHEN status = 'needs-approval' THEN 'idle' ELSE status END WHERE approved != 1`,
      `CREATE TABLE IF NOT EXISTS source_identities (
        sourceKey TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
        id TEXT NOT NULL UNIQUE,
        handle TEXT NOT NULL UNIQUE
      )`,
      `ALTER TABLE sources ADD COLUMN guide TEXT`,
    ]);
    this.transaction(() => {
      for (const source of this.listSources()) this.ensureIdentity(source.id);
    });
  }

  identity(sourceKey: string): { id: string; handle: string } {
    const cached = this.identities.get(sourceKey);
    if (cached) return cached;
    const value = this.db.prepare("SELECT id, handle FROM source_identities WHERE sourceKey = ?").get(sourceKey);
    if (!value) throw new Error(`MCP identity missing: ${sourceKey}`);
    const identity = Object.freeze(value as { id: string; handle: string });
    this.identities.set(sourceKey, identity);
    return identity;
  }

  private ensureIdentity(sourceKey: string): void {
    if (this.db.prepare("SELECT 1 FROM source_identities WHERE sourceKey = ?").get(sourceKey)) return;
    const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
    let id: string;
    do { id = "mcp_" + Array.from({ length: 10 }, () => chars[randomInt(chars.length)]).join(""); }
    while (this.db.prepare("SELECT 1 FROM source_identities WHERE id = ?").get(id) || this.getPlugin(id));
    this.db.prepare("INSERT INTO source_identities(sourceKey, id, handle) VALUES (?, ?, ?)").run(sourceKey, id, sourceKey);
  }

  listSources(): McpSourceRecord[] {
    return this.db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources ORDER BY createdAt DESC`).all() as McpSourceRecord[];
  }

  getPlugin(id: string): McpSourceRecord | undefined {
    return this.db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE id = ?`).get(id) as McpSourceRecord | undefined;
  }

  getSourceByName(name: string): McpSourceRecord | undefined {
    return this.db.prepare(`SELECT ${SOURCE_COLUMNS} FROM sources WHERE name = ? COLLATE NOCASE`).get(name) as McpSourceRecord | undefined;
  }

  snapshot(): { sources: McpSourceRecord[]; mcpServers: McpServerRecord[] } {
    return { sources: this.listSources(), mcpServers: this.listMcpServers() };
  }

  upsertSource(record: McpSourceRecord): void {
    this.db.prepare(
      `INSERT INTO sources (id, name, description, sourceKind, sourceRef, registryName, registryVersion, pluginRoot, pluginData, createdAt, updatedAt)
       VALUES (@id, @name, @description, @sourceKind, @sourceRef, @registryName, @registryVersion, @pluginRoot, @pluginData, @createdAt, @updatedAt)
       ON CONFLICT(id) DO UPDATE SET
         name=excluded.name, description=excluded.description, sourceKind=excluded.sourceKind,
         sourceRef=excluded.sourceRef, registryName=excluded.registryName, registryVersion=excluded.registryVersion,
         pluginRoot=excluded.pluginRoot, pluginData=excluded.pluginData, updatedAt=excluded.updatedAt`,
    ).run(record as unknown as Record<string, unknown>);
    this.ensureIdentity(record.id);
  }

  getGuide(id: string): string | null {
    const row = this.db.prepare(`SELECT guide FROM sources WHERE id = ?`).get(id) as { guide: string | null } | undefined;
    return row?.guide ?? null;
  }

  setGuide(id: string, guide: string | null): boolean {
    return this.db.prepare(`UPDATE sources SET guide = ? WHERE id = ?`).run(guide, id).changes > 0;
  }

  listConnectedSources(): ConnectedSource[] {
    return this.db.prepare(
      `SELECT i.id AS id, i.handle AS handle, s.description AS description, s.guide AS guide
       FROM sources s JOIN source_identities i ON i.sourceKey = s.id
       WHERE EXISTS (SELECT 1 FROM mcp_servers m WHERE m.pluginId = s.id AND m.enabled = 1 AND m.approved = 1)
       ORDER BY i.handle`,
    ).all() as ConnectedSource[];
  }

  deleteSource(id: string): boolean {
    this.identities.delete(id);
    return this.db.prepare(`DELETE FROM sources WHERE id = ?`).run(id).changes > 0;
  }

  listMcpServers(pluginId?: string): McpServerRecord[] {
    if (pluginId) {
      return this.db.prepare(`SELECT * FROM mcp_servers WHERE pluginId = ?`).all(pluginId) as McpServerRecord[];
    }
    return this.db.prepare(`SELECT * FROM mcp_servers`).all() as McpServerRecord[];
  }

  getServer(pluginId: string, serverId: string): McpServerRecord | undefined {
    return this.db.prepare(`SELECT * FROM mcp_servers WHERE pluginId = ? AND serverId = ?`).get(pluginId, serverId) as McpServerRecord | undefined;
  }

  resolveSource(idOrName: string): McpSourceRecord | undefined {
    const identity = this.db.prepare("SELECT sourceKey FROM source_identities WHERE id = ? OR handle = ?").get(idOrName, idOrName) as { sourceKey: string } | undefined;
    return (identity ? this.getPlugin(identity.sourceKey) : undefined) ?? this.getPlugin(idOrName) ?? this.getSourceByName(idOrName);
  }

  deleteMcpServer(pluginId: string, serverId: string): boolean {
    return this.db.prepare(`DELETE FROM mcp_servers WHERE pluginId = ? AND serverId = ?`).run(pluginId, serverId).changes > 0;
  }

  admitPending(): number {
    const pending = this.listMcpServers().filter((record) => record.approved !== 1);
    for (const server of pending) {
      this.upsertMcpServer({
        ...server,
        approved: 1,
        status: server.status === "needs-approval" ? "idle" : server.status,
      });
    }
    return pending.length;
  }

  upsertMcpServer(record: McpServerRecord): void {
    this.db.prepare(
      `INSERT INTO mcp_servers (pluginId, serverId, type, configJson, status, lastError, approved, enabled)
       VALUES (@pluginId, @serverId, @type, @configJson, @status, @lastError, @approved, @enabled)
       ON CONFLICT(pluginId, serverId) DO UPDATE SET
         type=excluded.type, configJson=excluded.configJson, status=excluded.status,
         lastError=excluded.lastError, approved=excluded.approved, enabled=excluded.enabled`,
    ).run(record as unknown as Record<string, unknown>);
  }

  setMcpEnabled(pluginId: string, serverId: string, enabled: boolean): McpServerRecord | undefined {
    this.db.prepare(`UPDATE mcp_servers SET enabled = ? WHERE pluginId = ? AND serverId = ?`).run(enabled ? 1 : 0, pluginId, serverId);
    return this.getServer(pluginId, serverId);
  }

  seedToolPolicies(pluginId: string, serverId: string, tools: Array<{ name: string; risk: ToolRisk }>): void {
    if (tools.length === 0) return;
    const insert = this.db.prepare(
      `INSERT INTO tool_policies (pluginId, serverId, toolName, risk, mode) VALUES (?, ?, ?, ?, 'inherit')
       ON CONFLICT(pluginId, serverId, toolName) DO UPDATE SET risk = excluded.risk WHERE risk != excluded.risk`,
    );
    this.transaction(() => { for (const tool of tools) insert.run(pluginId, serverId, tool.name, tool.risk); });
  }

  getToolPolicy(pluginId: string, serverId: string, toolName: string): ToolPolicyRecord | undefined {
    return this.db.prepare(`SELECT toolName, risk, mode FROM tool_policies WHERE pluginId = ? AND serverId = ? AND toolName = ?`)
      .get(pluginId, serverId, toolName) as ToolPolicyRecord | undefined;
  }

  listToolPolicies(pluginId: string, serverId: string): ToolPolicyRecord[] {
    return this.db.prepare(`SELECT toolName, risk, mode FROM tool_policies WHERE pluginId = ? AND serverId = ? ORDER BY toolName`)
      .all(pluginId, serverId) as ToolPolicyRecord[];
  }

  setToolPolicyMode(pluginId: string, serverId: string, toolName: string, mode: PolicyMode): ToolPolicyRecord | undefined {
    this.db.prepare(`UPDATE tool_policies SET mode = ? WHERE pluginId = ? AND serverId = ? AND toolName = ?`).run(mode, pluginId, serverId, toolName);
    return this.getToolPolicy(pluginId, serverId, toolName);
  }

  transaction<T>(fn: () => T): T {
    return this.db.transaction(fn)();
  }
}
