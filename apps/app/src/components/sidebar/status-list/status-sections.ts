import {
  compareByCreatedAtDescending,
  hasThreadListWorkingActivity,
  isThreadRead,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import type { SidebarStatusSectionId, ThreadListEntry } from "@bb/domain";

export const STATUS_SECTIONS = [
  { id: "waiting", label: "Waiting" },
  { id: "ready", label: "Ready" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "snoozed", label: "Snoozed" },
] as const satisfies readonly {
  id: SidebarStatusSectionId;
  label: string;
}[];
export type StatusSectionId = SidebarStatusSectionId;

export interface StatusFamily {
  root: ThreadListEntry;
  threads: ThreadListEntry[];
  latestAttentionAt: number;
  snoozedUntil: number | null;
}

export function isThreadWorking(
  thread: ThreadListEntry,
  hasUnsubmittedDraft = false,
): boolean {
  return hasThreadListWorkingActivity(
    threadListIndicatorStateForThread(thread, hasUnsubmittedDraft),
  );
}

export function isThreadWaitingOnUser(thread: ThreadListEntry): boolean {
  const state = threadListIndicatorStateForThread(thread, false);
  return (
    state.hasPendingInteraction ||
    state.hasUnreadError ||
    thread.queuedWork === "failed"
  );
}

export function isThreadReady(thread: ThreadListEntry): boolean {
  const state = threadListIndicatorStateForThread(thread, false);
  return (
    state.hasUnreadSuccess ||
    (!isThreadRead(thread) &&
      !isThreadWaitingOnUser(thread) &&
      !isThreadWorking(thread))
  );
}

export function canSnoozeThreads(threads: readonly ThreadListEntry[]): boolean {
  return !threads.some(
    (thread) => isThreadWorking(thread) || thread.hasPendingInteraction,
  );
}

export function isSnoozeActive(
  root: ThreadListEntry,
  family: readonly ThreadListEntry[],
  now: number,
): boolean {
  return (
    root.snoozedUntil !== null &&
    root.snoozedUntil > now &&
    canSnoozeThreads(family)
  );
}

function sectionForFamily(
  family: readonly ThreadListEntry[],
  snoozed: boolean,
  draftThreadIds: ReadonlySet<string>,
): StatusSectionId {
  if (snoozed) return "snoozed";
  if (family.some(isThreadWaitingOnUser)) return "waiting";
  if (
    family.some((thread) =>
      isThreadWorking(thread, draftThreadIds.has(thread.id)),
    )
  ) {
    return "working";
  }
  if (family.some(isThreadReady)) return "ready";
  return "done";
}

export function buildStatusSections(
  threads: readonly ThreadListEntry[],
  draftThreadIds: ReadonlySet<string>,
  now: number,
): Map<StatusSectionId, StatusFamily[]> {
  const ids = new Set(threads.map((thread) => thread.id));
  const children = new Map<string, ThreadListEntry[]>();
  const roots: ThreadListEntry[] = [];
  for (const thread of threads) {
    const parentId = thread.parentThreadId;
    if (parentId !== null && ids.has(parentId)) {
      const siblings = children.get(parentId);
      if (siblings) siblings.push(thread);
      else children.set(parentId, [thread]);
    } else {
      roots.push(thread);
    }
  }
  const descendants = (
    id: string,
    seen: Set<string> = new Set([id]),
  ): ThreadListEntry[] =>
    (children.get(id) ?? []).flatMap((child) => {
      if (seen.has(child.id)) return [];
      seen.add(child.id);
      return [child, ...descendants(child.id, seen)];
    });
  const sections = new Map<StatusSectionId, StatusFamily[]>(
    STATUS_SECTIONS.map(({ id }) => [id, []]),
  );
  for (const root of roots) {
    const family = [root, ...descendants(root.id)];
    const snoozed = isSnoozeActive(root, family, now);
    sections.get(sectionForFamily(family, snoozed, draftThreadIds))!.push({
      root,
      threads: family,
      latestAttentionAt: Math.max(
        ...family.map((thread) => thread.latestAttentionAt),
      ),
      snoozedUntil: snoozed ? root.snoozedUntil : null,
    });
  }
  for (const [id, families] of sections) {
    if (id === "snoozed") {
      families.sort(
        (left, right) => (left.snoozedUntil ?? 0) - (right.snoozedUntil ?? 0),
      );
    } else {
      families.sort(
        (left, right) =>
          right.latestAttentionAt - left.latestAttentionAt ||
          compareByCreatedAtDescending(left.root, right.root),
      );
    }
  }
  return sections;
}

export function nextSnoozeWakeAt(
  threads: readonly ThreadListEntry[],
  now: number,
): number | null {
  let soonest: number | null = null;
  for (const thread of threads) {
    const until = thread.snoozedUntil;
    if (until !== null && until > now && (soonest === null || until < soonest)) {
      soonest = until;
    }
  }
  return soonest;
}
