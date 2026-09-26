import { memo, useCallback, type MouseEvent } from "react";
import { Link } from "react-router-dom";
import { useStore } from "jotai";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import type { Agent, ThreadListEntry } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import { Pill } from "@bb/shared-ui/pill";
import { ThreadStatusMascot } from "@/components/agents/ThreadStatusMascot";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import { SIDEBAR_ROW_ACTION_BUTTON_CLASS } from "@/components/sidebar/sidebarRowClasses";
import { SidebarRowControls } from "@/components/sidebar/SidebarRowControls";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
} from "@/components/sidebar/ThreadRowMeta";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
  ThreadArchiveQuickAction,
} from "@/components/thread/ThreadActionsMenu";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { formatWakeLabel } from "@/components/thread/ThreadSnoozeControls";
import { ThreadTitleMentions } from "@/components/thread/ThreadTitleMentions";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions";
import { openThreadInSplit } from "@/lib/split-layout/openThreadInSplit";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export interface ThreadsPageRowProject {
  name: string;
  color: number | null;
}

export interface ThreadsPageRowProps {
  thread: ThreadListEntry;
  depth: number;
  agent: Agent | null;
  project: ThreadsPageRowProject;
  hasDraft: boolean;
  now: number;
  isActive: boolean;
}

export const THREADS_PAGE_ROW_PADDING_PX = 8;
export const THREADS_PAGE_DEPTH_INDENT_PX = 20;
const GLYPH_CENTER_OFFSET_PX = 8;

export function threadsPageGuideLineLeft(level: number): number {
  return (
    THREADS_PAGE_ROW_PADDING_PX +
    level * THREADS_PAGE_DEPTH_INDENT_PX +
    GLYPH_CENTER_OFFSET_PX
  );
}

const TIME_CLASS =
  "w-8 shrink-0 text-right text-meta tabular-nums text-subtle-foreground";

export const ThreadsPageRow = memo(function ThreadsPageRow({
  thread,
  depth,
  agent,
  project,
  hasDraft,
  now,
  isActive,
}: ThreadsPageRowProps) {
  const store = useStore();
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const { requestRename } = useThreadActions();
  const title = getThreadDisplayTitle(thread);
  const archived = thread.archivedAt !== null;
  const statusProps = threadListIndicatorStateForThread(thread, hasDraft);
  const wakesAt =
    !archived && thread.snoozedUntil !== null && thread.snoozedUntil > now
      ? thread.snoozedUntil
      : null;
  const timestamp = archived
    ? (thread.archivedAt ?? thread.updatedAt)
    : getThreadLastActivityAt(thread);
  const openInSplit = useCallback(() => {
    openThreadInSplit({
      store,
      navigate,
      projectId: thread.projectId,
      threadId: thread.id,
      isCompact,
    });
  }, [isCompact, navigate, store, thread.id, thread.projectId]);
  const handleClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      if (isCompact || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      openInSplit();
    },
    [isCompact, openInSplit],
  );
  const rename = useCallback(
    () => requestRename(thread),
    [requestRename, thread],
  );

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={isCompact ? undefined : openInSplit}
      onRename={rename}
    >
      <div
        data-threads-page-row={thread.id}
        data-threads-page-row-active={isActive ? "" : undefined}
        className={cn(
          SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
          "relative flex h-10 items-center gap-2.5 rounded-md pr-2 text-sm",
          LIST_HOVER_TRANSITION,
          isActive
            ? "bg-accent text-foreground"
            : "text-foreground hover:bg-state-hover has-[[data-state=open]]:bg-state-hover",
        )}
        style={{
          paddingLeft:
            THREADS_PAGE_ROW_PADDING_PX + depth * THREADS_PAGE_DEPTH_INDENT_PX,
        }}
      >
        {Array.from({ length: depth }, (_, level) => (
          <span
            key={level}
            aria-hidden="true"
            className="pointer-events-none absolute bottom-0 top-0 w-px bg-border-hairline opacity-70"
            style={{ left: threadsPageGuideLineLeft(level) }}
          />
        ))}
        <Link
          to={getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          })}
          aria-label={title}
          aria-current={isActive ? "page" : undefined}
          onClick={handleClick}
          className="absolute inset-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <span className="pointer-events-none inline-flex size-4 shrink-0 items-center justify-center">
          <ThreadStatusMascot
            {...statusProps}
            agent={agent}
            archived={archived}
          />
        </span>
        <span
          className="pointer-events-none min-w-0 flex-1 truncate"
          title={title}
        >
          <ThreadTitleMentions title={title} />
        </span>
        <span
          className={cn(
            SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
            "pointer-events-none flex shrink-0 items-center gap-2.5",
          )}
        >
          <Pill
            variant="outline"
            size="sm"
            className="max-w-40 text-meta text-muted-foreground"
            leading={<ProjectColorDot color={project.color} />}
          >
            {project.name}
          </Pill>
          {wakesAt !== null ? (
            <time
              className={TIME_CLASS}
              dateTime={new Date(wakesAt).toISOString()}
              title={`Wakes ${new Date(wakesAt).toLocaleString()}`}
            >
              {formatWakeLabel(wakesAt, now)}
            </time>
          ) : (
            <time
              className={TIME_CLASS}
              dateTime={new Date(timestamp).toISOString()}
              title={`${archived ? "Archived" : "Last update"}: ${new Date(timestamp).toLocaleString()}`}
            >
              {formatRelativeAge(timestamp, now)}
            </time>
          )}
        </span>
        <div
          className={cn(
            SIDEBAR_HOVER_ACTIONS_CLASS,
            "absolute inset-y-0 right-0 z-[1] flex items-center rounded-r-md pl-10 pr-1 max-md:pointer-coarse:hidden",
            "[background-image:linear-gradient(to_right,transparent,color-mix(in_oklab,var(--state-hover),var(--background))_40%)]",
          )}
        >
          <SidebarRowControls
            primaryAction={
              <ThreadArchiveQuickAction
                thread={thread}
                className={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
              />
            }
          >
            <ThreadActionsMenu
              thread={thread}
              triggerClassName={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
              onOpenInSplit={isCompact ? undefined : openInSplit}
              onRename={rename}
            />
          </SidebarRowControls>
        </div>
      </div>
    </ThreadActionsContextMenu>
  );
});
