import { useCallback, useEffect, useMemo, useRef } from "react";
import { useVirtualizer, type Range } from "@tanstack/react-virtual";
import type { Agent, ThreadListEntry } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { EmptyStatePanel } from "@bb/shared-ui/empty-state";
import { ResourceCollectionViewport } from "@bb/shared-ui/resource-list";
import {
  agentModelLabel,
  providerDisplayName,
} from "@/components/agents/agent-display";
import {
  CollapsibleHeader,
  getCollapsibleHeaderToneClass,
} from "@/components/ui/disclosure";
import { useRelativeTimeNow } from "@/components/sidebar/ThreadRowMeta";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { useAgents, resolveThreadAgent } from "@/hooks/queries/agent-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useRouteState } from "@/hooks/useRouteState";
import { useSidebarThreadDraftIds } from "@/lib/plugin-sidebar-hooks";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { ThreadsPageRow, type ThreadsPageRowProject } from "./ThreadsPageRow";
import {
  activeStickyHeaderIndex,
  headerRowIndexes,
  stickyHeaderRangeExtractor,
  threadsPageRowSize,
  type ThreadsPageRow as ThreadsPageRowItem,
  type ThreadsPageSectionId,
} from "./threads-page-rows";

const OVERSCAN_ROWS = 12;
const LOAD_MORE_THRESHOLD_ROWS = 20;

export interface ThreadsPageListProps {
  rows: readonly ThreadsPageRowItem[];
  scrollId: string;
  emptyMessage: string;
  onToggleSection: (sectionId: ThreadsPageSectionId) => void;
  onReachEnd?: () => void;
}

const PERSONAL_PROJECT: ThreadsPageRowProject = {
  name: "Personal",
  color: null,
};

function useThreadsPageProjects(): ReadonlyMap<string, ThreadsPageRowProject> {
  const navigation = useSidebarNavigation();
  return useMemo(() => {
    const projects = new Map<string, ThreadsPageRowProject>([
      [PERSONAL_PROJECT_ID, PERSONAL_PROJECT],
    ]);
    if (!navigation.data) return projects;
    for (const project of navigation.data.projects) {
      projects.set(project.id, { name: project.name, color: project.color });
    }
    return projects;
  }, [navigation.data]);
}

function useThreadsPageAgents(): {
  agentFor: (thread: ThreadListEntry) => Agent | null;
  modelLabelFor: (thread: ThreadListEntry, agent: Agent | null) => string;
} {
  const agents = useAgents();
  const providers = useSystemProviders();
  const agentList = agents.data;
  const providerList = providers.data;
  return useMemo(
    () => ({
      agentFor: (thread) =>
        agentList === undefined
          ? null
          : resolveThreadAgent(agentList, thread.agentId),
      modelLabelFor: (thread, agent) =>
        agent === null
          ? providerDisplayName(providerList, thread.providerId)
          : agentModelLabel(agent),
    }),
    [agentList, providerList],
  );
}

export function ThreadsPageList({
  rows,
  scrollId,
  emptyMessage,
  onToggleSection,
  onReachEnd,
}: ThreadsPageListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const { threadId: activeThreadId } = useRouteState();
  const draftThreadIds = useSidebarThreadDraftIds();
  const projects = useThreadsPageProjects();
  const { agentFor, modelLabelFor } = useThreadsPageAgents();
  const now = useRelativeTimeNow();
  const headerIndexes = useMemo(() => headerRowIndexes(rows), [rows]);
  const rangeExtractor = useCallback(
    (range: Range) => stickyHeaderRangeExtractor(headerIndexes, range),
    [headerIndexes],
  );
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => {
      const row = rows[index];
      return row === undefined ? 0 : threadsPageRowSize(row, index);
    },
    getItemKey: (index) => rows[index]?.key ?? index,
    overscan: OVERSCAN_ROWS,
    rangeExtractor,
  });
  const virtualItems = virtualizer.getVirtualItems();
  const range = virtualizer.range;
  const stickyIndex =
    range === null
      ? null
      : activeStickyHeaderIndex(headerIndexes, range.startIndex);
  const lastVisibleIndex = range?.endIndex ?? -1;
  const nearEnd = lastVisibleIndex >= rows.length - LOAD_MORE_THRESHOLD_ROWS;
  useEffect(() => {
    if (nearEnd && onReachEnd !== undefined) onReachEnd();
  }, [nearEnd, onReachEnd, rows.length]);

  return (
    <ResourceCollectionViewport
      scrollId={scrollId}
      viewportRef={scrollRef}
      bandClassName={TOOLS_PAGE_BAND_CLASSES}
    >
      <div className={cn(TOOLS_PAGE_BAND_CLASSES, "pb-6")}>
        {rows.length === 0 ? (
          <EmptyStatePanel>{emptyMessage}</EmptyStatePanel>
        ) : (
          <div
            data-threads-page-list=""
            className="relative w-full"
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualItems.map((item) => {
              const row = rows[item.index];
              if (row === undefined) return null;
              const isSticky =
                row.kind === "header" && item.index === stickyIndex;
              const style = isSticky
                ? { position: "sticky" as const, top: 0, zIndex: 2 }
                : {
                    position: "absolute" as const,
                    top: 0,
                    transform: `translateY(${item.start}px)`,
                  };
              if (row.kind === "header") {
                return (
                  <div
                    key={item.key}
                    data-index={item.index}
                    className={cn(
                      "left-0 flex w-full items-end bg-background",
                      item.index === 0 ? "pt-0" : "pt-3",
                    )}
                    style={{ ...style, height: item.size }}
                  >
                    <CollapsibleHeader
                      className="h-8 w-full"
                      isExpanded={!row.isCollapsed}
                      forceChevronVisible={row.isCollapsed}
                      onToggle={() => onToggleSection(row.sectionId)}
                      toneClassName={getCollapsibleHeaderToneClass(
                        !row.isCollapsed,
                      )}
                      summaryContent={
                        <span className="flex items-center gap-2 text-sm font-medium">
                          <span>{row.label}</span>
                          <span className="text-xs tabular-nums text-subtle-foreground">
                            {row.count}
                          </span>
                        </span>
                      }
                    />
                  </div>
                );
              }
              const agent = agentFor(row.thread);
              return (
                <div
                  key={item.key}
                  data-index={item.index}
                  className="left-0 w-full"
                  style={{ ...style, height: item.size }}
                >
                  <ThreadsPageRow
                    thread={row.thread}
                    depth={row.depth}
                    agent={agent}
                    project={
                      projects.get(row.thread.projectId) ?? PERSONAL_PROJECT
                    }
                    modelLabel={modelLabelFor(row.thread, agent)}
                    providerId={agent?.providerId ?? row.thread.providerId}
                    hasDraft={draftThreadIds.has(row.thread.id)}
                    now={now}
                    isActive={activeThreadId === row.thread.id}
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>
    </ResourceCollectionViewport>
  );
}
