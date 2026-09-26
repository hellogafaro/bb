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
import { ProviderMark } from "@/components/agents/ProviderMark";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
} from "@/components/sidebar/ThreadRowMeta";
import { formatWakeLabel } from "@/components/thread/ThreadSnoozeControls";
import { ThreadActionsContextMenu } from "@/components/thread/ThreadActionsMenu";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { ThreadTitleMentions } from "@/components/thread/ThreadTitleMentions";
import { ThreadUnarchiveButton } from "@/components/thread/ThreadUnarchiveButton";
import { useRouteNavigate } from "@/components/ui/app-route-anchor";
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
  modelLabel: string;
  providerId: string;
  hasDraft: boolean;
  now: number;
  isActive: boolean;
}

const DEPTH_INDENT_PX = 20;
const ROW_PADDING_PX = 8;

export const ThreadsPageRow = memo(function ThreadsPageRow({
  thread,
  depth,
  agent,
  project,
  modelLabel,
  providerId,
  hasDraft,
  now,
  isActive,
}: ThreadsPageRowProps) {
  const store = useStore();
  const navigate = useRouteNavigate();
  const isCompact = useIsCompactViewport();
  const { unarchiveThread, requestRename } = useThreadActions();
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

  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={isCompact ? undefined : openInSplit}
      onRename={() => requestRename(thread)}
    >
      <div
        data-threads-page-row={thread.id}
        data-threads-page-row-active={isActive ? "" : undefined}
        className={cn(
          "group/threads-row relative flex h-10 items-center gap-2.5 rounded-md pr-2 text-sm",
          LIST_HOVER_TRANSITION,
          isActive
            ? "bg-accent text-foreground"
            : "text-foreground hover:bg-state-hover has-[[data-state=open]]:bg-state-hover",
        )}
        style={{ paddingLeft: ROW_PADDING_PX + depth * DEPTH_INDENT_PX }}
      >
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
        <span className="pointer-events-none flex shrink-0 items-center gap-1.5">
          <Pill
            variant="outline"
            size="sm"
            className="max-w-40 text-meta text-muted-foreground"
            leading={<ProjectColorDot color={project.color} />}
          >
            {project.name}
          </Pill>
          <Pill
            variant="outline"
            size="sm"
            className="hidden max-w-40 text-meta text-muted-foreground md:inline-flex"
            leading={
              <ProviderMark providerId={providerId} className="size-3" />
            }
          >
            {modelLabel}
          </Pill>
        </span>
        {archived ? (
          <span className="relative z-[1] hidden shrink-0 group-focus-within/threads-row:inline-flex group-hover/threads-row:inline-flex">
            <ThreadUnarchiveButton
              onUnarchive={() => unarchiveThread(thread)}
            />
          </span>
        ) : null}
        {wakesAt !== null ? (
          <time
            className="pointer-events-none w-8 shrink-0 text-right text-meta tabular-nums text-subtle-foreground"
            dateTime={new Date(wakesAt).toISOString()}
            title={`Wakes ${new Date(wakesAt).toLocaleString()}`}
          >
            {formatWakeLabel(wakesAt, now)}
          </time>
        ) : (
          <time
            className="pointer-events-none w-8 shrink-0 text-right text-meta tabular-nums text-subtle-foreground"
            dateTime={new Date(timestamp).toISOString()}
            title={`${archived ? "Archived" : "Last update"}: ${new Date(timestamp).toLocaleString()}`}
          >
            {formatRelativeAge(timestamp, now)}
          </time>
        )}
      </div>
    </ThreadActionsContextMenu>
  );
});
