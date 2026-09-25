import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  countAgents,
  getThread,
  getThreadPluginMetadata,
  insertAgent,
  listAgents,
  setThreadAgentId,
  setThreadExecutionOverride,
  upsertProjectExecutionDefaults,
  type InsertAgentArgs,
} from "@bb/db";
import { ensureDefaultAgent } from "../../../src/services/agents/agents.js";
import { buildExecutionOptions } from "../../../src/services/threads/thread-commands.js";
import { resolveThreadRuntimeCommandConfig } from "../../../src/services/threads/thread-runtime-config.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../../helpers/test-app.js";

function agentArgs(overrides: Partial<InsertAgentArgs> = {}): InsertAgentArgs {
  return {
    name: "Coder",
    description: "",
    providerId: "codex",
    model: "gpt-5-mini",
    reasoningLevel: "high",
    skills: [],
    mcpServers: [],
    instructions: "",
    ...overrides,
  };
}

async function writeSkill(rootPath: string, name: string): Promise<void> {
  const skillRoot = path.join(rootPath, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    [
      "---",
      `name: ${name}`,
      `description: Use ${name} in agent tests.`,
      "---",
      "",
      "# Skill",
      "",
    ].join("\n"),
    "utf8",
  );
}

function seedAgentThread(
  harness: TestAppHarness,
  args: { hostId: string; workspacePath?: string; providerId?: string },
) {
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: args.hostId,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: project.id,
    ...(args.workspacePath !== undefined ? { path: args.workspacePath } : {}),
  });
  const thread = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: args.providerId ?? "codex",
  });
  return { environment, project, thread };
}

describe("default agent seeding", () => {
  it("creates BB from the latest remembered execution defaults once", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
      });
      upsertProjectExecutionDefaults(harness.db, {
        projectId: project.id,
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "auto",
        serviceTier: "default",
      });

      const created = ensureDefaultAgent(harness.deps);
      expect(created).toMatchObject({
        name: "BB",
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "medium",
        skills: [],
        mcpServers: [],
        instructions: "",
      });
      expect(ensureDefaultAgent(harness.deps)).toBeNull();
      expect(countAgents(harness.db)).toBe(1);
    });
  });

  it("falls back to the default provider with its catalog default model", async () => {
    await withTestHarness(async (harness) => {
      const created = ensureDefaultAgent(harness.deps);
      expect(created?.model).toBeNull();
      expect(
        harness.deps.providerRegistry.get(created?.providerId ?? "")?.info
          .available,
      ).toBe(true);
    });
  });

  it("leaves existing agents alone", async () => {
    await withTestHarness(async (harness) => {
      insertAgent(harness.db, agentArgs());
      expect(ensureDefaultAgent(harness.deps)).toBeNull();
      expect(listAgents(harness.db).map((agent) => agent.name)).toEqual([
        "Coder",
      ]);
    });
  });
});

describe("thread execution from an agent", () => {
  it("resolves model, reasoning, and full permissions from the thread's agent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      insertAgent(harness.db, agentArgs({ name: "BB", model: "gpt-5" }));
      const coder = insertAgent(harness.db, agentArgs());
      const { thread } = seedAgentThread(harness, { hostId: host.id });
      setThreadAgentId(harness.db, { threadId: thread.id, agentId: coder.id });

      const execution = await buildExecutionOptions(
        harness.deps,
        { permissionMode: "accept-edits" },
        { threadId: thread.id },
      );
      expect(execution).toMatchObject({
        model: "gpt-5-mini",
        reasoningLevel: "high",
        permissionMode: "full",
      });
    });
  });

  it("treats a thread without an agent as the default agent", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      insertAgent(harness.db, agentArgs({ name: "BB", reasoningLevel: "low" }));
      const { thread } = seedAgentThread(harness, { hostId: host.id });
      expect(getThread(harness.db, thread.id)?.agentId).toBeNull();

      const execution = await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      );
      expect(execution).toMatchObject({
        model: "gpt-5-mini",
        reasoningLevel: "low",
        permissionMode: "full",
      });
    });
  });

  it("keeps a pinned thread model ahead of the agent's", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      insertAgent(harness.db, agentArgs({ name: "BB" }));
      const { thread } = seedAgentThread(harness, { hostId: host.id });
      setThreadExecutionOverride(harness.db, {
        threadId: thread.id,
        modelOverride: "gpt-5",
      });
      const execution = await buildExecutionOptions(
        harness.deps,
        {},
        { threadId: thread.id },
      );
      expect(execution.model).toBe("gpt-5");
      expect(execution.reasoningLevel).toBe("high");
    });
  });

  it("does not apply another provider's model", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      insertAgent(
        harness.db,
        agentArgs({ name: "BB", providerId: "claude-code", model: "opus" }),
      );
      const { thread } = seedAgentThread(harness, { hostId: host.id });
      const execution = await buildExecutionOptions(
        harness.deps,
        { model: "gpt-5" },
        { threadId: thread.id },
      );
      expect(execution).toMatchObject({
        model: "gpt-5",
        permissionMode: "full",
      });
    });
  });
});

describe("thread runtime config from an agent", () => {
  it("limits skills, scopes MCPs, and appends the agent's instructions", async () => {
    await withTestHarness(async (harness) => {
      const skillsRoot = path.join(harness.config.dataDir, "skills");
      await writeSkill(skillsRoot, "release-notes");
      await writeSkill(skillsRoot, "triage");
      const { host } = seedHostSession(harness.deps);
      const agent = insertAgent(
        harness.db,
        agentArgs({
          name: "Writer",
          skills: ["release-notes"],
          mcpServers: ["notion"],
          instructions: "Write in plain English.",
        }),
      );
      const { environment, thread } = seedAgentThread(harness, {
        hostId: host.id,
        workspacePath: path.join(harness.config.dataDir, "agent-workspace"),
      });
      setThreadAgentId(harness.db, { threadId: thread.id, agentId: agent.id });
      const agentThread = getThread(harness.db, thread.id);
      if (agentThread === null) throw new Error("thread missing");

      const config = await resolveThreadRuntimeCommandConfig(harness.deps, {
        thread: agentThread,
        model: "gpt-5-mini",
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          status: environment.status,
        },
      });

      expect(config.injectedSkillSources.map((source) => source.name)).toEqual(
        ["release-notes"],
      );
      expect(
        getThreadPluginMetadata(harness.db, thread.id, "mcp").metadata,
      ).toEqual({ servers: ["notion"] });
      expect(config.instructions).toContain(
        'The following instructions come from the BB agent "Writer":\n\nWrite in plain English.',
      );
    });
  });

  it("keeps every skill and no MCP scope when the agent lists none", async () => {
    await withTestHarness(async (harness) => {
      const skillsRoot = path.join(harness.config.dataDir, "skills");
      await writeSkill(skillsRoot, "release-notes");
      await writeSkill(skillsRoot, "triage");
      const { host } = seedHostSession(harness.deps);
      insertAgent(harness.db, agentArgs({ name: "BB" }));
      const { environment, thread } = seedAgentThread(harness, {
        hostId: host.id,
        workspacePath: path.join(harness.config.dataDir, "agent-workspace-2"),
      });

      const config = await resolveThreadRuntimeCommandConfig(harness.deps, {
        thread,
        model: "gpt-5-mini",
        environment: {
          hostId: environment.hostId,
          id: environment.id,
          path: environment.path,
          status: environment.status,
        },
      });

      expect(
        config.injectedSkillSources.map((source) => source.name).sort(),
      ).toEqual(["release-notes", "triage"]);
      expect(
        getThreadPluginMetadata(harness.db, thread.id, "mcp").metadata,
      ).toEqual({});
      expect(config.instructions).not.toContain("BB agent");
    });
  });
});
