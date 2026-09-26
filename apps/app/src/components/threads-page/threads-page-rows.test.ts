import { describe, expect, it } from "vitest";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import type { ThreadListEntry } from "@bb/domain";
import {
  activeStickyHeaderIndex,
  buildActiveThreadsPageRows,
  buildArchivedThreadsPageRows,
  headerRowIndexes,
  stickyHeaderRangeExtractor,
  THREADS_PAGE_HEADER_HEIGHT,
  THREADS_PAGE_ROW_HEIGHT,
  THREADS_PAGE_SECTION_GAP,
  threadsPageRowSize,
} from "./threads-page-rows";

let sequence = 0;
function thread(
  overrides: Parameters<typeof makeThreadListEntry>[0] = {},
): ThreadListEntry {
  sequence += 1;
  return makeThreadListEntry({
    id: `thr_${sequence}`,
    updatedAt: 100,
    latestAttentionAt: 100,
    lastReadAt: 100,
    ...overrides,
  });
}

const NOW = 1_000;
const NO_DRAFTS = new Set<string>();
const NONE_COLLAPSED = new Set<never>();

function describeRows(rows: ReturnType<typeof buildActiveThreadsPageRows>) {
  return rows.map((row) =>
    row.kind === "header"
      ? `${row.label}:${row.count}`
      : `${"  ".repeat(row.depth)}${row.thread.id}`,
  );
}

describe("buildActiveThreadsPageRows", () => {
  it("emits one header per non-empty status section in sidebar order", () => {
    const waiting = thread({ hasPendingInteraction: true });
    const working = thread({
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const done = thread();
    const rows = buildActiveThreadsPageRows({
      threads: [done, working, waiting],
      draftThreadIds: NO_DRAFTS,
      now: NOW,
      collapsedSectionIds: NONE_COLLAPSED,
    });
    expect(describeRows(rows)).toEqual([
      "Waiting:1",
      waiting.id,
      "Working:1",
      working.id,
      "Done:1",
      done.id,
    ]);
  });

  it("nests child threads under their root with increasing depth", () => {
    const root = thread();
    const child = thread({ parentThreadId: root.id });
    const grandchild = thread({ parentThreadId: child.id });
    const rows = buildActiveThreadsPageRows({
      threads: [grandchild, child, root],
      draftThreadIds: NO_DRAFTS,
      now: NOW,
      collapsedSectionIds: NONE_COLLAPSED,
    });
    expect(describeRows(rows)).toEqual([
      "Done:1",
      root.id,
      `  ${child.id}`,
      `    ${grandchild.id}`,
    ]);
  });

  it("keeps a collapsed section's header but drops its threads", () => {
    const done = thread();
    const waiting = thread({ hasPendingInteraction: true });
    const rows = buildActiveThreadsPageRows({
      threads: [done, waiting],
      draftThreadIds: NO_DRAFTS,
      now: NOW,
      collapsedSectionIds: new Set(["done"]),
    });
    expect(describeRows(rows)).toEqual(["Waiting:1", waiting.id, "Done:1"]);
    expect(rows.at(-1)).toMatchObject({ kind: "header", isCollapsed: true });
  });

  it("returns no rows when there are no threads", () => {
    expect(
      buildActiveThreadsPageRows({
        threads: [],
        draftThreadIds: NO_DRAFTS,
        now: NOW,
        collapsedSectionIds: NONE_COLLAPSED,
      }),
    ).toEqual([]);
  });
});

describe("buildArchivedThreadsPageRows", () => {
  it("groups every archived thread under one header", () => {
    const first = thread({ archivedAt: 50 });
    const second = thread({ archivedAt: 40 });
    const rows = buildArchivedThreadsPageRows({
      threads: [first, second],
      collapsedSectionIds: NONE_COLLAPSED,
    });
    expect(describeRows(rows)).toEqual(["Archived:2", first.id, second.id]);
  });

  it("collapses to only the header", () => {
    const rows = buildArchivedThreadsPageRows({
      threads: [thread({ archivedAt: 50 })],
      collapsedSectionIds: new Set(["archived"]),
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "header", isCollapsed: true });
  });

  it("returns no rows for an empty archive", () => {
    expect(
      buildArchivedThreadsPageRows({
        threads: [],
        collapsedSectionIds: NONE_COLLAPSED,
      }),
    ).toEqual([]);
  });
});

describe("sticky headers", () => {
  const rows = buildActiveThreadsPageRows({
    threads: [
      thread({ hasPendingInteraction: true }),
      thread({ hasPendingInteraction: true }),
      thread(),
      thread(),
      thread(),
    ],
    draftThreadIds: NO_DRAFTS,
    now: NOW,
    collapsedSectionIds: NONE_COLLAPSED,
  });
  const headers = headerRowIndexes(rows);

  it("finds header indexes", () => {
    expect(headers).toEqual([0, 3]);
  });

  it("picks the latest header at or above the first visible row", () => {
    expect(activeStickyHeaderIndex(headers, 0)).toBe(0);
    expect(activeStickyHeaderIndex(headers, 2)).toBe(0);
    expect(activeStickyHeaderIndex(headers, 3)).toBe(3);
    expect(activeStickyHeaderIndex(headers, 6)).toBe(3);
    expect(activeStickyHeaderIndex([], 4)).toBeNull();
  });

  it("prepends the active header when it scrolled out of range", () => {
    const range = {
      startIndex: 4,
      endIndex: 6,
      overscan: 0,
      count: rows.length,
    };
    expect(stickyHeaderRangeExtractor(headers, range)).toEqual([3, 4, 5, 6]);
    expect(
      stickyHeaderRangeExtractor(headers, { ...range, startIndex: 3 }),
    ).toEqual([3, 4, 5, 6]);
  });

  it("sizes headers with a gap except for the first row", () => {
    expect(threadsPageRowSize(rows[0]!, 0)).toBe(THREADS_PAGE_HEADER_HEIGHT);
    expect(threadsPageRowSize(rows[3]!, 3)).toBe(
      THREADS_PAGE_HEADER_HEIGHT + THREADS_PAGE_SECTION_GAP,
    );
    expect(threadsPageRowSize(rows[1]!, 1)).toBe(THREADS_PAGE_ROW_HEIGHT);
  });
});
