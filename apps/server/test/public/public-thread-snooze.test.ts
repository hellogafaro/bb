import { getThread, setThreadSnoozedUntil } from "@bb/db";
import { threadListEntrySchema, threadSchema } from "@bb/domain";
import { apiErrorSchema } from "@bb/server-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "../../src/errors.js";
import { applyLoggedThreadLifecycleEvent } from "../../src/services/threads/lifecycle-outcome.js";
import { recordQueuedMessageDrainFailure } from "../../src/services/threads/queue-drain-failure.js";
import { readJson } from "../helpers/json.js";
import { textInput } from "../helpers/prompt-input.js";
import {
  seedEnvironment,
  seedHostSession,
  seedProjectWithSource,
  seedQueuedMessage,
  seedThread,
} from "../helpers/seed.js";
import { withTestHarness, type TestAppHarness } from "../helpers/test-app.js";

const HOUR_MS = 60 * 60 * 1_000;

function seedProject(harness: TestAppHarness, suffix: string) {
  const { host } = seedHostSession(harness.deps, {
    id: `host-thread-snooze-${suffix}`,
  });
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: `/tmp/thread-snooze-${suffix}`,
  });
  const environment = seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
  });
  return { host, project, environment };
}

function putSnooze(harness: TestAppHarness, threadId: string, body: unknown) {
  return harness.app.request(`/api/v1/threads/${threadId}/snooze`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function snooze(harness: TestAppHarness, threadId: string) {
  setThreadSnoozedUntil(harness.db, harness.hub, {
    threadId,
    snoozedUntil: Date.now() + HOUR_MS,
  });
}

describe("public thread snooze", () => {
  it("snoozes and unsnoozes a thread and publishes the change", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProject(harness, "round-trip");
      const thread = seedThread(harness.deps, { projectId: project.id });
      const notify = vi.spyOn(harness.hub, "notifyThread");
      const until = Date.now() + HOUR_MS;

      const snoozed = await putSnooze(harness, thread.id, { until });
      expect(snoozed.status).toBe(200);
      expect(threadSchema.parse(await readJson(snoozed)).snoozedUntil).toBe(
        until,
      );
      expect(getThread(harness.db, thread.id)?.snoozedUntil).toBe(until);
      expect(notify).toHaveBeenCalledWith(thread.id, ["pin-state-changed"], {
        projectId: project.id,
      });

      const listed = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&snoozed=true`,
      );
      const entries = threadListEntrySchema
        .array()
        .parse(await readJson(listed));
      expect(entries.map((entry) => entry.id)).toEqual([thread.id]);
      expect(entries[0]?.snoozedUntil).toBe(until);

      const woken = await putSnooze(harness, thread.id, { until: null });
      expect(woken.status).toBe(200);
      expect(
        threadSchema.parse(await readJson(woken)).snoozedUntil,
      ).toBeNull();
      const afterWake = await harness.app.request(
        `/api/v1/threads?projectId=${project.id}&snoozed=true`,
      );
      expect(await readJson(afterWake)).toEqual([]);
    });
  });

  it("rejects past, non-integer, and malformed wake times", async () => {
    await withTestHarness(async (harness) => {
      const { project } = seedProject(harness, "validation");
      const thread = seedThread(harness.deps, { projectId: project.id });

      for (const body of [
        { until: Date.now() - 1_000 },
        { until: Date.now() + 0.5 },
        { until: "tomorrow" },
        {},
        { until: Date.now() + HOUR_MS, extra: true },
      ]) {
        const response = await putSnooze(harness, thread.id, body);
        expect(response.status).toBe(400);
        expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
          code: "invalid_request",
        });
      }
      expect(getThread(harness.db, thread.id)?.snoozedUntil).toBeNull();
    });
  });

  it("returns 404 for a missing thread", async () => {
    await withTestHarness(async (harness) => {
      const response = await putSnooze(harness, "thr_missing", {
        until: Date.now() + HOUR_MS,
      });
      expect(response.status).toBe(404);
      expect(apiErrorSchema.parse(await readJson(response))).toMatchObject({
        code: "thread_not_found",
      });
    });
  });
});

describe("snooze wakes early", () => {
  it("wakes the thread when its turn completes and publishes the wake", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedProject(harness, "turn-complete");
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      snooze(harness, thread.id);
      const notify = vi.spyOn(harness.hub, "notifyThread");

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: thread.id,
      });

      expect(getThread(harness.db, thread.id)?.snoozedUntil).toBeNull();
      expect(notify).toHaveBeenCalledWith(thread.id, ["pin-state-changed"], {
        projectId: project.id,
      });
    });
  });

  it("wakes the snoozed root when a child thread errors", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedProject(harness, "child-error");
      const root = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const child = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        parentThreadId: root.id,
        status: "active",
      });
      snooze(harness, root.id);

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.failed" },
        threadId: child.id,
      });

      expect(getThread(harness.db, root.id)?.snoozedUntil).toBeNull();
    });
  });

  it("wakes the thread when it asks the user for input", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedProject(harness, "interaction");
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      snooze(harness, thread.id);
      const controller = new AbortController();

      const pending = harness.deps.pendingInteractions.requestPluginInteraction(
        {
          pluginId: "secrets",
          threadId: thread.id,
          rendererId: "secret-request",
          title: "Add secrets",
          payload: { fields: [{ name: "API_KEY" }] },
          presentation: {
            label: {
              pending: "Waiting for Add secrets",
              completed: "Submitted Add secrets",
            },
            icon: { glyph: "Toolbox" },
          },
          describeSubmission: null,
          timeoutMs: 10_000,
          signal: controller.signal,
        },
      );

      expect(getThread(harness.db, thread.id)?.snoozedUntil).toBeNull();
      controller.abort();
      await pending;
    });
  });

  it("wakes the thread when a queued message fails to send", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedProject(harness, "queue-failed");
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      const row = seedQueuedMessage(harness.deps, {
        threadId: thread.id,
        content: textInput("Ship it"),
        waitingOn: { kind: "thread-busy" },
      });
      snooze(harness, thread.id);

      recordQueuedMessageDrainFailure(harness.deps, {
        error: new ApiError(400, "invalid_request", "Rejected"),
        now: Date.now(),
        row,
        thread,
      });

      expect(getThread(harness.db, thread.id)?.snoozedUntil).toBeNull();
    });
  });

  it("keeps the snooze through a start and on unrelated threads", async () => {
    await withTestHarness(async (harness) => {
      const { project, environment } = seedProject(harness, "unaffected");
      const snoozedThread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "starting",
      });
      const other = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      snooze(harness, snoozedThread.id);
      const until = getThread(harness.db, snoozedThread.id)?.snoozedUntil;

      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.started" },
        threadId: snoozedThread.id,
      });
      applyLoggedThreadLifecycleEvent(harness.deps, {
        event: { type: "run.succeeded" },
        threadId: other.id,
      });
      await harness.app.request(`/api/v1/threads/${snoozedThread.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed" }),
      });

      expect(getThread(harness.db, snoozedThread.id)?.snoozedUntil).toBe(until);
    });
  });
});
