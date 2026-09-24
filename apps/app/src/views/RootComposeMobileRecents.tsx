import { useCallback, useEffect, useMemo, useRef } from "react";
import { useAtom } from "jotai";
import type { ProviderInfo, ThreadListEntry } from "@bb/domain";
import { RouteAnchor } from "@/components/ui/app-route-anchor";
import { ThreadStatusGlyph } from "@/components/thread/ThreadStatusGlyph";
import { getSidebarThreadRowPaddingLeft } from "@/components/sidebar/sidebarRowClasses";
import { SIDEBAR_WORKING_STATUS_COLOR_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { CHROME_SECTION_LABEL_CLASS } from "@bb/shared-ui/chrome-style-tokens";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { Icon } from "@bb/shared-ui/icon";
import { getThreadRoutePath, isProjectlessProjectId } from "@/lib/route-paths";
import {
  getThreadListIndicatorLabel,
  resolveThreadListIndicator,
  threadListIndicatorStateForThread,
  buildChronologicalThreadList,
  type CollapsedChildActivity,
  type ProjectThreadItem,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { formatRelativeTime } from "@/lib/relative-time";
import {
  findEnvironmentDisplayProvider,
  getEnvironmentDisplayIconName,
} from "@/lib/environment-workspace-display";
import { useSystemEnvironmentProviders } from "@/hooks/queries/environment-provider-queries";
import {
  resolveEnvironmentDisplayName,
  type EnvironmentDisplayProviderLookup,
} from "@bb/core-ui";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { cn } from "@bb/shared-ui/lib/utils";
import { usePromptDraftInputThreadIds } from "@/hooks/usePromptDraftStorage";
import { collapsedThreadIdsAtom } from "@/components/sidebar/sidebarCollapsedAtoms";

export const MOBILE_RECENT_ROW_HEIGHT_PX = 60;
export const MOBILE_RECENT_LABEL_HEIGHT_PX = 24;

const MOBILE_RECENT_ROW_HEIGHT_CLASS = "min-h-12";

type ThreadListEntryComparator = (
  left: ThreadListEntry,
  right: ThreadListEntry,
) => number;

interface GetMobileRecentThreadsArgs {
  collapsedThreadIds: ReadonlySet<string>;
  draftThreadIds: ReadonlySet<string>;
  threads: readonly ThreadListEntry[];
}

interface MobileRecentThreadRowProps {
  highlighted: boolean;
  onToggleCollapsed: (threadId: string) => void;
  projectName: string | null;
  provider: ProviderInfo | null;
  row: MobileRecentThreadRow;
}

function repeatsProjectName(
  workspaceName: string,
  projectName: string | null,
): boolean {
  return (
    projectName !== null &&
    (workspaceName === projectName ||
      workspaceName.startsWith(`${projectName} `))
  );
}

function getMobileRecentThreadMetadata({
  environmentProviderLookup,
  projectName,
  thread,
}: {
  environmentProviderLookup: EnvironmentDisplayProviderLookup;
  projectName: string | null;
  thread: ThreadListEntry;
}): string {
  const workspaceName = resolveEnvironmentDisplayName(
    {
      name: thread.environmentName,
      branchName: thread.environmentBranchName,
      path: thread.environmentPath,
      environmentProviderId: thread.environmentProviderId,
    },
    environmentProviderLookup,
  );
  return [
    projectName,
    workspaceName !== null && repeatsProjectName(workspaceName, projectName)
      ? null
      : workspaceName,
    formatRelativeTime({
      timestamp: thread.latestAttentionAt,
      now: Date.now(),
    }),
  ]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" \u00b7 ");
}

interface RootComposeMobileRecentsProps {
  highlightedThreadId: string | null;
  projectNamesById: ReadonlyMap<string, string>;
  providersById: ReadonlyMap<string, ProviderInfo>;
  showCreatingRow: boolean;
  threads: readonly ThreadListEntry[];
}

const compareMobileRecentThreads: ThreadListEntryComparator = (left, right) => {
  const latestAttentionAtDelta =
    right.latestAttentionAt - left.latestAttentionAt;
  if (latestAttentionAtDelta !== 0) {
    return latestAttentionAtDelta;
  }

  const createdAtDelta = right.createdAt - left.createdAt;
  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  return left.id.localeCompare(right.id);
};

export interface MobileRecentThreadRow {
  thread: ThreadListEntry;
  depth: number;
  childActivity: CollapsedChildActivity;
  hasUnsubmittedDraft: boolean;
  hasChildren: boolean;
  isCollapsed: boolean;
}

function flattenMobileRecentNodes({
  collapsedThreadIds,
  draftThreadIds,
  items,
  rows,
}: {
  collapsedThreadIds: ReadonlySet<string>;
  draftThreadIds: ReadonlySet<string>;
  items: readonly ProjectThreadItem[];
  rows: MobileRecentThreadRow[];
}): void {
  for (const item of items) {
    if (item.kind !== "thread") continue;
    const { node } = item;
    const hasChildren = node.children.length > 0;
    const isCollapsed = hasChildren && collapsedThreadIds.has(node.thread.id);
    rows.push({
      thread: node.thread,
      depth: node.depth,
      childActivity: node.stats.childActivity,
      hasUnsubmittedDraft: draftThreadIds.has(node.thread.id),
      hasChildren,
      isCollapsed,
    });
    if (hasChildren && !isCollapsed) {
      flattenMobileRecentNodes({
        collapsedThreadIds,
        draftThreadIds,
        items: node.children,
        rows,
      });
    }
  }
}

export function getMobileRecentAncestorIds({
  threadId,
  threads,
}: {
  threadId: string;
  threads: readonly ThreadListEntry[];
}): string[] {
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const selected = byId.get(threadId);
  if (selected === undefined || selected.visibility === "hidden") {
    return [];
  }

  const ancestorIds: string[] = [];
  let current: ThreadListEntry | undefined = selected;
  let remainingHops = byId.size;
  while (current !== undefined && remainingHops > 0) {
    const parentThreadId: string | null = current.parentThreadId;
    if (parentThreadId === null) break;
    const parent = byId.get(parentThreadId);
    if (parent === undefined) break;
    ancestorIds.push(parent.id);
    current = parent;
    remainingHops -= 1;
  }
  return ancestorIds;
}

export function getMobileRecentThreads({
  collapsedThreadIds,
  draftThreadIds,
  threads,
}: GetMobileRecentThreadsArgs): MobileRecentThreadRow[] {
  const rows: MobileRecentThreadRow[] = [];
  flattenMobileRecentNodes({
    collapsedThreadIds,
    draftThreadIds,
    items: buildChronologicalThreadList(
      threads,
      compareMobileRecentThreads,
      draftThreadIds,
    ),
    rows,
  });
  return rows;
}

function MobileRecentThreadRow({
  highlighted,
  onToggleCollapsed,
  projectName,
  provider,
  row,
}: MobileRecentThreadRowProps) {
  const {
    thread,
    depth,
    childActivity,
    hasUnsubmittedDraft,
    hasChildren,
    isCollapsed,
  } = row;
  const touchStartedBeforeLink = useRef(false);
  const { providers: environmentProviders } = useSystemEnvironmentProviders();
  const threadTitle = getThreadDisplayTitle(thread);
  const indicatorState: ThreadListIndicatorState =
    threadListIndicatorStateForThread(thread, hasUnsubmittedDraft);
  const hasHiddenChildren = hasChildren && isCollapsed;
  const trailingIndicatorState: ThreadListIndicatorState = hasHiddenChildren
    ? {
        hasPendingInteraction:
          indicatorState.hasPendingInteraction || childActivity.pending,
        hasUnsubmittedDraft:
          indicatorState.hasUnsubmittedDraft ||
          childActivity.hasUnsubmittedDraft,
        hasUnreadError:
          indicatorState.hasUnreadError || childActivity.unreadError,
        hasUnreadSuccess:
          indicatorState.hasUnreadSuccess ||
          (childActivity.unread && !childActivity.unreadError),
        isBackgroundAgentActive:
          indicatorState.isBackgroundAgentActive ||
          childActivity.backgroundAgent,
        isBackgroundCommandActive:
          indicatorState.isBackgroundCommandActive ||
          childActivity.backgroundCommand,
        isGoalActive: indicatorState.isGoalActive || childActivity.goal,
        queuedWork: indicatorState.queuedWork,
        isPlanModeActive:
          indicatorState.isPlanModeActive || childActivity.planMode,
        isRuntimeActive:
          indicatorState.isRuntimeActive || childActivity.runtimeWorking,
        isWorkflowActive:
          indicatorState.isWorkflowActive || childActivity.workflow,
      }
    : indicatorState;
  const indicatorKind = resolveThreadListIndicator(trailingIndicatorState);
  const indicatorLabel = getThreadListIndicatorLabel(indicatorKind);
  const environmentProviderLookup = findEnvironmentDisplayProvider(
    environmentProviders,
    thread.environmentProviderId,
  );
  const metadataText = getMobileRecentThreadMetadata({
    environmentProviderLookup,
    projectName,
    thread,
  });
  const workspaceIconName = getEnvironmentDisplayIconName(
    environmentProviderLookup,
  );
  const providerIcon = getProviderIconInfo(
    "agent",
    thread.providerId,
    provider,
  );
  const ProviderMark = providerIcon?.icon;
  const providerTile = (
    <span
      data-mobile-recent-provider-tile=""
      className={cn(
        "flex size-4 shrink-0 items-center justify-center",
        depth > 0 && "opacity-60",
      )}
    >
      {ProviderMark === undefined ? null : provider === null ? (
        <ProviderMark className="size-4" />
      ) : (
        <ProviderIconMark
          provider={provider}
          icon={ProviderMark}
          className="size-4"
        />
      )}
    </span>
  );
  return (
    <li
      onTouchStart={(event) => {
        const touch = event.touches[0];
        const link = event.currentTarget.querySelector("a");
        touchStartedBeforeLink.current =
          hasChildren &&
          touch !== undefined &&
          link !== null &&
          touch.clientX < link.getBoundingClientRect().left;
      }}
      style={{ paddingLeft: getSidebarThreadRowPaddingLeft(depth) }}
      className={cn(
        "mb-0.5 flex items-center gap-2 rounded-md pr-2 [contain-intrinsic-size:auto_48px] [content-visibility:auto] hover:bg-sidebar-accent",
        MOBILE_RECENT_ROW_HEIGHT_CLASS,
        highlighted && "bg-surface-selected",
        hasUnsubmittedDraft &&
          !highlighted &&
          "[background-image:linear-gradient(var(--surface-draft),var(--surface-draft))] hover:[background-image:none]",
      )}
    >
      {hasChildren ? (
        <button
          type="button"
          aria-expanded={!isCollapsed}
          aria-label={
            isCollapsed
              ? `Show threads under ${threadTitle}`
              : `Hide threads under ${threadTitle}`
          }
          className="group relative -ml-6 flex h-11 w-13 shrink-0 cursor-pointer items-center rounded-md pl-6 outline-none"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onToggleCollapsed(thread.id);
          }}
        >
          <Icon
            name="ChevronRight"
            className={cn(
              "absolute left-2 size-3 text-subtle-foreground transition-transform duration-150 group-hover:text-muted-foreground group-focus-visible:text-muted-foreground",
              !isCollapsed && "rotate-90",
              depth > 0 && "opacity-60",
            )}
            aria-hidden="true"
          />
          {providerTile}
        </button>
      ) : (
        providerTile
      )}
      <RouteAnchor
        href={getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        })}
        aria-label={`Open ${threadTitle}${indicatorLabel ? ` — ${indicatorLabel}` : ""}`}
        onClick={(event) => {
          const ignoreTouchClick = touchStartedBeforeLink.current;
          touchStartedBeforeLink.current = false;
          if (event.detail > 0 && ignoreTouchClick) {
            event.preventDefault();
          }
        }}
        className={cn(
          "flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
          MOBILE_RECENT_ROW_HEIGHT_CLASS,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="w-full min-w-0 overflow-hidden whitespace-nowrap text-sm leading-5 [mask-image:linear-gradient(to_right,#000_calc(100%-12px),transparent)]">
              {threadTitle}
            </span>
          </span>
          <span
            className="flex min-w-0 items-center gap-1 text-meta text-subtle-foreground"
            title={metadataText}
          >
            {workspaceIconName ? (
              <Icon
                name={workspaceIconName}
                className="size-3 shrink-0"
                aria-hidden="true"
              />
            ) : null}
            <span className="min-w-0 truncate">{metadataText}</span>
          </span>
        </span>
        {indicatorKind !== "none" ? (
          <span className="flex size-6 shrink-0 items-center justify-center">
            <ThreadStatusGlyph {...trailingIndicatorState} />
          </span>
        ) : null}
      </RouteAnchor>
    </li>
  );
}

export function RootComposeMobileRecents({
  highlightedThreadId,
  projectNamesById,
  providersById,
  showCreatingRow,
  threads,
}: RootComposeMobileRecentsProps) {
  const [collapsedThreadIdList, setCollapsedThreadIdList] = useAtom(
    collapsedThreadIdsAtom,
  );
  const collapsedThreadIds = useMemo(
    () => new Set(collapsedThreadIdList),
    [collapsedThreadIdList],
  );
  const draftThreadIds = usePromptDraftInputThreadIds(threads);
  const toggleCollapsed = useCallback(
    (threadId: string) => {
      setCollapsedThreadIdList((current) =>
        current.includes(threadId)
          ? current.filter((id) => id !== threadId)
          : [...current, threadId],
      );
    },
    [setCollapsedThreadIdList],
  );
  useEffect(() => {
    if (highlightedThreadId === null) return;
    const ancestorIds = getMobileRecentAncestorIds({
      threadId: highlightedThreadId,
      threads,
    });
    if (ancestorIds.length === 0) return;
    setCollapsedThreadIdList((current) => {
      const next = current.filter((id) => !ancestorIds.includes(id));
      return next.length === current.length ? current : next;
    });
  }, [highlightedThreadId, setCollapsedThreadIdList, threads]);
  const recentThreads = useMemo(
    () =>
      getMobileRecentThreads({
        collapsedThreadIds,
        draftThreadIds,
        threads,
      }),
    [collapsedThreadIds, draftThreadIds, threads],
  );

  if (!showCreatingRow && recentThreads.length === 0) {
    return null;
  }

  return (
    <section
      data-root-compose-mobile-recents=""
      aria-labelledby="root-compose-mobile-recents"
      className="md:hidden"
    >
      <div className="mb-1 px-2">
        <h2
          id="root-compose-mobile-recents"
          className={cn(CHROME_SECTION_LABEL_CLASS, "text-sm leading-5")}
        >
          Recent
        </h2>
      </div>
      {showCreatingRow ? (
        <div
          role="status"
          className={cn(
            "flex items-center gap-2.5 rounded-md px-2 text-sm text-muted-foreground",
            MOBILE_RECENT_ROW_HEIGHT_CLASS,
          )}
        >
          <span className="min-w-0 flex-1 truncate">Creating thread</span>
          <span className="flex size-6 shrink-0 items-center justify-center">
            <Icon
              name="Loading"
              className={cn(
                "shrink-0 animate-spin",
                SIDEBAR_WORKING_STATUS_COLOR_CLASS,
                COARSE_POINTER_ICON_SIZE_CLASS,
              )}
              aria-hidden="true"
            />
          </span>
        </div>
      ) : null}
      {recentThreads.length > 0 ? (
        <ul className="space-y-px">
          {recentThreads.map((row) => (
            <MobileRecentThreadRow
              key={row.thread.id}
              highlighted={row.thread.id === highlightedThreadId}
              onToggleCollapsed={toggleCollapsed}
              provider={providersById.get(row.thread.providerId) ?? null}
              projectName={
                isProjectlessProjectId(row.thread.projectId)
                  ? null
                  : (projectNamesById.get(row.thread.projectId) ?? null)
              }
              row={row}
            />
          ))}
        </ul>
      ) : null}
    </section>
  );
}
