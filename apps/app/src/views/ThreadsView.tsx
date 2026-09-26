import { useCallback, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { isSidebarProjectThread } from "@bb/client-core";
import {
  ResourceCollectionPage,
  ResourceCreateButton,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import { cn } from "@bb/shared-ui/lib/utils";
import { resolveThreadsListRoute } from "@/components/threads-page/threads-page-navigation";
import { ThreadsPageList } from "@/components/threads-page/ThreadsPageList";
import {
  buildActiveThreadsPageRows,
  buildArchivedThreadsPageRows,
  type ThreadsPageSectionId,
} from "@/components/threads-page/threads-page-rows";
import { useRelativeTimeNow } from "@/components/sidebar/ThreadRowMeta";
import { TOOLS_PAGE_BAND_CLASSES } from "@/components/tools/tools-navigation";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { useArchivedThreads } from "@/hooks/queries/thread-queries";
import { useSidebarThreadDraftIds } from "@/lib/plugin-sidebar-hooks";
import {
  getRootComposeRoutePath,
  getThreadsRoutePath,
  type ThreadsListTab,
} from "@/lib/route-paths";

export const THREADS_PAGE_DESCRIPTION =
  "Every thread across your projects, grouped by what needs you next.";

const SKELETON_ROWS = [0, 1, 2, 3];

function ThreadsPageSkeleton({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-label={label}
      className={cn(TOOLS_PAGE_BAND_CLASSES, "flex flex-col")}
    >
      {SKELETON_ROWS.map((row) => (
        <div key={row} className="flex h-10 items-center gap-2.5 px-2">
          <Skeleton className="size-4 rounded-sm" />
          <Skeleton className="h-3.5 w-56" />
        </div>
      ))}
    </div>
  );
}

function toggleSet<T>(current: ReadonlySet<T>, value: T): Set<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

export function ThreadsView() {
  const location = useLocation();
  const route = resolveThreadsListRoute(location.pathname, location.search);
  if (route === null) {
    return <Navigate to={getThreadsRoutePath()} replace />;
  }
  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <ThreadsCollection tab={route.tab} />
      </div>
    </div>
  );
}

function ThreadsCollection({ tab }: { tab: ThreadsListTab }) {
  const navigate = useNavigate();
  const navigation = useSidebarNavigation();
  const activeCount = useMemo(
    () =>
      navigation.data === undefined
        ? undefined
        : listSidebarNavigationThreads(navigation.data).filter(
            (thread) =>
              thread.archivedAt === null && isSidebarProjectThread(thread),
          ).length,
    [navigation.data],
  );
  return (
    <div className="box-border h-full w-full pb-4 pt-3 md:pt-4">
      <ResourceCollectionPage
        id="threads"
        description={THREADS_PAGE_DESCRIPTION}
        bandClassName={TOOLS_PAGE_BAND_CLASSES}
        modes={[
          { id: "all", label: "All threads", count: activeCount },
          { id: "archived", label: "Archived" },
        ]}
        activeMode={tab}
        onModeChange={(mode) => {
          if (mode !== tab) navigate(getThreadsRoutePath(mode));
        }}
        actions={
          <ResourceCreateButton
            label="New thread"
            onCreate={() =>
              navigate(getRootComposeRoutePath(), {
                state: { focusPrompt: true },
              })
            }
          />
        }
      >
        {tab === "all" ? <ActiveThreadsList /> : <ArchivedThreadsList />}
      </ResourceCollectionPage>
    </div>
  );
}

function ActiveThreadsList() {
  const navigation = useSidebarNavigation();
  const draftThreadIds = useSidebarThreadDraftIds();
  const now = useRelativeTimeNow();
  const [collapsed, setCollapsed] = useState<ReadonlySet<ThreadsPageSectionId>>(
    () => new Set(),
  );
  const onToggleSection = useCallback((sectionId: ThreadsPageSectionId) => {
    setCollapsed((current) => toggleSet(current, sectionId));
  }, []);
  const threads = useMemo(
    () =>
      navigation.data === undefined
        ? []
        : listSidebarNavigationThreads(navigation.data).filter(
            (thread) =>
              thread.archivedAt === null && isSidebarProjectThread(thread),
          ),
    [navigation.data],
  );
  const rows = useMemo(
    () =>
      buildActiveThreadsPageRows({
        threads,
        draftThreadIds,
        now,
        collapsedSectionIds: collapsed,
      }),
    [collapsed, draftThreadIds, now, threads],
  );
  if (navigation.data === undefined) {
    return navigation.isError ? (
      <ResourceListState state="error" message="Threads are unavailable" />
    ) : (
      <ThreadsPageSkeleton label="Loading threads" />
    );
  }
  return (
    <ThreadsPageList
      rows={rows}
      scrollId="threads-all-scroll"
      emptyMessage="No threads yet"
      onToggleSection={onToggleSection}
    />
  );
}

function ArchivedThreadsList() {
  const query = useArchivedThreads({ kind: "all" });
  const [collapsed, setCollapsed] = useState<ReadonlySet<ThreadsPageSectionId>>(
    () => new Set(),
  );
  const onToggleSection = useCallback((sectionId: ThreadsPageSectionId) => {
    setCollapsed((current) => toggleSet(current, sectionId));
  }, []);
  const threads = useMemo(
    () =>
      (query.data?.pages ?? [])
        .flat()
        .filter((thread) => thread.archivedAt !== null),
    [query.data],
  );
  const rows = useMemo(
    () =>
      buildArchivedThreadsPageRows({ threads, collapsedSectionIds: collapsed }),
    [collapsed, threads],
  );
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = query;
  const onReachEnd = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [fetchNextPage, hasNextPage, isFetchingNextPage]);
  if (query.data === undefined) {
    return query.isError ? (
      <ResourceListState
        state="error"
        message="Archived threads are unavailable"
        onRetry={() => void query.refetch()}
      />
    ) : (
      <ThreadsPageSkeleton label="Loading archived threads" />
    );
  }
  return (
    <ThreadsPageList
      rows={rows}
      scrollId="threads-archived-scroll"
      emptyMessage="No archived threads"
      onToggleSection={onToggleSection}
      onReachEnd={onReachEnd}
    />
  );
}
