import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import type { SidebarThread } from "../model/sidebar-thread.js";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "../model/relative-time.js";
import {
  useSidebarData,
  useSidebarProjectName,
} from "../model/use-sidebar-data.js";

export type ThreadRowMetaLocation = "environment" | "project";

interface ThreadRowMetaProps {
  thread: SidebarThread;
  location: ThreadRowMetaLocation;
  wakesAt?: number | null;
}

interface ResolvedLocation {
  icon: IconName;
  label: string;
}

function useEnvironmentLocation(
  thread: SidebarThread,
): ResolvedLocation | null {
  const { hostsById } = useSidebarData();
  if (thread.environmentBranchName) {
    return { icon: "GitBranch", label: thread.environmentBranchName };
  }
  if (thread.environmentName) {
    return { icon: "Folder", label: thread.environmentName };
  }
  const hostName =
    thread.environmentHostId === null
      ? undefined
      : hostsById.get(thread.environmentHostId)?.name;
  return hostName ? { icon: "Laptop", label: hostName } : null;
}

function useProjectLocation(thread: SidebarThread): ResolvedLocation {
  const projectName = useSidebarProjectName(thread.projectId);
  return {
    icon: "Folder",
    label:
      thread.projectId === PERSONAL_PROJECT_ID || !projectName
        ? "Personal"
        : projectName,
  };
}

function EnvironmentMeta({
  thread,
  wakesAt,
}: Omit<ThreadRowMetaProps, "location">) {
  return (
    <MetaLine
      thread={thread}
      location={useEnvironmentLocation(thread)}
      wakesAt={wakesAt}
    />
  );
}

function ProjectMeta({
  thread,
  wakesAt,
}: Omit<ThreadRowMetaProps, "location">) {
  return (
    <MetaLine
      thread={thread}
      location={useProjectLocation(thread)}
      wakesAt={wakesAt}
    />
  );
}

export function formatWakeLabel(until: number, currentTime: number): string {
  const left = until - currentTime;
  if (left <= 0) return "now";
  const minutes = Math.max(1, Math.ceil(left / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.ceil(left / 3_600_000);
  if (hours < 24) return `${hours}h`;
  return `${Math.ceil(left / 86_400_000)}d`;
}

function MetaLine({
  thread,
  location,
  wakesAt,
}: {
  thread: SidebarThread;
  location: ResolvedLocation | null;
  wakesAt?: number | null;
}) {
  const now = useRelativeTimeNow();
  const lastActivityAt = getThreadLastActivityAt(thread);
  return (
    <span
      data-sidebar-thread-meta=""
      className="pointer-events-none col-span-full row-start-2 flex h-4 min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap pr-2 text-meta text-subtle-foreground"
    >
      {location ? (
        <>
          <Icon name={location.icon} className="size-3 shrink-0" aria-hidden />
          <span className="min-w-0 truncate" title={location.label}>
            {location.label}
          </span>
          <span className="shrink-0" aria-hidden>
            ·
          </span>
        </>
      ) : null}
      {wakesAt ? (
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

export function ThreadRowMeta({ location, ...props }: ThreadRowMetaProps) {
  return location === "project" ? (
    <ProjectMeta {...props} />
  ) : (
    <EnvironmentMeta {...props} />
  );
}
