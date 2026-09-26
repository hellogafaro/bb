import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import {
  buildPinnedSidebarState,
  buildProjectThreadGroups,
  getCollapsedChildActivity,
  isSidebarProjectThread,
  type ProjectThreadItem,
  type ProjectThreadNode,
  type ThreadComparator,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import {
  SidebarGroupContent,
  SidebarStickyGroup,
  SidebarStickyStack,
} from "@/components/ui/sidebar.js";
import {
  CustomSnoozeDialog,
  ThreadSnoozeContext,
  type ThreadSnoozeState,
} from "@/components/thread/ThreadSnoozeControls";
import { ThreadListEmptyState } from "@/components/thread/ThreadListEmptyState";
import { useSnoozeThread } from "@/hooks/mutations/thread-state-mutations";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useRouteState } from "@/hooks/useRouteState";
import { useSidebarThreadDraftIds } from "@/lib/plugin-sidebar-hooks";
import { TopLevelSidebarSection } from "../TopLevelSidebarSection";
import { ThreadRow, type ThreadRowOptions } from "../ThreadRow";
import { SidebarThreadHoverCard } from "../SidebarThreadHoverCard";
import { ThreadListPlaceholder } from "../ThreadListPlaceholder";
import { getSidebarThreadGroupLineLeft } from "../sidebarRowClasses";
import {
  collapsedSidebarSectionIdsAtom,
  collapsedStatusSectionsAtom,
  collapsedThreadIdsAtom,
} from "../sidebarCollapsedAtoms";
import {
  buildStatusSections,
  canSnoozeThreads,
  nextSnoozeWakeAt,
  STATUS_SECTIONS,
  type StatusFamily,
  type StatusSectionId,
} from "./status-sections";
import { useReadHold } from "./useReadHold";

const STICKY_PARENT_DEPTH_CAP = 4;
const CLOCK_TICK_MS = 30_000;
const MAX_TIMEOUT_MS = 2_147_483_647;

function toggleListValue<T extends string>(list: readonly T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((current) => current !== value)
    : [...list, value];
}

function familyComparator(families: readonly StatusFamily[]): ThreadComparator {
  const rank = new Map(
    families.map((family, index) => [family.root.id, index]),
  );
  return (left, right) => {
    const leftRank = rank.get(left.id);
    const rightRank = rank.get(right.id);
    if (leftRank !== undefined && rightRank !== undefined) {
      return leftRank - rightRank;
    }
    return left.createdAt - right.createdAt;
  };
}

function itemNodes(items: readonly ProjectThreadItem[]): ProjectThreadNode[] {
  return items.flatMap((item) => {
    switch (item.kind) {
      case "thread":
        return [item.node];
      case "environment":
        return item.group.nodes;
      case "section":
        return itemNodes(item.group.items);
    }
  });
}

function useSnoozeClock(threads: readonly ThreadListEntry[]): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const timer = window.setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, []);
  const nextWakeAt = nextSnoozeWakeAt(threads, now);
  useEffect(() => {
    if (nextWakeAt === null) return;
    const timer = window.setTimeout(
      () => setNow(Date.now()),
      Math.min(nextWakeAt - Date.now() + 50, MAX_TIMEOUT_MS),
    );
    return () => window.clearTimeout(timer);
  }, [nextWakeAt]);
  return now;
}

function SectionCount({ count }: { count: number }) {
  return <span className="shrink-0 tabular-nums opacity-70">{count}</span>;
}

interface ThreadTreeNodeProps {
  node: ProjectThreadNode;
  selectedThreadId: string | null;
  collapsedThreadIds: ReadonlySet<string>;
  draftThreadIds: ReadonlySet<string>;
  onNavigate: () => void;
  onToggleThreadCollapsed: (threadId: string) => void;
}

const ThreadTreeNode = memo(function ThreadTreeNode({
  node,
  selectedThreadId,
  collapsedThreadIds,
  draftThreadIds,
  onNavigate,
  onToggleThreadCollapsed,
}: ThreadTreeNodeProps) {
  const children = useMemo(() => itemNodes(node.children), [node.children]);
  const hasChildren = children.length > 0;
  const isCollapsed = collapsedThreadIds.has(node.thread.id);
  const options = useMemo<ThreadRowOptions>(() => {
    const base = { depth: node.depth, isCompact: node.depth > 0 };
    if (!hasChildren) return { ...base, kind: "default" };
    return {
      ...base,
      kind: "parent",
      isCollapsed,
      childCount: node.stats.childCount,
      childActivity: node.stats.childActivity,
      stickyLevel:
        node.depth < STICKY_PARENT_DEPTH_CAP ? node.depth : undefined,
      onToggleCollapsed: onToggleThreadCollapsed,
    };
  }, [hasChildren, isCollapsed, node, onToggleThreadCollapsed]);
  const row = (
    <ThreadRow
      projectId={node.thread.projectId}
      thread={node.thread}
      isActive={selectedThreadId === node.thread.id}
      hasComposerDraft={draftThreadIds.has(node.thread.id)}
      onProjectSelect={onNavigate}
      options={options}
    />
  );
  if (!hasChildren) return row;
  return (
    <SidebarStickyGroup className="relative space-y-0.5">
      {row}
      {isCollapsed ? null : (
        <div className="relative space-y-px">
          <span
            className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-border-hairline opacity-70"
            style={{ left: getSidebarThreadGroupLineLeft(node.depth) }}
            aria-hidden="true"
          />
          {children.map((child) => (
            <ThreadTreeNode
              key={child.thread.id}
              node={child}
              selectedThreadId={selectedThreadId}
              collapsedThreadIds={collapsedThreadIds}
              draftThreadIds={draftThreadIds}
              onNavigate={onNavigate}
              onToggleThreadCollapsed={onToggleThreadCollapsed}
            />
          ))}
        </div>
      )}
    </SidebarStickyGroup>
  );
});

interface ThreadTreeProps extends Omit<ThreadTreeNodeProps, "node"> {
  nodes: readonly ProjectThreadNode[];
}

function ThreadTree({ nodes, ...props }: ThreadTreeProps) {
  return (
    <div data-sidebar-sticky-section="" className="relative space-y-0.5">
      {nodes.map((node) => (
        <ThreadTreeNode key={node.thread.id} node={node} {...props} />
      ))}
    </div>
  );
}

interface StatusSectionView {
  id: StatusSectionId;
  label: string;
  families: StatusFamily[];
  threads: ThreadListEntry[];
  nodes: ProjectThreadNode[];
}

export interface StatusThreadListProps {
  onNavigate: () => void;
}

export function StatusThreadList({ onNavigate }: StatusThreadListProps) {
  const { threadId } = useRouteState();
  const selectedThreadId = threadId ?? null;
  const navigation = useSidebarNavigation();
  const draftThreadIds = useSidebarThreadDraftIds();
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const [collapsedSectionList, setCollapsedSectionList] = useAtom(
    collapsedSidebarSectionIdsAtom,
  );
  const [collapsedStatusList, setCollapsedStatusList] = useAtom(
    collapsedStatusSectionsAtom,
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const toggleThreadCollapsed = useCallback(
    (id: string) => {
      setCollapsedThreadIdList((current) => toggleListValue(current, id));
    },
    [setCollapsedThreadIdList],
  );

  const allThreads = useMemo(
    () =>
      navigation.data
        ? listSidebarNavigationThreads(navigation.data).filter(
            (thread) =>
              thread.archivedAt === null && isSidebarProjectThread(thread),
          )
        : [],
    [navigation.data],
  );
  const heldThreads = useReadHold(allThreads, selectedThreadId);
  const threadsById = useMemo(
    () => new Map(heldThreads.map((thread) => [thread.id, thread])),
    [heldThreads],
  );
  const [listContainer, setListContainer] = useState<HTMLElement | null>(null);
  const pinned = useMemo(
    () => buildPinnedSidebarState({ draftThreadIds, threads: heldThreads }),
    [draftThreadIds, heldThreads],
  );
  const statusThreads = useMemo(
    () =>
      heldThreads.filter(
        (thread) => !pinned.effectivePinnedThreadIds.has(thread.id),
      ),
    [heldThreads, pinned.effectivePinnedThreadIds],
  );
  const now = useSnoozeClock(statusThreads);
  const sections = useMemo<StatusSectionView[]>(() => {
    const built = buildStatusSections(statusThreads, draftThreadIds, now);
    return STATUS_SECTIONS.map(({ id, label }) => {
      const families = built.get(id) ?? [];
      const threads = families.flatMap((family) => family.threads);
      return {
        id,
        label,
        families,
        threads,
        nodes: itemNodes(
          buildProjectThreadGroups(
            threads,
            familyComparator(families),
            draftThreadIds,
            false,
          ),
        ),
      };
    });
  }, [draftThreadIds, now, statusThreads]);
  const familiesByRootId = useMemo(() => {
    const families = new Map<string, StatusFamily>();
    for (const section of sections) {
      for (const family of section.families) {
        families.set(family.root.id, family);
      }
    }
    return families;
  }, [sections]);
  const sectionByThreadId = useMemo(() => {
    const byThread = new Map<string, StatusSectionId>();
    for (const section of sections) {
      for (const thread of section.threads) byThread.set(thread.id, section.id);
    }
    return byThread;
  }, [sections]);

  const revealedThreadId = useRef<string | null>(null);
  useEffect(() => {
    if (selectedThreadId === null) {
      revealedThreadId.current = null;
      return;
    }
    if (revealedThreadId.current === selectedThreadId) return;
    const sectionId = sectionByThreadId.get(selectedThreadId);
    if (sectionId === undefined) return;
    revealedThreadId.current = selectedThreadId;
    setCollapsedStatusList((current) =>
      current.includes(sectionId)
        ? current.filter((id) => id !== sectionId)
        : current,
    );
  }, [sectionByThreadId, selectedThreadId, setCollapsedStatusList]);

  const { mutate: setSnooze } = useSnoozeThread();
  const [customFor, setCustomFor] = useState<string | null>(null);
  const snoozeThread = useCallback(
    (id: string, until: number) => setSnooze({ id, until }),
    [setSnooze],
  );
  const snoozeState = useMemo<ThreadSnoozeState>(
    () => ({
      now,
      activeUntil: (id) => familiesByRootId.get(id)?.snoozedUntil ?? null,
      isSnoozeRoot: (id) => familiesByRootId.has(id),
      canSnooze: (id) => {
        const family = familiesByRootId.get(id);
        return family !== undefined && canSnoozeThreads(family.threads);
      },
      snooze: snoozeThread,
      unsnooze: (id) => setSnooze({ id, until: null }),
      openCustom: setCustomFor,
    }),
    [familiesByRootId, now, setSnooze, snoozeThread],
  );

  if (navigation.data === undefined) {
    return navigation.isError ? (
      <ThreadListEmptyState message="Threads are unavailable" />
    ) : (
      <ThreadListPlaceholder state={{ kind: "loading" }} />
    );
  }

  const treeProps = {
    selectedThreadId,
    collapsedThreadIds,
    draftThreadIds,
    onNavigate,
    onToggleThreadCollapsed: toggleThreadCollapsed,
  };
  const visibleSections = sections.filter(
    (section) => section.families.length > 0,
  );
  const pinnedCollapsed = collapsedSectionList.includes("pinned");
  const pinnedThreads = heldThreads.filter((thread) =>
    pinned.effectivePinnedThreadIds.has(thread.id),
  );
  let content: ReactNode;
  if (pinned.rootNodes.length === 0 && visibleSections.length === 0) {
    content = <ThreadListEmptyState />;
  } else {
    content = (
      <div className="space-y-4">
        {pinned.rootNodes.length > 0 ? (
          <TopLevelSidebarSection
            label="Pinned"
            sectionId="pinned"
            stickyHeader={false}
            labelAccessory={<SectionCount count={pinned.rootNodes.length} />}
            collapsedActivity={getCollapsedChildActivity(
              pinnedThreads,
              draftThreadIds,
            )}
            collapsedThreads={pinnedThreads}
            collapseControl={{
              isCollapsed: pinnedCollapsed,
              onToggleCollapsed: () =>
                setCollapsedSectionList((current) =>
                  toggleListValue(current, "pinned"),
                ),
            }}
          >
            <ThreadTree nodes={pinned.rootNodes} {...treeProps} />
          </TopLevelSidebarSection>
        ) : null}
        {visibleSections.map((section) => (
          <TopLevelSidebarSection
            key={section.id}
            label={section.label}
            sectionId={`section:status-${section.id}`}
            labelAccessory={<SectionCount count={section.families.length} />}
            collapsedActivity={getCollapsedChildActivity(
              section.threads,
              draftThreadIds,
            )}
            collapsedThreads={section.threads}
            collapseControl={{
              isCollapsed: collapsedStatusList.includes(section.id),
              onToggleCollapsed: () =>
                setCollapsedStatusList((current) =>
                  toggleListValue(current, section.id),
                ),
            }}
          >
            <ThreadTree nodes={section.nodes} {...treeProps} />
          </TopLevelSidebarSection>
        ))}
      </div>
    );
  }

  return (
    <ThreadSnoozeContext.Provider value={snoozeState}>
      <SidebarStickyStack
        ref={setListContainer}
        data-thread-list="status"
        data-sidebar-sticky-density="compact-actions"
      >
        <SidebarGroupContent>{content}</SidebarGroupContent>
      </SidebarStickyStack>
      <SidebarThreadHoverCard
        container={listContainer}
        threadsById={threadsById}
      />
      <CustomSnoozeDialog
        threadId={customFor}
        onClose={() => setCustomFor(null)}
        onSnooze={snoozeThread}
      />
    </ThreadSnoozeContext.Provider>
  );
}
