import { describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import { noopNotifier, type DbNotifier } from "../../src/notifier.js";
import {
  applyThreadLifecycleEvent,
  archiveThread,
  createThread,
  getThread,
  listThreadsWithPendingInteractionState,
} from "../../src/data/threads.js";
import {
  setThreadSnoozedUntil,
  wakeSnoozedThreadFamily,
} from "../../src/data/thread-snooze.js";
import { createProject } from "../../src/data/projects.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createMigratedConnection } from "../helpers/migrated-connection.js";

function setup() {
  const db = createMigratedConnection();
  const host = upsertHost(db, noopNotifier, { name: "test-host" });
  const { project } = createProject(db, noopNotifier, {
    name: "test-project",
    source: { type: "local_path", hostId: host.id, path: "/tmp/test" },
  });
  return { db, project };
}

function spyNotifier() {
  const notifyThread = vi.fn<DbNotifier["notifyThread"]>();
  return {
    notifyThread,
    notifyEnvironment: vi.fn(),
    notifyHost: vi.fn(),
    notifyProject: vi.fn(),
    notifySystem: vi.fn(),
  };
}

describe("thread snooze", () => {
  it("adds a nullable snoozed_until column to threads", () => {
    const { db } = setup();
    const columns = db.all<{ name: string; notnull: number }>(
      sql`PRAGMA table_info(threads)`,
    );
    expect(columns.find((column) => column.name === "snoozed_until")).toEqual(
      expect.objectContaining({ notnull: 0 }),
    );
  });

  it("stores, returns, and clears snoozedUntil with one notification per change", () => {
    const { db, project } = setup();
    const notifier = spyNotifier();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    expect(thread.snoozedUntil).toBeNull();

    const snoozed = setThreadSnoozedUntil(db, notifier, {
      threadId: thread.id,
      snoozedUntil: 5_000_000,
    });
    expect(snoozed?.snoozedUntil).toBe(5_000_000);
    expect(getThread(db, thread.id)?.snoozedUntil).toBe(5_000_000);
    expect(notifier.notifyThread).toHaveBeenCalledWith(
      thread.id,
      ["pin-state-changed"],
      { projectId: project.id },
    );

    setThreadSnoozedUntil(db, notifier, {
      threadId: thread.id,
      snoozedUntil: 5_000_000,
    });
    expect(notifier.notifyThread).toHaveBeenCalledTimes(1);

    const cleared = setThreadSnoozedUntil(db, notifier, {
      threadId: thread.id,
      snoozedUntil: null,
    });
    expect(cleared?.snoozedUntil).toBeNull();
    expect(notifier.notifyThread).toHaveBeenCalledTimes(2);
  });

  it("returns null for a missing thread", () => {
    const { db } = setup();
    expect(
      setThreadSnoozedUntil(db, noopNotifier, {
        threadId: "thr_missing",
        snoozedUntil: 5_000_000,
      }),
    ).toBeNull();
  });

  it("wakes a snoozed thread and its snoozed ancestors", () => {
    const { db, project } = setup();
    const notifier = spyNotifier();
    const root = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const child = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: root.id,
    });
    const other = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    for (const id of [root.id, other.id]) {
      setThreadSnoozedUntil(db, noopNotifier, {
        threadId: id,
        snoozedUntil: 9_000_000,
      });
    }

    const woken = wakeSnoozedThreadFamily(db, notifier, { threadId: child.id });

    expect(woken.map((thread) => thread.id)).toEqual([root.id]);
    expect(getThread(db, root.id)?.snoozedUntil).toBeNull();
    expect(getThread(db, other.id)?.snoozedUntil).toBe(9_000_000);
    expect(notifier.notifyThread).toHaveBeenCalledTimes(1);
    expect(notifier.notifyThread).toHaveBeenCalledWith(
      root.id,
      ["pin-state-changed"],
      { projectId: project.id },
    );
    expect(wakeSnoozedThreadFamily(db, notifier, { threadId: child.id })).toEqual(
      [],
    );
  });

  it("clears the snooze when a finished turn raises attention", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "active",
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: thread.id,
      snoozedUntil: 9_000_000,
    });

    const outcome = applyThreadLifecycleEvent(db, {
      event: { type: "run.succeeded" },
      threadId: thread.id,
    });

    expect(outcome.applied).toBe(true);
    if (!outcome.applied) return;
    expect(outcome.thread.snoozedUntil).toBeNull();
    expect(outcome.wokenThreads.map((woken) => woken.id)).toEqual([thread.id]);
    expect(getThread(db, thread.id)?.snoozedUntil).toBeNull();
  });

  it("keeps the snooze through transitions that do not raise attention", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      status: "starting",
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: thread.id,
      snoozedUntil: 9_000_000,
    });

    const outcome = applyThreadLifecycleEvent(db, {
      event: { type: "run.started" },
      threadId: thread.id,
    });

    expect(outcome.applied && outcome.wokenThreads).toEqual([]);
    expect(getThread(db, thread.id)?.snoozedUntil).toBe(9_000_000);
  });

  it("wakes the snoozed root when a child thread fails", () => {
    const { db, project } = setup();
    const root = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const child = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
      parentThreadId: root.id,
      status: "active",
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: root.id,
      snoozedUntil: 9_000_000,
    });

    const outcome = applyThreadLifecycleEvent(db, {
      event: { type: "run.failed" },
      threadId: child.id,
    });

    expect(outcome.applied && outcome.wokenThreads.map((t) => t.id)).toEqual([
      root.id,
    ]);
    expect(getThread(db, root.id)?.snoozedUntil).toBeNull();
  });

  it("clears the snooze when a thread is archived", () => {
    const { db, project } = setup();
    const thread = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: thread.id,
      snoozedUntil: 9_000_000,
    });
    archiveThread(db, noopNotifier, thread.id);
    expect(getThread(db, thread.id)?.snoozedUntil).toBeNull();
  });

  it("filters thread lists by whether the snooze is still in the future", () => {
    const { db, project } = setup();
    const future = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const expired = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    const awake = createThread(db, noopNotifier, {
      projectId: project.id,
      providerId: "codex",
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: future.id,
      snoozedUntil: 9_000,
    });
    setThreadSnoozedUntil(db, noopNotifier, {
      threadId: expired.id,
      snoozedUntil: 2_000,
    });

    const snoozedIds = listThreadsWithPendingInteractionState(db, {
      snoozeFilter: { now: 5_000, snoozed: true },
    }).map((thread) => thread.id);
    const awakeIds = listThreadsWithPendingInteractionState(db, {
      snoozeFilter: { now: 5_000, snoozed: false },
    }).map((thread) => thread.id);

    expect(snoozedIds).toEqual([future.id]);
    expect(awakeIds.sort()).toEqual([expired.id, awake.id].sort());
  });
});
