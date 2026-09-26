import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  getThread,
  insertAgent,
  setThreadAgentId,
  type InsertAgentArgs,
} from "@bb/db";
import { agentResponseSchema } from "@bb/server-contract";
import {
  agentHomeSlug,
  agentHomesRootPath,
  commitAgentHome,
  ensureAgentHomesRepo,
} from "../../../src/services/agents/agent-home.js";
import { commitThreadAgentHome } from "../../../src/services/agents/agent-runtime.js";
import { ensureAgentHomes } from "../../../src/services/agents/agents.js";
import { resolveThreadRuntimeCommandConfig } from "../../../src/services/threads/thread-runtime-config.js";
import { readJson } from "../../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const exec = promisify(execFile);

function agentArgs(overrides: Partial<InsertAgentArgs> = {}): InsertAgentArgs {
  return {
    name: "Dexter",
    description: "",
    providerId: "codex",
    model: "gpt-5-mini",
    reasoningLevel: "high",
    skills: [],
    mcpServers: [],
    instructions: "",
    mascot: "crab",
    color: 2,
    ...overrides,
  };
}

function request(
  harness: TestAppHarness,
  urlPath: string,
  init?: { method?: string; body?: unknown },
) {
  return harness.app.request(`/api/v1${urlPath}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
}

async function writeSkill(rootPath: string, name: string): Promise<void> {
  const skillRoot = path.join(rootPath, name);
  await mkdir(skillRoot, { recursive: true });
  await writeFile(
    path.join(skillRoot, "SKILL.md"),
    ["---", `name: ${name}`, `description: Use ${name}.`, "---", ""].join("\n"),
    "utf8",
  );
}

async function gitLog(root: string): Promise<string[]> {
  const { stdout } = await exec("git", ["log", "--format=%s"], { cwd: root });
  return stdout.trim().split("\n");
}

function seedAgentThread(
  harness: TestAppHarness,
  args: { hostId: string; agentId: string; workspace: string },
) {
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: args.hostId,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: args.hostId,
    projectId: project.id,
    path: path.join(harness.config.dataDir, args.workspace),
  });
  const seeded = seedThread(harness.deps, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
  });
  setThreadAgentId(harness.db, {
    threadId: seeded.id,
    agentId: args.agentId,
  });
  const thread = getThread(harness.db, seeded.id);
  if (thread === null) throw new Error("thread missing");
  return { environment, thread };
}

function resolveConfig(
  harness: TestAppHarness,
  seeded: ReturnType<typeof seedAgentThread>,
) {
  return resolveThreadRuntimeCommandConfig(harness.deps, {
    thread: seeded.thread,
    model: "gpt-5-mini",
    environment: {
      hostId: seeded.environment.hostId,
      id: seeded.environment.id,
      path: seeded.environment.path,
      status: seeded.environment.status,
    },
  });
}

describe("agent home slugs", () => {
  it("lowercases names and replaces other characters with dashes", () => {
    expect(agentHomeSlug("Sidekick")).toBe("sidekick");
    expect(agentHomeSlug("Code Reviewer 2!")).toBe("code-reviewer-2");
    expect(agentHomeSlug("***")).toBe("agent");
  });
});

describe("agent home lifecycle", () => {
  it("creates, renames, and retires the home with the agent", async () => {
    await withTestHarness(async (harness) => {
      const root = agentHomesRootPath(harness.config.dataDir);
      const created = await request(harness, "/agents", {
        method: "POST",
        body: { name: "Code Reviewer", providerId: "codex" },
      });
      expect(created.status).toBe(201);
      const agent = agentResponseSchema.parse(await readJson(created));
      expect(agent.homePath).toBe(path.join(root, "code-reviewer"));
      expect(existsSync(agent.homePath)).toBe(true);
      await writeFile(path.join(agent.homePath, "notes.md"), "keep me\n");

      const renamed = await request(harness, `/agents/${agent.id}`, {
        method: "PATCH",
        body: { name: "Critic" },
      });
      const critic = agentResponseSchema.parse(await readJson(renamed));
      expect(critic.homePath).toBe(path.join(root, "critic"));
      expect(existsSync(agent.homePath)).toBe(false);
      expect(existsSync(path.join(critic.homePath, "notes.md"))).toBe(true);
      await commitAgentHome(harness.config.dataDir, {
        slugs: ["critic"],
        message: "drain",
      });
      expect((await gitLog(root))[0]).toBe(
        "Critic: renamed from Code Reviewer",
      );

      await request(harness, "/agents", {
        method: "POST",
        body: { name: "Keeper", providerId: "codex" },
      });
      const deleted = await request(harness, `/agents/${agent.id}`, {
        method: "DELETE",
      });
      expect(deleted.status).toBe(200);
      expect(existsSync(critic.homePath)).toBe(false);
      const retired = await readdir(path.join(root, ".deleted"));
      expect(retired).toHaveLength(1);
      expect(retired[0]).toMatch(/^critic-/u);
      expect(
        existsSync(path.join(root, ".deleted", retired[0] ?? "", "notes.md")),
      ).toBe(true);
      await commitAgentHome(harness.config.dataDir, {
        slugs: ["critic"],
        message: "drain",
      });
      expect((await gitLog(root))[0]).toBe("Critic: deleted");
      const { stdout } = await exec("git", ["status", "--porcelain"], {
        cwd: root,
      });
      expect(stdout.trim()).toBe("");
    });
  });

  it("rejects a name whose home folder another agent already uses", async () => {
    await withTestHarness(async (harness) => {
      await request(harness, "/agents", {
        method: "POST",
        body: { name: "Code Reviewer", providerId: "codex" },
      });
      const clash = await request(harness, "/agents", {
        method: "POST",
        body: { name: "code-reviewer", providerId: "codex" },
      });
      expect(clash.status).toBe(409);
    });
  });

  it("creates homes for existing agents and initializes the repo", async () => {
    await withTestHarness(async (harness) => {
      insertAgent(harness.db, agentArgs({ name: "Sidekick" }));
      await ensureAgentHomes(harness.deps);
      const root = agentHomesRootPath(harness.config.dataDir);
      expect(existsSync(path.join(root, "sidekick"))).toBe(true);
      expect(existsSync(path.join(root, ".git"))).toBe(true);
      expect(await gitLog(root)).toEqual(["Initialize agent homes"]);
    });
  });
});

describe("agent home runtime injection", () => {
  it("adds the env var, instruction line, and private skills on the server machine", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const dexter = insertAgent(
        harness.db,
        agentArgs({ name: "Dexter", instructions: "Be precise." }),
      );
      const cody = insertAgent(harness.db, agentArgs({ name: "Cody" }));
      const root = agentHomesRootPath(harness.config.dataDir);
      await writeSkill(path.join(root, "dexter", "skills"), "inventory");
      await writeSkill(path.join(root, "cody", "skills"), "refactor");
      await writeSkill(path.join(harness.config.dataDir, "skills"), "triage");

      const config = await resolveConfig(
        harness,
        seedAgentThread(harness, {
          hostId: host.id,
          agentId: dexter.id,
          workspace: "dexter-workspace",
        }),
      );

      expect(config.contributedEnv).toContainEqual(
        expect.objectContaining({
          name: "BB_AGENT_HOME",
          value: path.join(root, "dexter"),
          source: { core: "agent-home" },
        }),
      );
      expect(config.instructions).toContain(
        `<bb_agent name="Dexter" home="${path.join(root, "dexter")}">\nBe precise.\n</bb_agent>`,
      );
      expect(
        config.injectedSkillSources.map((source) => source.name).sort(),
      ).toEqual(["inventory", "triage"]);

      const codyConfig = await resolveConfig(
        harness,
        seedAgentThread(harness, {
          hostId: host.id,
          agentId: cody.id,
          workspace: "cody-workspace",
        }),
      );
      expect(
        codyConfig.injectedSkillSources.map((source) => source.name).sort(),
      ).toEqual(["refactor", "triage"]);
    });
  });

  it("keeps private skills even when the agent limits its skill list", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      seedPrimaryHost(harness.deps, host.id);
      const agent = insertAgent(
        harness.db,
        agentArgs({ name: "Sidekick", skills: ["triage"] }),
      );
      const root = agentHomesRootPath(harness.config.dataDir);
      await writeSkill(path.join(root, "sidekick", "skills"), "time-log");
      await writeSkill(path.join(harness.config.dataDir, "skills"), "triage");
      await writeSkill(path.join(harness.config.dataDir, "skills"), "other");

      const config = await resolveConfig(
        harness,
        seedAgentThread(harness, {
          hostId: host.id,
          agentId: agent.id,
          workspace: "sidekick-workspace",
        }),
      );
      expect(
        config.injectedSkillSources.map((source) => source.name).sort(),
      ).toEqual(["time-log", "triage"]);
    });
  });

  it("omits the home env and instruction on other machines", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const agent = insertAgent(harness.db, agentArgs({ name: "Dexter" }));
      const config = await resolveConfig(
        harness,
        seedAgentThread(harness, {
          hostId: host.id,
          agentId: agent.id,
          workspace: "remote-workspace",
        }),
      );
      expect(
        config.contributedEnv.some((entry) => entry.name === "BB_AGENT_HOME"),
      ).toBe(false);
      expect(config.instructions).not.toContain("BB_AGENT_HOME");
      expect(config.instructions).not.toContain("<bb_agent");
    });
  });
});

describe("agent home commits", () => {
  it("commits the agent's home after a turn only when it changed", async () => {
    await withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps);
      const dexter = insertAgent(harness.db, agentArgs({ name: "Dexter" }));
      insertAgent(harness.db, agentArgs({ name: "Cody" }));
      await ensureAgentHomes(harness.deps);
      await ensureAgentHomesRepo(harness.config.dataDir);
      const root = agentHomesRootPath(harness.config.dataDir);
      const { thread } = seedAgentThread(harness, {
        hostId: host.id,
        agentId: dexter.id,
        workspace: "commit-workspace",
      });

      expect(await commitThreadAgentHome(harness.deps, thread.id)).toBe(false);

      await writeFile(path.join(root, "dexter", "inventory.md"), "one\n");
      await writeFile(path.join(root, "cody", "scratch.md"), "not mine\n");
      expect(await commitThreadAgentHome(harness.deps, thread.id)).toBe(true);

      expect((await gitLog(root))[0]).toBe(
        `Dexter: ${thread.title ?? "Untitled thread"} (${thread.id})`,
      );
      const { stdout } = await exec("git", ["status", "--porcelain"], {
        cwd: root,
      });
      expect(stdout.trim()).toBe("?? cody/");
      expect(await commitThreadAgentHome(harness.deps, thread.id)).toBe(false);
    });
  });
});
