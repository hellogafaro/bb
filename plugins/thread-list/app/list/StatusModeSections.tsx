import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAtom } from "jotai";
import {
  buildProjectThreadGroups,
  getCollapsedChildActivity,
  isSidebarProjectThread,
  type SidebarSectionId,
  type ThreadComparator,
} from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import { TopLevelSidebarSection } from "./TopLevelSidebarSection.js";
import {
  renderBuiltInSidebarSection,
  type BuiltInSidebarSectionOptions,
} from "./BuiltInSidebarSection.js";
import { ReorderableSidebarSectionOrderList } from "./ReorderableSidebarSectionOrderList.js";
import { ProjectThreadTree } from "./ProjectRow.js";
import type { ProjectThreadListState } from "./ProjectRow.js";
import {
  useGroupedModeThreadDnd,
  type GroupedModePinnedProps,
} from "./ProjectList.js";
import { useReadHold } from "./useReadHold.js";
import { sidebarCollapsedStatusSectionsAtom } from "../preferences/atoms.js";
import {
  buildStatusSections,
  findStaleSnoozes,
  STATUS_SECTIONS,
  type StatusFamily,
  type StatusSectionId,
} from "../model/status-sections.js";
import {
  ThreadRowPresentationContext,
  type ThreadRowPresentation,
} from "../rows/ThreadRow.js";
import {
  CustomSnoozeDialog,
  ThreadSnoozeQuickAction,
} from "../snooze/SnoozeControls.js";
import {
  ThreadSnoozeContext,
  useCustomSnoozeRequests,
  useSnoozeClock,
  useSnoozeList,
  useThreadSnoozeValue,
} from "../snooze/snooze-state.js";
import { SIDEBAR_ROW_ACTION_BUTTON_CLASS } from "../rows/sidebarRowClasses.js";

type ToggleCollapsedId = (id: string) => void;

export interface StatusModeSectionsProps extends GroupedModePinnedProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedSectionIds: ReadonlySet<"pinned" | "threads">;
  collapsedThreadIds: Set<string>;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  onProjectSelect?: () => void;
  onToggleCollapsed: (id: "pinned" | "threads") => void;
  onToggleEnvironmentCollapsed: ToggleCollapsedId;
  onToggleThreadCollapsed: ToggleCollapsedId;
  pinnedSection: BuiltInSidebarSectionOptions;
  renderSectionActions: (
    sectionId: SidebarSectionId,
    label: string,
  ) => ReactNode;
  isSectionActionsOpen: (sectionId: SidebarSectionId) => boolean;
  selectedThreadId?: string;
  showPinnedSection: boolean;
  status: "loading" | "ready" | "unavailable";
  threads: ThreadListEntry[];
}

function statusSectionKey(id: StatusSectionId): SidebarSectionId {
  return `section:status-${id}`;
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

function StatusSection({
  id,
  label,
  families,
  collapsed,
  onToggle,
  draftThreadIds,
  renderSectionActions,
  isSectionActionsOpen,
  tree,
}: {
  id: StatusSectionId;
  label: string;
  families: readonly StatusFamily[];
  collapsed: boolean;
  onToggle: () => void;
  draftThreadIds: ReadonlySet<string>;
  renderSectionActions: StatusModeSectionsProps["renderSectionActions"];
  isSectionActionsOpen: StatusModeSectionsProps["isSectionActionsOpen"];
  tree: (
    threads: readonly ThreadListEntry[],
    families: readonly StatusFamily[],
  ) => ReactNode;
}) {
  const threads = useMemo(
    () => families.flatMap((family) => family.threads),
    [families],
  );
  const sectionKey = statusSectionKey(id);
  return (
    <TopLevelSidebarSection
      label={label}
      sectionId={sectionKey}
      status={
        <span className="px-1 text-meta tabular-nums text-subtle-foreground">
          {families.length}
        </span>
      }
      actions={renderSectionActions(sectionKey, label)}
      actionsOpen={isSectionActionsOpen(sectionKey)}
      actionsMobileAlways
      collapsedActivity={getCollapsedChildActivity(threads, draftThreadIds)}
      collapsedThreads={threads}
      collapseControl={{ isCollapsed: collapsed, onToggleCollapsed: onToggle }}
    >
      {tree(threads, families)}
    </TopLevelSidebarSection>
  );
}

export function StatusModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  draftThreadIds,
  effectivePinnedThreadIds,
  isSectionActionsOpen,
  onProjectSelect,
  onReorderPinnedThread,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedReorderPending,
  pinnedRootNodes,
  pinnedSection,
  pinnedThreads,
  renderSectionActions,
  selectedThreadId,
  showPinnedSection,
  status,
  threads,
}: StatusModeSectionsProps) {
  const [collapsedStatusList, setCollapsedStatusList] = useAtom(
    sidebarCollapsedStatusSectionsAtom,
  );
  const collapsedStatus = useMemo(
    () => new Set(collapsedStatusList),
    [collapsedStatusList],
  );
  const toggleStatus = useCallback(
    (id: StatusSectionId) => {
      setCollapsedStatusList((current) =>
        current.includes(id)
          ? current.filter((value) => value !== id)
          : [...current, id],
      );
    },
    [setCollapsedStatusList],
  );
  const heldThreads = useReadHold(threads, selectedThreadId ?? null);
  const statusThreads = useMemo(
    () =>
      heldThreads.filter(
        (thread) =>
          !effectivePinnedThreadIds.has(thread.id) &&
          isSidebarProjectThread(thread),
      ),
    [effectivePinnedThreadIds, heldThreads],
  );
  const { snoozes, snooze, unsnooze } = useSnoozeList();
  const now = useSnoozeClock(snoozes);
  const snoozesByThreadId = useMemo(
    () => new Map(snoozes.map((entry) => [entry.threadId, entry])),
    [snoozes],
  );
  const sections = useMemo(
    () =>
      buildStatusSections(
        statusThreads,
        snoozesByThreadId,
        draftThreadIds,
        now,
      ),
    [draftThreadIds, now, snoozesByThreadId, statusThreads],
  );
  useEffect(() => {
    for (const stale of findStaleSnoozes(
      sections,
      snoozes,
      statusThreads,
      now,
    )) {
      unsnooze(stale.threadId, { quiet: true });
    }
  }, [now, sections, snoozes, statusThreads, unsnooze]);
  const familiesByRootId = useMemo(() => {
    const families = new Map<string, readonly ThreadListEntry[]>();
    for (const sectionFamilies of sections.values()) {
      for (const family of sectionFamilies) {
        families.set(family.root.id, family.threads);
      }
    }
    return families;
  }, [sections]);
  const sleepingThreadIds = useMemo(
    () =>
      new Set((sections.get("snoozed") ?? []).map((family) => family.root.id)),
    [sections],
  );
  const [customFor, setCustomFor] = useState<string | null>(null);
  useCustomSnoozeRequests(setCustomFor);
  const snoozeState = useThreadSnoozeValue({
    snoozes,
    sleepingThreadIds,
    familiesByRootId,
    now,
    snooze,
    unsnooze,
    openCustom: setCustomFor,
  });
  const presentation = useMemo<ThreadRowPresentation>(
    () => ({
      metaLocation: "project",
      showHoverCard: true,
      renderLeadingActions: (thread) =>
        familiesByRootId.has(thread.id) ? (
          <ThreadSnoozeQuickAction
            threadId={thread.id}
            className={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
          />
        ) : null,
      getWakesAt: (threadId) =>
        sleepingThreadIds.has(threadId)
          ? (snoozesByThreadId.get(threadId)?.until ?? null)
          : null,
    }),
    [familiesByRootId, sleepingThreadIds, snoozesByThreadId],
  );
  const rootItems = useMemo(
    () =>
      buildProjectThreadGroups(
        statusThreads,
        familyComparator([...sections.values()].flat()),
        draftThreadIds,
        false,
      ),
    [draftThreadIds, sections, statusThreads],
  );
  const threadDnd = useGroupedModeThreadDnd({
    collapsedThreadIds,
    compareThreads: familyComparator([...sections.values()].flat()),
    draftThreadIds,
    onToggleThreadCollapsed,
    order: ["pinned"],
    onOrderChange: () => undefined,
    pinned: {
      pinnedReorderPending,
      pinnedRootNodes,
      pinnedThreads,
      onReorderPinnedThread,
    },
    rootItems,
    threads: statusThreads,
  });
  const visibleSections = STATUS_SECTIONS.filter(
    ({ id }) => (sections.get(id)?.length ?? 0) > 0,
  );
  const order: SidebarSectionId[] = [
    ...(showPinnedSection ? (["pinned"] as const) : []),
    ...visibleSections.map(({ id }) => statusSectionKey(id)),
  ];
  const renderTree = (
    sectionThreads: readonly ThreadListEntry[],
    families: readonly StatusFamily[],
  ) => {
    const threadListState: ProjectThreadListState =
      status === "ready"
        ? { status: "ready", threads: [...sectionThreads] }
        : status === "unavailable"
          ? { status: "unavailable" }
          : { status: "loading" };
    return (
      <ProjectThreadTree
        rootItems={buildProjectThreadGroups(
          sectionThreads,
          familyComparator(families),
          draftThreadIds,
          false,
        )}
        threadListState={threadListState}
        compareThreads={familyComparator(families)}
        variant="section"
        selectedThreadId={selectedThreadId}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        onProjectSelect={onProjectSelect}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      />
    );
  };

  return (
    <ThreadSnoozeContext.Provider value={snoozeState}>
      <ThreadRowPresentationContext.Provider value={presentation}>
        <ReorderableSidebarSectionOrderList order={order} threadDnd={threadDnd}>
          {(sectionId, consumeClickSuppression) => {
            if (sectionId === "pinned") {
              return renderBuiltInSidebarSection({
                sectionId,
                sections: {
                  pinned: pinnedSection,
                  threads: { label: "Threads", content: null },
                },
                disabled: true,
                collapsedSectionIds,
                onToggleCollapsed,
                consumeClickSuppression,
                showPinnedSection,
              });
            }
            const section = visibleSections.find(
              ({ id }) => statusSectionKey(id) === sectionId,
            );
            if (!section) return null;
            return (
              <StatusSection
                key={sectionId}
                id={section.id}
                label={section.label}
                families={sections.get(section.id) ?? []}
                collapsed={collapsedStatus.has(section.id)}
                onToggle={() => toggleStatus(section.id)}
                draftThreadIds={draftThreadIds}
                renderSectionActions={renderSectionActions}
                isSectionActionsOpen={isSectionActionsOpen}
                tree={renderTree}
              />
            );
          }}
        </ReorderableSidebarSectionOrderList>
        <CustomSnoozeDialog
          threadId={customFor}
          onClose={() => setCustomFor(null)}
          onSnooze={snooze}
        />
      </ThreadRowPresentationContext.Provider>
    </ThreadSnoozeContext.Provider>
  );
}
