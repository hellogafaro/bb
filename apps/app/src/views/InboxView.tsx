import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  isSidebarProjectThread,
  threadListIndicatorStateForThread,
} from "@bb/client-core";
import { buildPendingInteractionApprovalResolution } from "@bb/core-ui";
import {
  isApprovalPendingInteractionPayload,
  PERSONAL_PROJECT_ID,
  type Agent,
  type InboxSummary,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type ThreadListEntry,
} from "@bb/domain";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  ResourceCollectionViewport,
  ResourceIconFrame,
  ResourceListState,
} from "@bb/shared-ui/resource-list";
import { Skeleton } from "@bb/shared-ui/skeleton";
import {
  AgentMascot,
  agentAvatarStyle,
} from "@/components/agents/mascots/AgentMascot";
import { CUSTOMIZE_CARD_AVATAR_CLASS_NAME } from "@/components/customize/CustomizeCards";
import { PluginThreadChat } from "@/components/plugin/PluginThreadChat";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "@/components/sidebar/ThreadRowMeta";
import {
  isThreadReady,
  isThreadWaitingOnUser,
} from "@/components/sidebar/status-list/status-sections";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { appToast } from "@/components/ui/app-toast";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import {
  useMarkThreadRead,
  useMarkThreadUnread,
} from "@/hooks/mutations/thread-state-mutations";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import {
  useInboxInteractions,
  useInboxSummaries,
  useThreadOutput,
} from "@/hooks/queries/inbox-queries";
import { useSidebarNavigation } from "@/hooks/queries/sidebar-navigation-query";
import { getThreadRoutePath } from "@/lib/route-paths";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const INBOX_BAND_CLASSES = "mx-auto w-full max-w-3xl px-4 md:px-5";
const INBOX_SELECTED_CARD_CLASSES =
  "outline-2 -outline-offset-1 outline-primary";
const INBOX_KEY_HINT_CLASSES =
  "inline-flex h-4 min-w-4 items-center justify-center rounded-[3px] bg-state-hover px-1 font-sans text-2xs tabular-nums text-subtle-foreground";

interface InboxProject {
  name: string;
  color: number | null;
}

interface InboxItem {
  thread: ThreadListEntry;
  interaction: PendingInteraction | null;
}

const INBOX_KEY_HINTS: readonly { keys: string[]; label: string }[] = [
  { keys: ["↑", "↓"], label: "move" },
  { keys: ["R"], label: "reply" },
  { keys: ["E"], label: "done" },
  { keys: ["A"], label: "approve" },
  { keys: ["D"], label: "deny" },
  { keys: ["↵"], label: "open" },
];

export function InboxView() {
  return (
    <div className="-mx-4 -mb-4 -mt-4 flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:-mx-5 md:-mb-5 md:-mt-5">
      <div className="min-h-0 flex-1 overflow-hidden">
        <div className="box-border flex h-full w-full flex-col gap-3 pb-4 pt-3 md:pt-4">
          <div className="md:pr-3">
            <div className={cn(INBOX_BAND_CLASSES, "flex justify-end")}>
              <InboxKeyHints />
            </div>
          </div>
          <InboxSections />
        </div>
      </div>
    </div>
  );
}

function InboxKeyHints() {
  return (
    <div
      aria-hidden="true"
      className="hidden flex-wrap items-center gap-x-3 gap-y-1 text-2xs text-subtle-foreground md:flex pointer-coarse:hidden"
    >
      {INBOX_KEY_HINTS.map((hint) => (
        <span key={hint.label} className="inline-flex items-center gap-1">
          {hint.keys.map((key) => (
            <kbd key={key} className={INBOX_KEY_HINT_CLASSES}>
              {key}
            </kbd>
          ))}
          <span>{hint.label}</span>
        </span>
      ))}
    </div>
  );
}

function useInboxThreads() {
  const navigation = useSidebarNavigation();
  return useMemo(() => {
    const threads =
      navigation.data === undefined
        ? []
        : listSidebarNavigationThreads(navigation.data).filter(
            (thread) =>
              thread.archivedAt === null && isSidebarProjectThread(thread),
          );
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const projects = new Map<string, InboxProject>([
      [PERSONAL_PROJECT_ID, { name: "Personal", color: null }],
    ]);
    for (const project of navigation.data?.projects ?? []) {
      projects.set(project.id, { name: project.name, color: project.color });
    }
    return { threads, byId, projects, isLoaded: navigation.data !== undefined };
  }, [navigation.data]);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target.closest('[contenteditable="true"], [contenteditable=""]') !== null ||
    target.tagName === "INPUT" ||
    target.tagName === "TEXTAREA" ||
    target.tagName === "SELECT"
  );
}

function approvalDecisionFor(
  interaction: PendingInteraction | null,
  decision: PendingInteractionApprovalDecision,
): PendingInteraction | null {
  if (interaction === null) return null;
  if (!isApprovalPendingInteractionPayload(interaction.payload)) return null;
  if (!interaction.payload.availableDecisions.includes(decision)) return null;
  return interaction.status === "pending" ? interaction : null;
}

function focusInboxReply(threadId: string): void {
  const card = document.querySelector<HTMLElement>(
    `[data-inbox-card="${threadId}"]`,
  );
  const target = card?.querySelector<HTMLElement>(
    ".ProseMirror, textarea, input[type=text], [contenteditable=true]",
  );
  target?.focus();
}

function InboxSections() {
  const { threads, byId, projects, isLoaded } = useInboxThreads();
  const interactionsQuery = useInboxInteractions();
  const agents = useAgents().data;
  const now = useRelativeTimeNow();
  const navigate = useNavigate();
  const markRead = useMarkThreadRead();
  const markUnread = useMarkThreadUnread();
  const resolveInteraction = useResolveThreadPendingInteraction();
  const waiting = useMemo(
    () =>
      (interactionsQuery.data ?? []).filter((interaction) =>
        byId.has(interaction.threadId),
      ),
    [byId, interactionsQuery.data],
  );
  const items = useMemo<InboxItem[]>(() => {
    const interactionByThread = new Map<string, PendingInteraction>();
    for (const interaction of waiting) {
      if (!interactionByThread.has(interaction.threadId)) {
        interactionByThread.set(interaction.threadId, interaction);
      }
    }
    return threads
      .filter(
        (thread) =>
          interactionByThread.has(thread.id) ||
          isThreadWaitingOnUser(thread) ||
          isThreadReady(thread),
      )
      .sort((left, right) => right.latestAttentionAt - left.latestAttentionAt)
      .map((thread) => ({
        thread,
        interaction: interactionByThread.get(thread.id) ?? null,
      }));
  }, [threads, waiting]);
  const itemThreadIds = useMemo(
    () => items.map((item) => item.thread.id),
    [items],
  );
  const summaries = useInboxSummaries(itemThreadIds);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [lastIndex, setLastIndex] = useState(0);
  const selectedIndex = items.findIndex(
    (item) => item.thread.id === selectedId,
  );
  const activeIndex =
    selectedIndex >= 0
      ? selectedIndex
      : Math.min(lastIndex, Math.max(items.length - 1, 0));
  const active = items[activeIndex] ?? null;
  const activeId = active?.thread.id ?? null;
  useEffect(() => {
    if (activeId === null) return;
    const card = document.querySelector<HTMLElement>(
      `[data-inbox-card="${activeId}"]`,
    );
    card?.scrollIntoView({ block: "nearest" });
  }, [activeId]);

  const markDone = useCallback(
    (thread: ThreadListEntry) => {
      markRead.mutate({ threadId: thread.id });
      appToast.success("Marked as done", {
        description: getThreadDisplayTitle(thread),
        action: {
          label: "Undo",
          onClick: () => markUnread.mutate({ threadId: thread.id }),
        },
      });
    },
    [markRead, markUnread],
  );
  const decide = useCallback(
    (item: InboxItem, decision: PendingInteractionApprovalDecision) => {
      const interaction = approvalDecisionFor(item.interaction, decision);
      if (interaction === null) return;
      resolveInteraction.mutate({
        threadId: item.thread.id,
        interactionId: interaction.id,
        resolution: buildPendingInteractionApprovalResolution(
          interaction,
          decision,
        ),
      });
    },
    [resolveInteraction],
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey) return;
      if (event.altKey) return;
      if (isTypingTarget(event.target)) {
        if (event.key === "Escape" && event.target instanceof HTMLElement) {
          event.target.blur();
        }
        return;
      }
      if (items.length === 0) return;
      const step = (delta: number) => {
        const next = Math.min(
          Math.max(activeIndex + delta, 0),
          items.length - 1,
        );
        const target = items[next];
        if (target) {
          setSelectedId(target.thread.id);
          setLastIndex(next);
        }
      };
      switch (event.key) {
        case "ArrowDown":
        case "j":
          event.preventDefault();
          step(1);
          return;
        case "ArrowUp":
        case "k":
          event.preventDefault();
          step(-1);
          return;
        case "Enter":
        case "o":
          if (active === null) return;
          event.preventDefault();
          navigate(
            getThreadRoutePath({
              projectId: active.thread.projectId,
              threadId: active.thread.id,
            }),
          );
          return;
        case "r":
          if (active === null) return;
          event.preventDefault();
          focusInboxReply(active.thread.id);
          return;
        case "e":
          if (active === null || active.interaction !== null) return;
          event.preventDefault();
          markDone(active.thread);
          return;
        case "a":
          if (active === null) return;
          event.preventDefault();
          decide(active, "allow_once");
          return;
        case "d":
          if (active === null) return;
          event.preventDefault();
          decide(active, "deny");
          return;
        default:
          return;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, activeIndex, decide, items, markDone, navigate]);

  const agentFor = (thread: ThreadListEntry): Agent | null =>
    agents === undefined ? null : resolveThreadAgent(agents, thread.agentId);

  if (!isLoaded || (interactionsQuery.isPending && waiting.length === 0)) {
    return (
      <div
        className={INBOX_BAND_CLASSES}
        role="status"
        aria-label="Loading inbox"
      >
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
      </div>
    );
  }

  return (
    <ResourceCollectionViewport
      scrollId="inbox-scroll"
      bandClassName={INBOX_BAND_CLASSES}
    >
      <div className="w-0 min-w-full">
        <div className={cn(INBOX_BAND_CLASSES, "space-y-3 pb-6 pt-1")}>
          {items.length === 0 ? (
            <ResourceListState
              state="empty"
              message="Nothing needs you right now."
            />
          ) : (
            items.map((item, index) => (
              <InboxCard
                key={item.thread.id}
                item={item}
                parent={
                  item.thread.parentThreadId === null
                    ? null
                    : (byId.get(item.thread.parentThreadId) ?? null)
                }
                agent={agentFor(item.thread)}
                project={projects.get(item.thread.projectId)}
                now={now}
                summary={summaries.data?.byThread.get(item.thread.id) ?? null}
                summaryPending={
                  summaries.data?.pending.has(item.thread.id) ??
                  summaries.isPending
                }
                selected={item.thread.id === activeId}
                onSelect={() => {
                  setSelectedId(item.thread.id);
                  setLastIndex(index);
                }}
                onMarkDone={() => markDone(item.thread)}
              />
            ))
          )}
        </div>
      </div>
    </ResourceCollectionViewport>
  );
}

function InboxCard({
  item,
  parent,
  agent,
  project,
  now,
  summary,
  summaryPending,
  selected,
  onSelect,
  onMarkDone,
}: {
  item: InboxItem;
  parent: ThreadListEntry | null;
  agent: Agent | null;
  project: InboxProject | undefined;
  now: number;
  summary: InboxSummary | null;
  summaryPending: boolean;
  selected: boolean;
  onSelect: () => void;
  onMarkDone: () => void;
}) {
  const { thread, interaction } = item;
  const age = formatRelativeAge(getThreadLastActivityAt(thread), now);
  const href = getThreadRoutePath({
    projectId: thread.projectId,
    threadId: thread.id,
  });
  return (
    <article
      data-inbox-card={thread.id}
      data-selected={selected ? "" : undefined}
      onClick={onSelect}
      onFocusCapture={onSelect}
      className={cn(
        "min-w-0 max-w-full overflow-hidden rounded-lg border border-border bg-card outline-0 outline-transparent transition-[outline-color] duration-150",
        selected && INBOX_SELECTED_CARD_CLASSES,
      )}
    >
      <div className="flex min-w-0 items-start gap-3 px-3 pt-3 sm:px-4">
        <ResourceIconFrame
          className={cn(CUSTOMIZE_CARD_AVATAR_CLASS_NAME, "size-8 rounded-md")}
          style={agent ? agentAvatarStyle(agent.color) : undefined}
        >
          {() =>
            agent ? (
              <AgentMascot
                mascot={agent.mascot}
                color={agent.color}
                className="size-5"
              />
            ) : null
          }
        </ResourceIconFrame>
        <div className="min-w-0 flex-1">
          <Link
            to={href}
            className="block truncate text-sm font-medium text-foreground hover:underline"
          >
            {getThreadDisplayTitle(thread)}
          </Link>
          <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-xs text-subtle-foreground">
            {agent ? <span className="truncate">{agent.name}</span> : null}
            {parent ? (
              <>
                <span aria-hidden="true">·</span>
                <span className="truncate">
                  in {getThreadDisplayTitle(parent)}
                </span>
              </>
            ) : (
              <>
                <span aria-hidden="true">·</span>
                <ProjectColorDot color={project?.color ?? null} />
                <span className="truncate">
                  {project?.name ?? thread.projectId}
                </span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="shrink-0">
              {age === "now" ? "now" : `${age} ago`}
            </span>
          </span>
        </div>
        {interaction === null ? (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="-mr-1 -mt-1 size-8 shrink-0"
                aria-label="Mark done"
                onClick={(event) => {
                  event.stopPropagation();
                  onMarkDone();
                }}
              >
                <Icon name="Check" className="size-4" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Mark done</TooltipContent>
          </Tooltip>
        ) : null}
      </div>
      <div className="space-y-2.5 px-3 pb-3 pt-2.5 sm:px-4">
        <InboxSummaryLines
          thread={thread}
          summary={summary}
          summaryPending={summaryPending}
          hasInteraction={interaction !== null}
        />
        {interaction !== null && !selected ? (
          <ThreadPendingInteractionBanner
            interaction={interaction}
            threadId={thread.id}
          />
        ) : null}
      </div>
      {selected ? <InboxCardDetail thread={thread} /> : null}
    </article>
  );
}

function InboxSummaryLines({
  thread,
  summary,
  summaryPending,
  hasInteraction,
}: {
  thread: ThreadListEntry;
  summary: InboxSummary | null;
  summaryPending: boolean;
  hasInteraction: boolean;
}) {
  if (summary !== null) {
    return (
      <>
        <InboxExcerpt label="Goal" text={summary.goal} />
        <InboxExcerpt label="Status" text={summary.state} tone="foreground" />
        {summary.needs && !hasInteraction ? (
          <InboxExcerpt label="Needs" text={summary.needs} tone="foreground" />
        ) : null}
      </>
    );
  }
  const request = thread.titleFallback?.trim() || null;
  return (
    <>
      {request ? <InboxExcerpt label="Goal" text={request} /> : null}
      {summaryPending ? (
        <div className="flex gap-3">
          <span className="hidden w-16 shrink-0 sm:block" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      ) : (
        <InboxLatestOutput thread={thread} />
      )}
    </>
  );
}

function InboxCardDetail({ thread }: { thread: ThreadListEntry }) {
  return (
    <div
      data-inbox-conversation=""
      className="max-h-[36rem] overflow-y-auto border-t border-border"
    >
      <Suspense
        fallback={
          <div className="space-y-2 px-4 py-4">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        }
      >
        <PluginThreadChat
          threadId={thread.id}
          variant="compact"
          layout="document"
          readTracking={false}
          environmentSummary="none"
          composerAutoFocus={false}
          executionControls="hidden"
        />
      </Suspense>
    </div>
  );
}

function InboxExcerpt({
  label,
  text,
  tone = "muted",
}: {
  label: string;
  text: string;
  tone?: "muted" | "foreground";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 text-sm sm:flex-row sm:gap-3">
      <span className="shrink-0 text-xs text-subtle-foreground sm:w-[4.5rem] sm:pt-px">
        {label}
      </span>
      <p
        className={cn(
          "line-clamp-4 min-w-0 max-w-full whitespace-pre-wrap [overflow-wrap:anywhere]",
          tone === "muted" ? "text-muted-foreground" : "text-foreground",
        )}
      >
        {text}
      </p>
    </div>
  );
}

function InboxLatestOutput({ thread }: { thread: ThreadListEntry }) {
  const output = useThreadOutput(thread.id, thread.latestAttentionAt);
  const state = threadListIndicatorStateForThread(thread, false);
  if (output.isPending) {
    return (
      <div className="flex gap-3">
        <span className="hidden w-16 shrink-0 sm:block" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }
  const text = output.data?.output?.trim();
  if (!text) {
    return (
      <InboxExcerpt
        label="Status"
        text={
          state.hasUnreadError
            ? "The last turn failed. Open the conversation for details."
            : "No reply text yet."
        }
      />
    );
  }
  return <InboxExcerpt label="Status" text={text} tone="foreground" />;
}
