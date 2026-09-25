import { useSyncExternalStore } from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { AgentIcon } from "@/components/agents/AgentIcon";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { formatWakeLabel } from "@/components/thread/ThreadSnoozeControls";

const CLOCK_TICK_MS = 30_000;

let clockNow = Date.now();
let clockTimer: ReturnType<typeof setInterval> | null = null;
const clockListeners = new Set<() => void>();

function tick(): void {
  clockNow = Date.now();
  for (const listener of clockListeners) listener();
}

function onVisibilityChange(): void {
  if (document.visibilityState === "visible") tick();
}

function subscribeClock(listener: () => void): () => void {
  clockListeners.add(listener);
  if (clockTimer === null) {
    clockNow = Date.now();
    clockTimer = setInterval(tick, CLOCK_TICK_MS);
    document.addEventListener("visibilitychange", onVisibilityChange);
  }
  return () => {
    clockListeners.delete(listener);
    if (clockListeners.size > 0 || clockTimer === null) return;
    clearInterval(clockTimer);
    clockTimer = null;
    document.removeEventListener("visibilitychange", onVisibilityChange);
  };
}

function getClockNow(): number {
  return clockNow;
}

export function useRelativeTimeNow(): number {
  return useSyncExternalStore(subscribeClock, getClockNow, getClockNow);
}

export function formatRelativeAge(at: number, currentTime: number): string {
  const seconds = Math.max(0, Math.floor((currentTime - at) / 1000));
  if (seconds < 60) return "now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}

export function getThreadLastActivityAt(
  thread: Pick<ThreadListEntry, "updatedAt" | "latestAttentionAt">,
): number {
  return Math.max(thread.updatedAt, thread.latestAttentionAt);
}

export function ThreadRowMeta({
  thread,
  wakesAt,
}: {
  thread: ThreadListEntry;
  wakesAt: number | null;
}) {
  const now = useRelativeTimeNow();
  const projectName = useSidebarProjectName(thread.projectId);
  const agent = resolveThreadAgent(useAgents().data ?? [], thread.agentId);
  const location =
    thread.projectId === PERSONAL_PROJECT_ID || !projectName
      ? "Personal"
      : projectName;
  const lastActivityAt = getThreadLastActivityAt(thread);
  return (
    <span
      data-sidebar-thread-meta=""
      className="pointer-events-none col-span-full row-start-2 flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap pr-2 text-meta text-subtle-foreground"
    >
      {agent === null ? null : (
        <span
          data-sidebar-thread-agent=""
          className="flex shrink-0 items-center"
        >
          <AgentIcon providerId={agent.providerId} className="size-3.5" />
        </span>
      )}
      <Icon name="Folder" className="size-3 shrink-0" aria-hidden />
      <span className="min-w-0 truncate" title={location}>
        {location}
      </span>
      <span className="shrink-0" aria-hidden>
        ·
      </span>
      {wakesAt !== null ? (
        <time
          className="shrink-0"
          dateTime={new Date(wakesAt).toISOString()}
          title={`Wakes ${new Date(wakesAt).toLocaleString()}`}
        >
          {formatWakeLabel(wakesAt, now)}
        </time>
      ) : (
        <time
          className="shrink-0"
          dateTime={new Date(lastActivityAt).toISOString()}
          title={`Last update: ${new Date(lastActivityAt).toLocaleString()}`}
        >
          {formatRelativeAge(lastActivityAt, now)}
        </time>
      )}
    </span>
  );
}
