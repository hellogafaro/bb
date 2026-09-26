import type { ReactNode } from "react";
import {
  getThreadListIndicatorLabel,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import {
  PERSONAL_PROJECT_ID,
  type Agent,
  type ProviderInfo,
  type ThreadListEntry,
} from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "@/components/sidebar/ThreadRowMeta";
import { resolveThreadStatus } from "@/components/thread/ThreadStatusGlyph";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { useProjectColor } from "@/hooks/queries/project-color-query";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { agentOptionDetail, agentScopeLabel } from "./agent-display";
import { AgentMascot } from "./mascots/AgentMascot";
import { ProviderMark } from "./ProviderMark";

export const AGENT_HOVER_CARD_CLASS_NAME =
  "w-72 rounded-md border border-border bg-popover p-3 text-popover-foreground shadow-md";

export const IDLE_THREAD_STATUS_LABEL = "Idle";

export interface AgentHoverCardThread {
  title: string;
  projectName: string;
  projectColor: number | null;
  environmentLabel: string | null;
  statusLabel: string;
  lastActivityAt: number;
}

export function agentHoverCardThreadStatusLabel(
  thread: ThreadListEntry,
  hasComposerDraft: boolean,
): string {
  const { indicatorKind } = resolveThreadStatus(
    threadListIndicatorStateForThread(thread, hasComposerDraft),
    null,
    thread.archivedAt !== null,
  );
  if (indicatorKind === "archived") return "Archived";
  return getThreadListIndicatorLabel(indicatorKind) ?? IDLE_THREAD_STATUS_LABEL;
}

export function agentHoverCardEnvironmentLabel(
  thread: Pick<ThreadListEntry, "environmentName" | "environmentBranchName">,
): string | null {
  if (thread.environmentName && thread.environmentBranchName) {
    return thread.environmentName === thread.environmentBranchName
      ? thread.environmentName
      : `${thread.environmentName} · ${thread.environmentBranchName}`;
  }
  return thread.environmentName ?? thread.environmentBranchName ?? null;
}

export function useAgentHoverCardThread(
  thread: ThreadListEntry | null,
  hasComposerDraft: boolean,
): AgentHoverCardThread | null {
  const projectId = thread?.projectId ?? null;
  const projectName = useSidebarProjectName(projectId);
  const isPersonal = projectId === PERSONAL_PROJECT_ID || !projectName;
  const projectColor = useProjectColor(isPersonal ? null : projectId);
  if (thread === null) return null;
  return {
    title: getThreadDisplayTitle(thread),
    projectName: isPersonal ? "Personal" : projectName,
    projectColor: isPersonal ? null : projectColor,
    environmentLabel: agentHoverCardEnvironmentLabel(thread),
    statusLabel: agentHoverCardThreadStatusLabel(thread, hasComposerDraft),
    lastActivityAt: getThreadLastActivityAt(thread),
  };
}

function AgentHoverCardThreadBlock({
  thread,
}: {
  thread: AgentHoverCardThread;
}) {
  const now = useRelativeTimeNow();
  return (
    <div
      data-agent-hover-card-thread=""
      className="mt-2 flex min-w-0 flex-col gap-0.5 border-t border-border pt-2"
    >
      <span className="truncate text-xs font-medium text-foreground">
        {thread.title}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-meta text-subtle-foreground">
        <ProjectColorDot color={thread.projectColor} />
        <span className="min-w-0 truncate">{thread.projectName}</span>
        {thread.environmentLabel === null ? null : (
          <>
            <span className="shrink-0" aria-hidden>
              ·
            </span>
            <span className="min-w-0 truncate">{thread.environmentLabel}</span>
          </>
        )}
      </span>
      <span className="flex min-w-0 items-center gap-1 text-meta text-subtle-foreground">
        <span className="min-w-0 truncate">{thread.statusLabel}</span>
        <span className="shrink-0" aria-hidden>
          ·
        </span>
        <time
          className="shrink-0"
          dateTime={new Date(thread.lastActivityAt).toISOString()}
        >
          {formatRelativeAge(thread.lastActivityAt, now)}
        </time>
      </span>
    </div>
  );
}

export interface AgentHoverCardContentProps {
  agent: Agent;
  providers: readonly ProviderInfo[] | undefined;
  thread?: AgentHoverCardThread | null;
  active?: boolean;
  mascot?: ReactNode;
}

export function AgentHoverCardContent({
  agent,
  providers,
  thread = null,
  active = false,
  mascot,
}: AgentHoverCardContentProps) {
  return (
    <div data-agent-hover-card="" className="flex min-w-0 flex-col">
      <span className="flex min-w-0 items-center gap-2">
        {mascot ?? (
          <AgentMascot
            mascot={agent.mascot}
            color={agent.color}
            active={active}
            className="size-4"
          />
        )}
        <span className="min-w-0 truncate text-sm font-medium text-foreground">
          {agent.name}
        </span>
      </span>
      <span className="mt-1 flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
        <ProviderMark providerId={agent.providerId} className="size-3" />
        <span className="min-w-0 truncate">
          {agentOptionDetail(agent, providers)}
        </span>
      </span>
      <span className="mt-0.5 truncate text-meta text-subtle-foreground">
        {agentScopeLabel(agent.skills, "skill", "skills")} ·{" "}
        {agentScopeLabel(agent.mcpServers, "MCP", "MCPs")}
      </span>
      {thread === null ? null : <AgentHoverCardThreadBlock thread={thread} />}
    </div>
  );
}

export function AgentHoverCardFrame({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn(AGENT_HOVER_CARD_CLASS_NAME, className)}>{children}</div>
  );
}
