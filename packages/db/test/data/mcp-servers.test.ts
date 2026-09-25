import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  createConnection,
  createMcpServerId,
  mcpServers,
  mcpToolPolicies,
  migrate,
  type DbConnection,
} from "../../src/index.js";

const connections: DbConnection[] = [];

afterEach(() => {
  for (const db of connections.splice(0)) db.$client.close();
});

function migrated(): DbConnection {
  const db = createConnection(":memory:");
  migrate(db);
  connections.push(db);
  return db;
}

function insertServer(db: DbConnection, handle: string) {
  const id = createMcpServerId();
  db.insert(mcpServers)
    .values({
      id,
      handle,
      name: handle,
      description: null,
      type: "streamable-http",
      configJson: JSON.stringify({ type: "streamable-http", url: "https://mcp.example/mcp" }),
      status: "idle",
      lastError: null,
      guide: null,
      sourceKind: "manual",
      sourceRef: "https://mcp.example/mcp",
      registryName: null,
      registryVersion: null,
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return id;
}

describe("mcp tables", () => {
  it("stores servers with defaults and reads them back", () => {
    const db = migrated();
    const id = insertServer(db, "notion");
    expect(id).toMatch(/^mcp_[a-z0-9]{10}$/);
    const row = db.select().from(mcpServers).where(eq(mcpServers.id, id)).get();
    expect(row).toMatchObject({ id, handle: "notion", enabled: true, status: "idle", guide: null });
  });

  it("rejects duplicate handles and unknown enum values", () => {
    const db = migrated();
    insertServer(db, "notion");
    expect(() => insertServer(db, "notion")).toThrow(/UNIQUE/);
    expect(() =>
      db.$client
        .prepare(
          "INSERT INTO mcp_servers (id, handle, name, type, config_json, status, source_kind, created_at, updated_at) VALUES ('mcp_x', 'x', 'x', 'ftp', '{}', 'idle', 'manual', 1, 1)",
        )
        .run(),
    ).toThrow(/CHECK/);
  });

  it("keys tool policies by server and tool and cascades deletes", () => {
    const db = migrated();
    const id = insertServer(db, "files");
    db.insert(mcpToolPolicies).values({ serverId: id, toolName: "write", risk: "write", mode: "inherit" }).run();
    expect(() =>
      db.insert(mcpToolPolicies).values({ serverId: id, toolName: "write", risk: "write", mode: "allow" }).run(),
    ).toThrow(/UNIQUE|PRIMARY/);
    const policy = db
      .select()
      .from(mcpToolPolicies)
      .where(and(eq(mcpToolPolicies.serverId, id), eq(mcpToolPolicies.toolName, "write")))
      .get();
    expect(policy).toEqual({ serverId: id, toolName: "write", risk: "write", mode: "inherit" });
    db.delete(mcpServers).where(eq(mcpServers.id, id)).run();
    expect(db.select().from(mcpToolPolicies).all()).toEqual([]);
  });
});
