import { describe, expect, it } from "vitest";
import { createConnection, migrate } from "../../src/index.js";
import { noopNotifier } from "../../src/notifier.js";
import { upsertHost } from "../../src/data/hosts.js";
import { createProject } from "../../src/data/projects.js";
import { archiveThread, createThread, deleteThread, upsertThreadSearchSegments } from "../../src/data/threads.js";
import { searchGlobalThreads } from "../../src/data/global-search.js";

describe("global thread search", () => {
  it("ranks titles before content, includes archives, and excludes hidden or deleted threads", () => {
    const db = createConnection(":memory:");
    migrate(db);
    try {
      const host = upsertHost(db, noopNotifier, { name: "machine" });
      const { project } = createProject(db, noopNotifier, { name: "BB", source: { type: "local_path", hostId: host.id, path: "/tmp/bb-search-test" } });
      const exact = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "font" });
      const archived = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "font archive" });
      archiveThread(db, noopNotifier, archived.id);
      const content = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "draft" });
      upsertThreadSearchSegments(db, { segments: [{ threadId: content.id, sourceKind: "user_message", sourceKey: "test", sourceSeq: 4, text: "font options" }] });
      const deleted = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "font removed" });
      deleteThread(db, noopNotifier, deleted.id);
      createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "font hidden", visibility: "hidden" });
      const rows = searchGlobalThreads(db, { query: "font", tokens: ["font"], limit: 10 });
      expect(rows.map((row) => row.id)).toEqual([exact.id, archived.id, content.id]);
      expect(rows.map((row) => row.matchClass)).toEqual([1, 2, 6]);
      expect(rows[2]?.messageSeq).toBe(4);
      const mixed = searchGlobalThreads(db, { query: "bb font", tokens: ["bb", "font"], limit: 10 });
      expect(mixed.map((row) => row.id)).toContain(content.id);
      const dispersed = createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: "untitled" });
      upsertThreadSearchSegments(db, { segments: [
        { threadId: dispersed.id, sourceKind: "user_message", sourceKey: "first", sourceSeq: 8, text: "alpha café" },
        { threadId: dispersed.id, sourceKind: "assistant_message", sourceKey: "second", sourceSeq: 9, text: "beta" },
      ] });
      const distributed = searchGlobalThreads(db, { query: "cafe beta", tokens: ["cafe", "beta"], limit: 10 });
      expect(distributed.map((row) => row.id)).toEqual([dispersed.id]);
      expect(distributed[0]).toMatchObject({ messageText: "alpha café", messageSeq: 8 });
      const typo = searchGlobalThreads(db, { query: "fnot", tokens: ["fnot"], limit: 10 });
      expect(typo.map((row) => row.id)).toEqual([exact.id, archived.id]);
      expect(typo.map((row) => row.matchClass)).toEqual([4, 4]);
      expect(searchGlobalThreads(db, { query: "fxxx", tokens: ["fxxx"], limit: 10 })).toEqual([]);
    } finally {
      db.$client.close();
    }
  });

  it("continues a stable ordering tuple after more than twenty results", () => {
    const db = createConnection(":memory:");
    migrate(db);
    try {
      const host = upsertHost(db, noopNotifier, { name: "machine" });
      const { project } = createProject(db, noopNotifier, { name: "BB", source: { type: "local_path", hostId: host.id, path: "/tmp/bb-search-pagination" } });
      for (let index = 0; index < 25; index += 1) createThread(db, noopNotifier, { projectId: project.id, providerId: "codex", title: `needle ${index}` });
      const first = searchGlobalThreads(db, { query: "needle", tokens: ["needle"], limit: 20 });
      const last = first.at(-1);
      expect(last).toBeDefined();
      const second = searchGlobalThreads(db, { query: "needle", tokens: ["needle"], limit: 20, after: { matchClass: last!.matchClass, affinity: 1, archived: 0, updatedAt: last!.updatedAt, id: last!.id } });
      expect(first).toHaveLength(20);
      expect(second).toHaveLength(5);
      expect(new Set([...first, ...second].map((row) => row.id)).size).toBe(25);
    } finally {
      db.$client.close();
    }
  });
});
