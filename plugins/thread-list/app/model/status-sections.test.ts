import { describe, expect, it } from "vitest";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { Snooze } from "../../shared/snoozes.js";
import { makeSidebarThread } from "./fixtures.js";
import { toSidebarThread } from "./sidebar-thread.js";
import {
  buildStatusSections,
  canSnoozeThreads,
  findStaleSnoozes,
  type StatusSectionId,
} from "./status-sections.js";

let sequence = 0;
function thread(overrides: Partial<PluginSidebarThread> = {}) {
  sequence += 1;
  return toSidebarThread(
    makeSidebarThread({
      id: `thr_${sequence}`,
      updatedAt: 100,
      latestAttentionAt: 100,
      lastReadAt: 100,
      ...overrides,
    }),
  );
}

const NO_SNOOZES = new Map<string, Snooze>();
const NO_DRAFTS = new Set<string>();

function rootIds(
  sections: ReturnType<typeof buildStatusSections>,
  id: StatusSectionId,
): string[] {
  return (sections.get(id) ?? []).map((family) => family.root.id);
}

describe("status sections", () => {
  it("sorts threads into Waiting, Ready, Working, and Done", () => {
    const asks = thread({ hasPendingInteraction: true });
    const failed = thread({ status: "error", lastReadAt: 0 });
    const running = thread({ status: "active", runtimeStatus: "active" });
    const ready = thread({ lastReadAt: 0 });
    const done = thread();
    const sections = buildStatusSections(
      [asks, failed, running, ready, done],
      NO_SNOOZES,
      NO_DRAFTS,
      1_000,
    );
    expect(new Set(rootIds(sections, "waiting"))).toEqual(
      new Set([asks.id, failed.id]),
    );
    expect(rootIds(sections, "ready")).toEqual([ready.id]);
    expect(rootIds(sections, "working")).toEqual([running.id]);
    expect(rootIds(sections, "done")).toEqual([done.id]);
  });

  it("waits on a failed queued message but not a scheduled one", () => {
    const failed = thread({ queuedWork: "failed" });
    const scheduled = thread({ queuedWork: "waiting" });
    const sections = buildStatusSections(
      [failed, scheduled],
      NO_SNOOZES,
      NO_DRAFTS,
      1_000,
    );
    expect(rootIds(sections, "waiting")).toEqual([failed.id]);
    expect(rootIds(sections, "done")).toEqual([scheduled.id]);
  });

  it("moves a whole family to its most urgent state", () => {
    const parent = thread({ status: "active", runtimeStatus: "active" });
    const child = thread({
      parentThreadId: parent.id,
      hasPendingInteraction: true,
    });
    const sections = buildStatusSections(
      [parent, child],
      NO_SNOOZES,
      NO_DRAFTS,
      1_000,
    );
    expect(rootIds(sections, "waiting")).toEqual([parent.id]);
    expect(sections.get("waiting")![0]!.threads.map(({ id }) => id)).toEqual([
      parent.id,
      child.id,
    ]);
  });

  it("keeps an unread parent in Working while a child runs", () => {
    const parent = thread({ lastReadAt: 0 });
    const child = thread({
      parentThreadId: parent.id,
      status: "active",
      runtimeStatus: "active",
    });
    const sections = buildStatusSections(
      [parent, child],
      NO_SNOOZES,
      NO_DRAFTS,
      1_000,
    );
    expect(rootIds(sections, "working")).toEqual([parent.id]);
  });

  it("lists newest activity first", () => {
    const older = thread({
      updatedAt: 50,
      latestAttentionAt: 50,
      lastReadAt: 50,
    });
    const newer = thread({
      updatedAt: 90,
      latestAttentionAt: 90,
      lastReadAt: 90,
    });
    const sections = buildStatusSections(
      [older, newer],
      NO_SNOOZES,
      NO_DRAFTS,
      1_000,
    );
    expect(rootIds(sections, "done")).toEqual([newer.id, older.id]);
  });

  it("hides a quiet thread until its snooze ends or it gets new attention", () => {
    const quiet = thread();
    const snoozes = new Map([
      [quiet.id, { threadId: quiet.id, until: 5_000, at: 200 }],
    ]);
    expect(
      rootIds(
        buildStatusSections([quiet], snoozes, NO_DRAFTS, 1_000),
        "snoozed",
      ),
    ).toEqual([quiet.id]);
    expect(
      rootIds(buildStatusSections([quiet], snoozes, NO_DRAFTS, 5_000), "done"),
    ).toEqual([quiet.id]);
    const woke = { ...quiet, latestAttentionAt: 300, lastReadAt: 300 };
    const wokeSections = buildStatusSections([woke], snoozes, NO_DRAFTS, 1_000);
    expect(rootIds(wokeSections, "done")).toEqual([quiet.id]);
    expect(
      findStaleSnoozes(wokeSections, [...snoozes.values()], [woke], 1_000),
    ).toEqual([snoozes.get(quiet.id)]);
  });

  it("never hides live work behind a snooze", () => {
    const working = thread({ status: "active", runtimeStatus: "active" });
    const snoozes = new Map([
      [working.id, { threadId: working.id, until: 5_000, at: 200 }],
    ]);
    expect(
      rootIds(
        buildStatusSections([working], snoozes, NO_DRAFTS, 1_000),
        "working",
      ),
    ).toEqual([working.id]);
    expect(canSnoozeThreads([working])).toBe(false);
    expect(canSnoozeThreads([thread({ hasPendingInteraction: true })])).toBe(
      false,
    );
    expect(canSnoozeThreads([thread()])).toBe(true);
  });

  it("orders snoozed threads by wake time", () => {
    const later = thread();
    const sooner = thread();
    const snoozes = new Map([
      [later.id, { threadId: later.id, until: 9_000, at: 200 }],
      [sooner.id, { threadId: sooner.id, until: 3_000, at: 200 }],
    ]);
    expect(
      rootIds(
        buildStatusSections([later, sooner], snoozes, NO_DRAFTS, 1_000),
        "snoozed",
      ),
    ).toEqual([sooner.id, later.id]);
  });
});
