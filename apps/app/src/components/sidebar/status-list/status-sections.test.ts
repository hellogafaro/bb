import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import {
  buildStatusSections,
  canSnoozeThreads,
  isSnoozeActive,
  nextSnoozeWakeAt,
  type StatusSectionId,
} from "./status-sections";

let sequence = 0;
type ThreadOverrides = Parameters<typeof makeThreadListEntry>[0];
function thread(overrides: ThreadOverrides = {}): ThreadListEntry {
  sequence += 1;
  return makeThreadListEntry({
    id: `thr_${sequence}`,
    updatedAt: 100,
    latestAttentionAt: 100,
    lastReadAt: 100,
    ...overrides,
  });
}

const RUNNING = {
  status: "active",
  runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
} as const;
const NO_DRAFTS = new Set<string>();

function rootIds(
  sections: ReturnType<typeof buildStatusSections>,
  id: StatusSectionId,
): string[] {
  return (sections.get(id) ?? []).map((family) => family.root.id);
}

function sectionOf(
  sections: ReturnType<typeof buildStatusSections>,
  threadId: string,
): StatusSectionId[] {
  return [...sections].flatMap(([id, families]) =>
    families.some((family) =>
      family.threads.some((member) => member.id === threadId),
    )
      ? [id]
      : [],
  );
}

describe("status sections", () => {
  it("sorts threads into Waiting, Ready, Working, and Done", () => {
    const asks = thread({ hasPendingInteraction: true });
    const failed = thread({ status: "error", lastReadAt: 0 });
    const running = thread(RUNNING);
    const ready = thread({ lastReadAt: 0 });
    const done = thread();
    const sections = buildStatusSections(
      [asks, failed, running, ready, done],
      NO_DRAFTS,
      1_000,
    );
    expect(new Set(rootIds(sections, "waiting"))).toEqual(
      new Set([asks.id, failed.id]),
    );
    expect(rootIds(sections, "ready")).toEqual([ready.id]);
    expect(rootIds(sections, "working")).toEqual([running.id]);
    expect(rootIds(sections, "done")).toEqual([done.id]);
    expect(rootIds(sections, "snoozed")).toEqual([]);
  });

  it("puts every thread in exactly one section", () => {
    const threads = [
      thread({ hasPendingInteraction: true }),
      thread({ status: "error", lastReadAt: 0 }),
      thread({ queuedWork: "failed" }),
      thread(RUNNING),
      thread({ lastReadAt: 0 }),
      thread(),
      thread({ snoozedUntil: 5_000 }),
      thread({ activity: { activeBackgroundAgentCount: 1 } }),
    ];
    const parent = threads[5]!;
    const child = thread({ parentThreadId: parent.id });
    const sections = buildStatusSections(
      [...threads, child],
      NO_DRAFTS,
      1_000,
    );
    for (const entry of [...threads, child]) {
      expect(sectionOf(sections, entry.id)).toHaveLength(1);
    }
  });

  it("waits on a failed queued message but not a scheduled one", () => {
    const failed = thread({ queuedWork: "failed" });
    const scheduled = thread({ queuedWork: "waiting" });
    const sections = buildStatusSections([failed, scheduled], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "waiting")).toEqual([failed.id]);
    expect(rootIds(sections, "done")).toEqual([scheduled.id]);
  });

  it("counts background work as Working", () => {
    const background = thread({ activity: { activeBackgroundAgentCount: 1 } });
    const sections = buildStatusSections([background], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "working")).toEqual([background.id]);
  });

  it("moves a whole family to its most urgent state", () => {
    const parent = thread(RUNNING);
    const child = thread({
      parentThreadId: parent.id,
      hasPendingInteraction: true,
    });
    const sections = buildStatusSections([parent, child], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "waiting")).toEqual([parent.id]);
    expect(sections.get("waiting")![0]!.threads.map(({ id }) => id)).toEqual([
      parent.id,
      child.id,
    ]);
  });

  it("keeps an unread parent in Working while a child runs", () => {
    const parent = thread({ lastReadAt: 0 });
    const child = thread({ parentThreadId: parent.id, ...RUNNING });
    const sections = buildStatusSections([parent, child], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "working")).toEqual([parent.id]);
  });

  it("treats a child whose parent is not listed as a root", () => {
    const orphan = thread({ parentThreadId: "thr_missing" });
    expect(
      rootIds(buildStatusSections([orphan], NO_DRAFTS, 1_000), "done"),
    ).toEqual([orphan.id]);
  });

  it("lists newest attention first", () => {
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
    const sections = buildStatusSections([older, newer], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "done")).toEqual([newer.id, older.id]);
  });

  it.each(["done", "working"] as const)(
    "keeps %s families in place when root or child metadata changes",
    (section) => {
      const extra = section === "working" ? RUNNING : {};
      const older = thread({
        updatedAt: 50,
        latestAttentionAt: 50,
        lastReadAt: 50,
        ...extra,
      });
      const newer = thread({
        updatedAt: 90,
        latestAttentionAt: 90,
        lastReadAt: 90,
        ...extra,
      });
      const child = thread({
        parentThreadId: older.id,
        updatedAt: 40,
        latestAttentionAt: 40,
        lastReadAt: 40,
      });
      const order = (entries: ThreadListEntry[]) =>
        rootIds(buildStatusSections(entries, NO_DRAFTS, 1_000), section);
      expect(order([older, newer, child])).toEqual([newer.id, older.id]);
      const renamedRoot = { ...older, title: "New root title", updatedAt: 200 };
      const renamedChild = {
        ...child,
        title: "New child title",
        updatedAt: 300,
      };
      expect(order([renamedRoot, newer, child])).toEqual([newer.id, older.id]);
      expect(order([older, newer, renamedChild])).toEqual([newer.id, older.id]);
      expect(
        order([
          older,
          newer,
          { ...child, latestAttentionAt: 400, lastReadAt: 400 },
        ]),
      ).toEqual([older.id, newer.id]);
    },
  );

  it("uses creation time and thread id to break equal attention timestamps", () => {
    const older = thread({ id: "thr_z", createdAt: 10 });
    const laterA = thread({ id: "thr_a", createdAt: 20 });
    const laterB = thread({ id: "thr_b", createdAt: 20 });
    expect(
      rootIds(
        buildStatusSections([laterB, older, laterA], NO_DRAFTS, 1_000),
        "done",
      ),
    ).toEqual([laterA.id, laterB.id, older.id]);
  });

  it("hides a quiet thread until its snooze ends", () => {
    const quiet = thread({ snoozedUntil: 5_000 });
    const snoozed = buildStatusSections([quiet], NO_DRAFTS, 1_000);
    expect(rootIds(snoozed, "snoozed")).toEqual([quiet.id]);
    expect(snoozed.get("snoozed")![0]!.snoozedUntil).toBe(5_000);
    const woke = buildStatusSections([quiet], NO_DRAFTS, 5_000);
    expect(rootIds(woke, "done")).toEqual([quiet.id]);
    expect(woke.get("done")![0]!.snoozedUntil).toBeNull();
  });

  it("snoozes the whole family from the root", () => {
    const root = thread({ snoozedUntil: 5_000 });
    const child = thread({ parentThreadId: root.id, lastReadAt: 0 });
    const sections = buildStatusSections([root, child], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "snoozed")).toEqual([root.id]);
    expect(rootIds(sections, "ready")).toEqual([]);
  });

  it("never hides live work or a question behind a snooze", () => {
    const working = thread({ ...RUNNING, snoozedUntil: 5_000 });
    const asking = thread({ hasPendingInteraction: true, snoozedUntil: 5_000 });
    const sections = buildStatusSections([working, asking], NO_DRAFTS, 1_000);
    expect(rootIds(sections, "working")).toEqual([working.id]);
    expect(rootIds(sections, "waiting")).toEqual([asking.id]);
    expect(canSnoozeThreads([working])).toBe(false);
    expect(canSnoozeThreads([asking])).toBe(false);
    expect(canSnoozeThreads([thread()])).toBe(true);
    expect(isSnoozeActive(working, [working], 1_000)).toBe(false);
  });

  it("orders snoozed threads by wake time", () => {
    const later = thread({ snoozedUntil: 9_000 });
    const sooner = thread({ snoozedUntil: 3_000 });
    expect(
      rootIds(buildStatusSections([later, sooner], NO_DRAFTS, 1_000), "snoozed"),
    ).toEqual([sooner.id, later.id]);
  });

  it("finds the next wake time among future snoozes", () => {
    expect(
      nextSnoozeWakeAt(
        [
          thread({ snoozedUntil: 9_000 }),
          thread({ snoozedUntil: 500 }),
          thread({ snoozedUntil: 3_000 }),
          thread(),
        ],
        1_000,
      ),
    ).toBe(3_000);
    expect(nextSnoozeWakeAt([thread()], 1_000)).toBeNull();
  });
});
