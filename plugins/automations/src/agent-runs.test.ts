import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import {
  createAutomation,
  createManualRun,
  getAutomation,
  migrations,
  type Db,
} from "./data.js";
import { executeAgentRun, type AgentRunApi } from "./run.js";
import { createAutomationService } from "./service.js";
import type { AutomationExecution } from "./rpc-types.js";

type AgentExecution = Extract<AutomationExecution, { mode: "agent" }>;

function createTestDb(): Db {
  const db = new Database(":memory:");
  for (const migration of migrations) db.exec(migration);
  return db;
}

function seedAgentAutomation(
  db: Db,
  execution: AgentExecution,
  targetThreadId?: string,
) {
  const automation = createAutomation(db, {
    id: "auto_agent",
    projectId: "proj_test",
    name: "Digest",
    enabled: true,
    trigger: { triggerType: "once", runAt: 2_000 },
    runMode: "agent",
    execution: targetThreadId ? { ...execution, targetThreadId } : execution,
    origin: "human",
    createdByThreadId: null,
    nextRunAt: 2_000,
  });
  const { run } = createManualRun(db, {
    automationId: automation.id,
    runMode: "agent",
    now: 2_000,
  });
  return { automation: getAutomation(db, automation.id) ?? automation, run };
}

function runApi() {
  const spawn = vi.fn(async () => ({
    id: "thr_spawned",
    archivedAt: null,
    deletedAt: null,
    status: "idle",
  }));
  const send = vi.fn(async () => ({ ok: true }));
  const bb: AgentRunApi = {
    sdk: {
      threads: {
        get: async () => ({
          id: "thr_target",
          archivedAt: null,
          deletedAt: null,
          status: "idle",
        }),
        send,
        spawn,
      },
    },
    realtime: { publish: () => undefined },
    log: {
      debug: () => undefined,
      error: () => undefined,
      info: () => undefined,
      warn: () => undefined,
    },
  } as unknown as AgentRunApi;
  return { bb, send, spawn };
}

const baseExecution: AgentExecution = {
  mode: "agent",
  prompt: "Summarize the inbox",
  reasoningLevel: "medium",
  environment: { type: "project-default" },
};

describe("agent automation runs", () => {
  it("spawns the run thread as the automation's agent", async () => {
    const db = createTestDb();
    const execution = { ...baseExecution, agentId: "agent_coder0001" };
    const { automation, run } = seedAgentAutomation(db, execution);
    const { bb, spawn } = runApi();

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: () => undefined,
    });

    expect(spawn).toHaveBeenCalledWith({
      projectId: "proj_test",
      environment: { type: "project-default" },
      prompt: "Summarize the inbox",
      title: "Digest",
      agentId: "agent_coder0001",
    });
  });

  it("runs a legacy provider and model automation as the default agent", async () => {
    const db = createTestDb();
    const execution: AgentExecution = {
      ...baseExecution,
      providerId: "codex",
      model: "gpt-5",
      permissionMode: "accept-edits",
    };
    const { automation, run } = seedAgentAutomation(db, execution);
    const { bb, spawn } = runApi();

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: () => undefined,
    });

    expect(spawn).toHaveBeenCalledWith({
      projectId: "proj_test",
      environment: { type: "project-default" },
      prompt: "Summarize the inbox",
      title: "Digest",
    });
  });

  it("re-prompts a target thread without execution overrides", async () => {
    const db = createTestDb();
    const execution: AgentExecution = {
      ...baseExecution,
      permissionMode: "auto",
    };
    const { automation, run } = seedAgentAutomation(
      db,
      execution,
      "thr_target",
    );
    const { bb, send } = runApi();

    await executeAgentRun(bb, db, {
      automation,
      run,
      execution,
      onFailure: () => undefined,
    });

    expect(send).toHaveBeenCalledWith({
      threadId: "thr_target",
      mode: "steer-if-active",
      input: [
        {
          type: "text",
          text: "[bb automation due:auto_agent]\n\nSummarize the inbox",
          mentions: [],
        },
      ],
    });
  });
});

describe("agent automation service", () => {
  function serviceBb(get = vi.fn()) {
    return {
      sdk: {
        agents: { get },
        system: { config: async () => ({ primaryHostId: "host_server" }) },
        projects: {
          get: async ({ projectId }: { projectId: string }) => ({
            id: projectId,
            kind: "standard" as const,
            name: "Test Project",
            gitRemoteUrl: null,
            createdAt: 1,
            updatedAt: 1,
            sources: [],
          }),
          list: async () => [],
        },
        providers: { list: async () => [] as never },
        threads: {
          get: async () => {
            throw new Error("not expected");
          },
          send: async () => {
            throw new Error("not expected");
          },
          spawn: async () => {
            throw new Error("not expected");
          },
        },
      },
      realtime: { publish: () => undefined },
      log: {
        debug: () => undefined,
        error: () => undefined,
        info: () => undefined,
        warn: () => undefined,
      },
    };
  }

  it("stores the agent's id when created by name and skips provider checks", async () => {
    const db = createTestDb();
    const get = vi.fn(async ({ agent }: { agent: string }) => ({
      id: "agent_coder0001",
      name: agent,
    }));
    const service = createAutomationService({
      bb: serviceBb(get) as never,
      db,
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
    });

    const created = await service.create({
      projectId: "proj_test",
      name: "Digest",
      enabled: true,
      trigger: { triggerType: "once", runAt: Date.now() + 60_000 },
      execution: { ...baseExecution, agentId: "Coder" },
      origin: "human",
    });

    expect(get).toHaveBeenCalledWith({ agent: "Coder" });
    expect(created.execution).toMatchObject({
      mode: "agent",
      agentId: "agent_coder0001",
    });
    expect(created.execution).not.toHaveProperty("providerId");
  });

  it("switches an automation back to the default agent", async () => {
    const db = createTestDb();
    seedAgentAutomation(db, { ...baseExecution, agentId: "agent_coder0001" });
    const service = createAutomationService({
      bb: serviceBb() as never,
      db,
      pluginDataDir: "/tmp",
      serverUrl: "http://127.0.0.1:38886",
    });

    const updated = await service.update({
      projectId: "proj_test",
      automationId: "auto_agent",
      agent: { agentId: null },
    });

    expect(updated.execution).not.toHaveProperty("agentId");
  });
});
