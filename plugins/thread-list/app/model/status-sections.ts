import {
  compareByCreatedAtDescending,
  hasThreadListWorkingActivity,
  isThreadRead,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import type { Snooze } from "../../shared/snoozes.js";

export const STATUS_SECTIONS = [
  { id: "waiting", label: "Waiting" },
  { id: "ready", label: "Ready" },
  { id: "working", label: "Working" },
  { id: "done", label: "Done" },
  { id: "snoozed", label: "Snoozed" },
] as const;
export type StatusSectionId = (typeof STATUS_SECTIONS)[number]["id"];

export interface StatusFamily {
  root: ThreadListEntry;
  threads: ThreadListEntry[];
  latestAttentionAt: number;
  snooze: Snooze | null;
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
  snooze: Snooze | undefined,
  family: readonly ThreadListEntry[],
  now: number,
): snooze is Snooze {
  if (!snooze || snooze.until <= now || !canSnoozeThreads(family)) {
    return false;
  }
  return !family.some((thread) => thread.latestAttentionAt > snooze.at);
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
  snoozes: ReadonlyMap<string, Snooze>,
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
  const descendants = (id: string): ThreadListEntry[] =>
    (children.get(id) ?? []).flatMap((child) => [
      child,
      ...descendants(child.id),
    ]);
  const sections = new Map<StatusSectionId, StatusFamily[]>(
    STATUS_SECTIONS.map(({ id }) => [id, []]),
  );
  for (const root of roots) {
    const family = [root, ...descendants(root.id)];
    const snooze = snoozes.get(root.id);
    const snoozed = isSnoozeActive(snooze, family, now);
    sections.get(sectionForFamily(family, snoozed, draftThreadIds))!.push({
      root,
      threads: family,
      latestAttentionAt: Math.max(
        ...family.map((thread) => thread.latestAttentionAt),
      ),
      snooze: snoozed ? snooze : null,
    });
  }
  for (const [id, families] of sections) {
    if (id === "snoozed") {
      families.sort((left, right) => left.snooze!.until - right.snooze!.until);
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

export function findStaleSnoozes(
  sections: ReadonlyMap<StatusSectionId, StatusFamily[]>,
  snoozes: readonly Snooze[],
  threads: readonly ThreadListEntry[],
  now: number,
): Snooze[] {
  const sleeping = new Set(
    (sections.get("snoozed") ?? []).map((family) => family.root.id),
  );
  const threadsById = new Map(threads.map((thread) => [thread.id, thread]));
  return snoozes.filter((snooze) => {
    if (snooze.until <= now || sleeping.has(snooze.threadId)) return false;
    const thread = threadsById.get(snooze.threadId);
    return thread !== undefined && thread.latestAttentionAt > snooze.at;
  });
}
