import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  agents,
  countAgents,
  createConnection,
  createThread,
  deleteAgent,
  getAgent,
  getAgentByName,
  getDefaultAgent,
  insertAgent,
  listAgentNamesByIds,
  listAgents,
  migrate,
  noopNotifier,
  projects,
  setThreadAgentId,
  threads,
  updateAgent,
  type DbConnection,
  type InsertAgentArgs,
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

function agentArgs(overrides: Partial<InsertAgentArgs> = {}): InsertAgentArgs {
  return {
    name: "Coder",
    description: "Writes code",
    providerId: "claude-code",
    model: "opus",
    reasoningLevel: "high",
    skills: ["bb-cli"],
    mcpServers: ["notion"],
    instructions: "Be terse.",
    ...overrides,
  };
}

function insertProject(db: DbConnection): string {
  const id = "proj_agents";
  db.insert(projects)
    .values({
      id,
      name: "Agents",
      kind: "standard",
      createdAt: 1,
      updatedAt: 1,
    })
    .run();
  return id;
}

describe("agents data", () => {
  it("round-trips an agent with its name lists", () => {
    const db = migrated();
    const agent = insertAgent(db, agentArgs({ now: 5 }));
    expect(agent.id).toMatch(/^agent_[a-z0-9]{10}$/);
    expect(getAgent(db, agent.id)).toEqual({
      id: agent.id,
      name: "Coder",
      description: "Writes code",
      providerId: "claude-code",
      model: "opus",
      reasoningLevel: "high",
      skills: ["bb-cli"],
      mcpServers: ["notion"],
      instructions: "Be terse.",
      createdAt: 5,
      updatedAt: 5,
    });
    expect(countAgents(db)).toBe(1);
  });

  it("finds agents by name case-insensitively and rejects duplicate names", () => {
    const db = migrated();
    const agent = insertAgent(db, agentArgs());
    expect(getAgentByName(db, "  coder ")?.id).toBe(agent.id);
    expect(getAgentByName(db, "missing")).toBeNull();
    expect(() => insertAgent(db, agentArgs())).toThrow(/UNIQUE/);
  });

  it("treats the oldest agent as the default and lists in creation order", () => {
    const db = migrated();
    const second = insertAgent(db, agentArgs({ name: "Second", now: 20 }));
    const first = insertAgent(db, agentArgs({ name: "First", now: 10 }));
    expect(getDefaultAgent(db)?.id).toBe(first.id);
    expect(listAgents(db).map((agent) => agent.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(listAgentNamesByIds(db, [second.id, "agent_missing"])).toEqual(
      new Map([[second.id, "Second"]]),
    );
  });

  it("applies partial updates and keeps the id on rename", () => {
    const db = migrated();
    const agent = insertAgent(db, agentArgs({ now: 1 }));
    const updated = updateAgent(db, {
      id: agent.id,
      name: "Reviewer",
      model: null,
      skills: [],
      now: 9,
    });
    expect(updated).toMatchObject({
      id: agent.id,
      name: "Reviewer",
      model: null,
      skills: [],
      mcpServers: ["notion"],
      instructions: "Be terse.",
      updatedAt: 9,
    });
    expect(updateAgent(db, { id: "agent_missing", name: "x" })).toBeNull();
  });

  it("nulls thread references when an agent is deleted", () => {
    const db = migrated();
    const projectId = insertProject(db);
    const agent = insertAgent(db, agentArgs());
    const thread = createThread(db, noopNotifier, {
      projectId,
      providerId: "claude-code",
      agentId: agent.id,
    });
    expect(thread.agentId).toBe(agent.id);
    expect(deleteAgent(db, agent.id)).toBe(true);
    expect(deleteAgent(db, agent.id)).toBe(false);
    const row = db.select().from(threads).where(eq(threads.id, thread.id)).get();
    expect(row?.agentId).toBeNull();
    expect(db.select().from(agents).all()).toEqual([]);
  });

  it("sets a thread's agent", () => {
    const db = migrated();
    const projectId = insertProject(db);
    const agent = insertAgent(db, agentArgs());
    const thread = createThread(db, noopNotifier, {
      projectId,
      providerId: "claude-code",
    });
    expect(thread.agentId).toBeNull();
    expect(setThreadAgentId(db, { threadId: thread.id, agentId: agent.id })).toBe(
      true,
    );
    const row = db.select().from(threads).where(eq(threads.id, thread.id)).get();
    expect(row?.agentId).toBe(agent.id);
  });
});
