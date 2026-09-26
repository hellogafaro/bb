import type { Range } from "@tanstack/react-virtual";
import { defaultRangeExtractor } from "@tanstack/react-virtual";
import type { ThreadListEntry } from "@bb/domain";
import {
  buildStatusSections,
  STATUS_SECTIONS,
  type StatusSectionId,
} from "@/components/sidebar/status-list/status-sections";

export const ARCHIVED_SECTION_ID = "archived";

export type ThreadsPageSectionId = StatusSectionId | typeof ARCHIVED_SECTION_ID;

export interface ThreadsPageHeaderRow {
  kind: "header";
  key: string;
  sectionId: ThreadsPageSectionId;
  label: string;
  count: number;
  isCollapsed: boolean;
}

export interface ThreadsPageThreadRow {
  kind: "thread";
  key: string;
  thread: ThreadListEntry;
  depth: number;
}

export type ThreadsPageRow = ThreadsPageHeaderRow | ThreadsPageThreadRow;

export const THREADS_PAGE_HEADER_HEIGHT = 32;
export const THREADS_PAGE_ROW_HEIGHT = 40;
export const THREADS_PAGE_SECTION_GAP = 12;

export function threadsPageRowSize(row: ThreadsPageRow, index: number): number {
  if (row.kind === "thread") return THREADS_PAGE_ROW_HEIGHT;
  return index === 0
    ? THREADS_PAGE_HEADER_HEIGHT
    : THREADS_PAGE_HEADER_HEIGHT + THREADS_PAGE_SECTION_GAP;
}

function familyRows(
  threads: readonly ThreadListEntry[],
): ThreadsPageThreadRow[] {
  const depthById = new Map<string, number>();
  return threads.map((thread) => {
    const parentDepth =
      thread.parentThreadId === null
        ? undefined
        : depthById.get(thread.parentThreadId);
    const depth = parentDepth === undefined ? 0 : parentDepth + 1;
    depthById.set(thread.id, depth);
    return { kind: "thread", key: thread.id, thread, depth };
  });
}

export function buildActiveThreadsPageRows({
  threads,
  draftThreadIds,
  now,
  collapsedSectionIds,
}: {
  threads: readonly ThreadListEntry[];
  draftThreadIds: ReadonlySet<string>;
  now: number;
  collapsedSectionIds: ReadonlySet<ThreadsPageSectionId>;
}): ThreadsPageRow[] {
  const sections = buildStatusSections(threads, draftThreadIds, now);
  const rows: ThreadsPageRow[] = [];
  for (const { id, label } of STATUS_SECTIONS) {
    const families = sections.get(id) ?? [];
    if (families.length === 0) continue;
    const isCollapsed = collapsedSectionIds.has(id);
    rows.push({
      kind: "header",
      key: `header:${id}`,
      sectionId: id,
      label,
      count: families.length,
      isCollapsed,
    });
    if (isCollapsed) continue;
    for (const family of families) rows.push(...familyRows(family.threads));
  }
  return rows;
}

export function buildArchivedThreadsPageRows({
  threads,
  collapsedSectionIds,
}: {
  threads: readonly ThreadListEntry[];
  collapsedSectionIds: ReadonlySet<ThreadsPageSectionId>;
}): ThreadsPageRow[] {
  if (threads.length === 0) return [];
  const isCollapsed = collapsedSectionIds.has(ARCHIVED_SECTION_ID);
  const header: ThreadsPageHeaderRow = {
    kind: "header",
    key: `header:${ARCHIVED_SECTION_ID}`,
    sectionId: ARCHIVED_SECTION_ID,
    label: "Archived",
    count: threads.length,
    isCollapsed,
  };
  if (isCollapsed) return [header];
  return [
    header,
    ...threads.map((thread): ThreadsPageThreadRow => ({
      kind: "thread",
      key: thread.id,
      thread,
      depth: 0,
    })),
  ];
}

export function headerRowIndexes(rows: readonly ThreadsPageRow[]): number[] {
  const indexes: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind === "header") indexes.push(index);
  });
  return indexes;
}

export function activeStickyHeaderIndex(
  headerIndexes: readonly number[],
  startIndex: number,
): number | null {
  let active: number | null = null;
  for (const index of headerIndexes) {
    if (index > startIndex) break;
    active = index;
  }
  return active;
}

export function stickyHeaderRangeExtractor(
  headerIndexes: readonly number[],
  range: Range,
): number[] {
  const indexes = defaultRangeExtractor(range);
  const sticky = activeStickyHeaderIndex(headerIndexes, range.startIndex);
  if (sticky === null || indexes.includes(sticky)) return indexes;
  return [sticky, ...indexes];
}
