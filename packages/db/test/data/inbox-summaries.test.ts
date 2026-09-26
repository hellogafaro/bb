import { describe, expect, it } from "vitest";
import { noopNotifier } from "../../src/notifier.js";
import { createEnvironment } from "../../src/data/environments.js";
import { upsertHost } from "../../src/data/hosts.js";
import {
  listInboxSummaries,
  upsertInboxSummary,
} from "../../src/data/inbox-summaries.js";
import { createProject } from "../../src/data/projects.js";
import { createThread, deleteThread } from "../../src/data/threads.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test-project" },
  });
  const environment = createEnvironment(db, noopNotifier, {
    providerOwnsPath: false,
    projectId: project.id,
    hostId: host.id,
    status: "ready",
  });
  const thread = createThread(db, noopNotifier, {
    projectId: project.id,
    environmentId: environment.id,
    providerId: "codex",
  });
  return { db, thread };
}

describe("inbox summaries", () => {
  it("upserts a summary per thread and lists only requested threads", () => {
    const { db, thread } = setup();
    const created = upsertInboxSummary(db, {
      threadId: thread.id,
      goal: "Ship the login fix",
      state: "Patch ready for review",
      needs: null,
      sourceVersion: 10,
    });
    expect(created).toMatchObject({
      threadId: thread.id,
      goal: "Ship the login fix",
      needs: null,
      sourceVersion: 10,
    });
    const updated = upsertInboxSummary(db, {
      threadId: thread.id,
      goal: "Ship the login fix",
      state: "Blocked on approval",
      needs: "Approve the migration",
      sourceVersion: 20,
    });
    expect(updated.state).toBe("Blocked on approval");
    expect(updated.needs).toBe("Approve the migration");
    expect(updated.sourceVersion).toBe(20);
    expect(listInboxSummaries(db, [thread.id])).toHaveLength(1);
    expect(listInboxSummaries(db, ["thr_missing"])).toEqual([]);
    expect(listInboxSummaries(db, [])).toEqual([]);
  });

  it("drops the summary when its thread is deleted", () => {
    const { db, thread } = setup();
    upsertInboxSummary(db, {
      threadId: thread.id,
      goal: "g",
      state: "s",
      needs: null,
      sourceVersion: 1,
    });
    deleteThread(db, noopNotifier, thread.id);
    expect(listInboxSummaries(db, [thread.id])).toEqual([]);
  });
});
