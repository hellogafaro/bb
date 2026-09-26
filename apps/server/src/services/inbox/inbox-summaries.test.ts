import {
  createProject,
  createThread,
  createEnvironment,
  noopNotifier,
  threads,
  upsertHost,
} from "@bb/db";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "../../../test/helpers/test-app.js";
import { inferenceCompleteWithRetry } from "../ai/inference.js";
import { InboxSummaryService } from "./inbox-summaries.js";

vi.mock("../ai/inference.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ai/inference.js")>()),
  inferenceCompleteWithRetry: vi.fn(),
}));

const inference = vi.mocked(inferenceCompleteWithRetry);

function setup(openRouterApiKey = "key") {
  const db = createTestDb();
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
    titleFallback: "Fix the login redirect loop",
  });
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  };
  const deps = {
    config: { openRouterApiKey, inferenceModel: "test/model" },
    db,
    logger,
    pendingInteractions: { listPendingThreadInteractions: () => [] },
  } as unknown as ConstructorParameters<typeof InboxSummaryService>[0];
  return { db, thread, service: new InboxSummaryService(deps) };
}

async function settle(service: InboxSummaryService, threadId: string) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = service.request([threadId]);
    if (result.pending.length === 0) return result;
  }
  throw new Error("summary never settled");
}

afterEach(() => {
  inference.mockReset();
});

describe("InboxSummaryService", () => {
  it("reports missing summaries as pending, generates once, then serves them", async () => {
    inference.mockResolvedValue({
      goal: "Stop the login redirect loop.",
      state: "The agent patched the redirect guard.",
      needs: "",
    });
    const { thread, service } = setup();
    const first = service.request([thread.id, "thr_missing"]);
    expect(first).toEqual({ summaries: [], pending: [thread.id] });
    service.request([thread.id]);
    const settled = await settle(service, thread.id);
    expect(inference).toHaveBeenCalledTimes(1);
    expect(inference.mock.calls[0]?.[1].prompt).toContain(
      "Fix the login redirect loop",
    );
    expect(settled.summaries).toEqual([
      expect.objectContaining({
        threadId: thread.id,
        goal: "Stop the login redirect loop.",
        state: "The agent patched the redirect guard.",
        needs: null,
      }),
    ]);
  });

  it("regenerates when the thread gained attention after the summary", async () => {
    inference.mockResolvedValue({ goal: "g", state: "s", needs: "Approve it" });
    const { db, thread, service } = setup();
    service.request([thread.id]);
    await settle(service, thread.id);
    db.update(threads)
      .set({ latestAttentionAt: Date.now() + 60_000 })
      .where(eq(threads.id, thread.id))
      .run();
    const stale = service.request([thread.id]);
    expect(stale.pending).toEqual([thread.id]);
    expect(stale.summaries).toHaveLength(1);
    const refreshed = await settle(service, thread.id);
    expect(inference).toHaveBeenCalledTimes(2);
    expect(refreshed.summaries[0]?.needs).toBe("Approve it");
  });

  it("does nothing when inference is not configured", () => {
    const { thread, service } = setup("");
    expect(service.request([thread.id])).toEqual({
      summaries: [],
      pending: [],
    });
    expect(inference).not.toHaveBeenCalled();
  });
});
