import {
  provisionHostMock,
  resumeHostMock,
} from "./public-thread-test-harness.js";

import { getAgent, getThread, insertAgent } from "@bb/db";
import {
  agentListResponseSchema,
  agentResponseSchema,
} from "@bb/server-contract";
import { threadSchema } from "@bb/domain";
import { beforeEach, describe, expect, it } from "vitest";
import { waitForQueuedCommand } from "../helpers/commands.js";
import { readJson } from "../helpers/json.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

function request(
  harness: TestAppHarness,
  path: string,
  init?: { method?: string; body?: unknown },
) {
  return harness.app.request(`/api/v1${path}`, {
    method: init?.method ?? "GET",
    ...(init?.body === undefined
      ? {}
      : {
          headers: { "content-type": "application/json" },
          body: JSON.stringify(init.body),
        }),
  });
}

async function createAgent(harness: TestAppHarness, body: unknown) {
  const response = await request(harness, "/agents", {
    method: "POST",
    body,
  });
  expect(response.status).toBe(201);
  return agentResponseSchema.parse(await readJson(response));
}

function recordAgentNotifications(harness: TestAppHarness) {
  const seen: { id: string; changes: readonly string[] }[] = [];
  const notifyAgent = harness.hub.notifyAgent.bind(harness.hub);
  harness.hub.notifyAgent = (id, changes) => {
    seen.push({ id, changes });
    notifyAgent(id, changes);
  };
  return seen;
}

function seedThreadTarget(harness: TestAppHarness, path: string) {
  const { host } = seedHostSession(harness.deps);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path,
  });
  seedEnvironment(harness.deps, { hostId: host.id, projectId: project.id, path });
  return { host, project };
}

function spawnBody(
  target: ReturnType<typeof seedThreadTarget>,
  extra: Record<string, unknown>,
) {
  return {
    origin: "app",
    projectId: target.project.id,
    input: [{ type: "text", text: "Run as an agent" }],
    environment: {
      type: "host",
      hostId: target.host.id,
      workspace: { type: "unmanaged", path: null },
    },
    ...extra,
  };
}

async function spawnAndReadStart(
  harness: TestAppHarness,
  body: Record<string, unknown>,
) {
  const response = await request(harness, "/threads", {
    method: "POST",
    body,
  });
  expect(response.status).toBe(201);
  const thread = threadSchema.parse(await readJson(response));
  const queued = await waitForQueuedCommand(
    harness,
    ({ command }) =>
      command.type === "thread.start" && command.threadId === thread.id,
  );
  return { thread, command: queued.command };
}

describe("agent routes", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("creates, lists, gets by name or id, and renames an agent keeping its id", async () => {
    await withTestHarness(async (harness) => {
      const notifications = recordAgentNotifications(harness);
      const created = await createAgent(harness, {
        name: "  Coder ",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        skills: ["bb-cli", "bb-cli"],
        instructions: "Ship small diffs.",
      });
      expect(created).toMatchObject({
        name: "Coder",
        description: "",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "high",
        skills: ["bb-cli"],
        mcpServers: [],
        instructions: "Ship small diffs.",
      });

      const list = agentListResponseSchema.parse(
        await readJson(await request(harness, "/agents")),
      );
      expect(list.agents.map((agent) => agent.id)).toEqual([created.id]);

      const byName = await request(harness, "/agents/coder");
      expect(agentResponseSchema.parse(await readJson(byName)).id).toBe(
        created.id,
      );

      const renamed = await request(harness, `/agents/${created.id}`, {
        method: "PATCH",
        body: { name: "Builder", description: "Builds things" },
      });
      expect(renamed.status).toBe(200);
      expect(agentResponseSchema.parse(await readJson(renamed))).toMatchObject({
        id: created.id,
        name: "Builder",
        description: "Builds things",
        model: "gpt-5",
      });
      expect((await request(harness, "/agents/Coder")).status).toBe(404);
      expect(notifications).toEqual([
        { id: created.id, changes: ["agent-changed"] },
        { id: created.id, changes: ["agent-changed"] },
      ]);
    });
  });

  it("rejects duplicate names, unknown providers, unsupported reasoning, and empty patches", async () => {
    await withTestHarness(async (harness) => {
      await createAgent(harness, { name: "Coder", providerId: "codex" });
      const duplicate = await request(harness, "/agents", {
        method: "POST",
        body: { name: "coder", providerId: "codex" },
      });
      expect(duplicate.status).toBe(409);
      const unknownProvider = await request(harness, "/agents", {
        method: "POST",
        body: { name: "Other", providerId: "nope" },
      });
      expect(unknownProvider.status).toBe(400);
      const emptyPatch = await request(harness, "/agents/Coder", {
        method: "PATCH",
        body: {},
      });
      expect(emptyPatch.status).toBe(400);
      const unknownMcp = await request(harness, "/agents/Coder", {
        method: "PATCH",
        body: { mcpServers: ["missing"] },
      });
      expect(unknownMcp.status).toBe(400);
    });
  });

  it("clears the model when the provider changes without a model", async () => {
    await withTestHarness(async (harness) => {
      const agent = await createAgent(harness, {
        name: "Coder",
        providerId: "codex",
        model: "gpt-5",
      });
      const response = await request(harness, `/agents/${agent.id}`, {
        method: "PATCH",
        body: { providerId: "claude-code" },
      });
      expect(agentResponseSchema.parse(await readJson(response))).toMatchObject({
        providerId: "claude-code",
        model: null,
      });
    });
  });

  it("refuses to delete the last agent and falls threads back to the default after a delete", async () => {
    await withTestHarness(async (harness) => {
      const notifications = recordAgentNotifications(harness);
      const first = await createAgent(harness, {
        name: "BB",
        providerId: "codex",
      });
      const last = await request(harness, `/agents/${first.id}`, {
        method: "DELETE",
      });
      expect(last.status).toBe(409);
      expect(await readJson(last)).toMatchObject({ code: "last_agent" });

      const second = await createAgent(harness, {
        name: "Reviewer",
        providerId: "codex",
        model: "gpt-5",
      });
      const target = seedThreadTarget(harness, "/tmp/agents-delete");
      const { thread } = await spawnAndReadStart(
        harness,
        spawnBody(target, { agentId: second.id }),
      );
      expect(thread.agentId).toBe(second.id);

      const removed = await request(harness, "/agents/Reviewer", {
        method: "DELETE",
      });
      expect(removed.status).toBe(200);
      expect(await readJson(removed)).toEqual({ deleted: true, id: second.id });
      expect(getAgent(harness.db, second.id)).toBeNull();
      expect(getThread(harness.db, thread.id)?.agentId).toBeNull();
      expect(notifications.at(-1)).toEqual({
        id: second.id,
        changes: ["agent-deleted"],
      });
    });
  });
});

describe("spawning threads as agents", () => {
  beforeEach(() => {
    provisionHostMock.mockReset();
    resumeHostMock.mockReset();
  });

  it("runs the named agent's provider, model, and reasoning with full permissions and ignores request execution", async () => {
    await withTestHarness(async (harness) => {
      await createAgent(harness, { name: "BB", providerId: "claude-code" });
      const coder = await createAgent(harness, {
        name: "Coder",
        providerId: "codex",
        model: "gpt-5-mini",
        reasoningLevel: "high",
      });
      const target = seedThreadTarget(harness, "/tmp/agents-named");
      const { thread, command } = await spawnAndReadStart(
        harness,
        spawnBody(target, {
          agentId: "coder",
          providerId: "claude-code",
          model: "ignored",
          reasoningLevel: "low",
          permissionMode: "accept-edits",
        }),
      );
      expect(thread).toMatchObject({ agentId: coder.id, providerId: "codex" });
      expect(command).toMatchObject({
        options: {
          model: "gpt-5-mini",
          reasoningLevel: "high",
          permissionMode: "full",
        },
      });
    });
  });

  it("uses the default agent when no agent is named", async () => {
    await withTestHarness(async (harness) => {
      const defaultAgent = await createAgent(harness, {
        name: "BB",
        providerId: "codex",
        model: "gpt-5",
        reasoningLevel: "low",
      });
      await createAgent(harness, { name: "Other", providerId: "claude-code" });
      const target = seedThreadTarget(harness, "/tmp/agents-default");
      const { thread, command } = await spawnAndReadStart(
        harness,
        spawnBody(target, {}),
      );
      expect(thread).toMatchObject({
        agentId: defaultAgent.id,
        providerId: "codex",
      });
      expect(command).toMatchObject({
        options: {
          model: "gpt-5",
          reasoningLevel: "low",
          permissionMode: "full",
        },
      });
    });
  });

  it("honors explicit provider and model without an agent and pins them on the thread", async () => {
    await withTestHarness(async (harness) => {
      const defaultAgent = await createAgent(harness, {
        name: "BB",
        providerId: "codex",
        model: "gpt-5",
      });
      const target = seedThreadTarget(harness, "/tmp/agents-compat");
      const { thread, command } = await spawnAndReadStart(
        harness,
        spawnBody(target, { providerId: "codex", model: "gpt-5-mini" }),
      );
      expect(thread.agentId).toBe(defaultAgent.id);
      expect(command).toMatchObject({
        options: { model: "gpt-5-mini", permissionMode: "full" },
      });
      expect(getThread(harness.db, thread.id)).toMatchObject({
        modelOverride: "gpt-5-mini",
      });
    });
  });

  it("rejects an unknown agent", async () => {
    await withTestHarness(async (harness) => {
      insertAgent(harness.db, {
        name: "BB",
        description: "",
        providerId: "codex",
        model: null,
        reasoningLevel: "medium",
        skills: [],
        mcpServers: [],
        instructions: "",
      });
      const target = seedThreadTarget(harness, "/tmp/agents-unknown");
      const response = await request(harness, "/threads", {
        method: "POST",
        body: spawnBody(target, { agentId: "missing" }),
      });
      expect(response.status).toBe(404);
      expect(await readJson(response)).toMatchObject({
        code: "agent_not_found",
      });
    });
  });
});
