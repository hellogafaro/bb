import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from "@bb/shared-ui/hover-card";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  AgentModelFooter,
  HOVER_CARD_BODY_CLASS_NAME,
  HOVER_CARD_CONTENT_CLASS_NAME,
} from "@/components/agents/AgentModelFooter";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useProjectColor } from "@/hooks/queries/project-color-query";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "./ThreadRowMeta";

export const SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS = 150;

interface HoverCardTriggerState {
  suppressed: boolean;
  allowOpen: { current: boolean };
  close: () => void;
}

const TriggerStateContext = createContext<HoverCardTriggerState | null>(null);

function SidebarThreadHoverCardBody({ thread }: { thread: ThreadListEntry }) {
  const now = useRelativeTimeNow();
  const projectName = useSidebarProjectName(thread.projectId);
  const isPersonal = thread.projectId === PERSONAL_PROJECT_ID || !projectName;
  const projectColor = useProjectColor(isPersonal ? null : thread.projectId);
  const providers = useSystemProviders().data;
  const agent = resolveThreadAgent(useAgents().data ?? [], thread.agentId);
  const at = getThreadLastActivityAt(thread);
  const age = formatRelativeAge(at, now);
  const worktree =
    thread.environmentProviderId !== null ? thread.environmentName : null;
  return (
    <div className={HOVER_CARD_BODY_CLASS_NAME}>
      <div className="flex items-center justify-between gap-3 text-subtle-foreground">
        <span className="flex min-w-0 items-center gap-1.5">
          <ProjectColorDot color={isPersonal ? null : projectColor} />
          <span className="min-w-0 truncate">
            {isPersonal ? "Personal" : projectName}
          </span>
        </span>
        <time className="shrink-0" dateTime={new Date(at).toISOString()}>
          {age === "now" ? "now" : `${age} ago`}
        </time>
      </div>
      <p className="m-0 max-h-60 overflow-y-auto text-sm leading-5 text-foreground [overflow-wrap:anywhere] [scrollbar-width:thin]">
        {getThreadDisplayTitle(thread)}
      </p>
      <AgentModelFooter
        agent={agent}
        providerId={agent?.providerId ?? thread.providerId}
        providers={providers}
      >
        {thread.environmentBranchName || worktree ? (
          <span className="flex min-h-4 min-w-0 items-center gap-1.5">
            <Icon
              name="GitBranch"
              className="size-3.5 shrink-0 text-subtle-foreground"
              aria-hidden
            />
            <span className="min-w-0 truncate">
              {thread.environmentBranchName}
            </span>
            {worktree && worktree !== thread.environmentBranchName ? (
              <span className="shrink-0 text-subtle-foreground">
                {worktree}
              </span>
            ) : null}
          </span>
        ) : null}
      </AgentModelFooter>
    </div>
  );
}

export const SidebarThreadHoverCardTrigger = forwardRef<
  HTMLAnchorElement,
  ComponentPropsWithoutRef<typeof HoverCardTrigger>
>(function SidebarThreadHoverCardTrigger(
  { children, onPointerEnter, onPointerDown, onFocus, ...props },
  ref,
) {
  const state = useContext(TriggerStateContext);
  return (
    <HoverCardTrigger
      ref={ref}
      asChild
      {...props}
      onPointerEnter={(event) => {
        onPointerEnter?.(event);
        if (state !== null) state.allowOpen.current = !state.suppressed;
      }}
      onPointerDown={(event) => {
        onPointerDown?.(event);
        if (state === null) return;
        state.allowOpen.current = false;
        state.close();
      }}
      onFocus={(event) => {
        onFocus?.(event);
        event.preventDefault();
      }}
    >
      {children}
    </HoverCardTrigger>
  );
});

export function SidebarThreadHoverCard({
  thread,
  suppressed,
  children,
}: {
  thread: ThreadListEntry;
  suppressed: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const allowOpen = useRef(true);
  const visible = open && !suppressed;

  useEffect(() => {
    if (suppressed) {
      allowOpen.current = false;
      setOpen(false);
    }
  }, [suppressed]);

  useEffect(() => {
    if (!visible) return;
    const close = () => setOpen(false);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [visible]);

  const [triggerState] = useState<HoverCardTriggerState>(() => ({
    suppressed,
    allowOpen,
    close: () => setOpen(false),
  }));
  triggerState.suppressed = suppressed;

  return (
    <TriggerStateContext.Provider value={triggerState}>
      <HoverCard
        open={visible}
        onOpenChange={(next) => {
          if (next && (suppressed || !allowOpen.current)) return;
          setOpen(next);
        }}
        openDelay={SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS}
        closeDelay={0}
      >
        {children}
        <HoverCardContent
          side="right"
          align="start"
          sideOffset={12}
          data-sidebar-thread-hover-card={thread.id}
          className={cn(HOVER_CARD_CONTENT_CLASS_NAME, "pointer-events-none")}
        >
          <SidebarThreadHoverCardBody thread={thread} />
        </HoverCardContent>
      </HoverCard>
    </TriggerStateContext.Provider>
  );
}
