import { useEffect, useMemo, useRef, type KeyboardEvent } from "react";
import { NavLink } from "react-router-dom";
import type { Agent, ThreadListEntry } from "@bb/domain";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import { Icon } from "@bb/shared-ui/icon";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ThreadStatusMascot } from "@/components/agents/ThreadStatusMascot";
import { ThreadProviderContext } from "@/components/thread/thread-provider-context";
import { ThreadTimelinePanelContent } from "@/components/thread/timeline";
import {
  ThreadTitle,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";
import { useSystemProviderInfo } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";

const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

const WINDOW_ACTION_CLASS =
  "flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

interface ChildThreadWindowProps {
  agent: Agent | null;
  href: string;
  onClose: () => void;
  resolveMentionLink?: PromptMentionLinkResolver;
  thread: ThreadListEntry;
  title: string;
}

function useStickToBottom(
  scrollRef: React.RefObject<HTMLDivElement | null>,
  contentRef: React.RefObject<HTMLDivElement | null>,
): void {
  const isStuckRef = useRef(true);
  useEffect(() => {
    const scrollElement = scrollRef.current;
    const contentElement = contentRef.current;
    if (!scrollElement || !contentElement) return;
    const scrollToBottom = () => {
      scrollElement.scrollTop = scrollElement.scrollHeight;
    };
    const handleScroll = () => {
      const distanceFromBottom =
        scrollElement.scrollHeight -
        scrollElement.scrollTop -
        scrollElement.clientHeight;
      isStuckRef.current = distanceFromBottom <= STICK_TO_BOTTOM_THRESHOLD_PX;
    };
    const observer = new ResizeObserver(() => {
      if (isStuckRef.current) scrollToBottom();
    });
    scrollToBottom();
    observer.observe(contentElement);
    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      observer.disconnect();
      scrollElement.removeEventListener("scroll", handleScroll);
    };
  }, [contentRef, scrollRef]);
}

export function ChildThreadWindow({
  agent,
  href,
  onClose,
  resolveMentionLink,
  thread,
  title,
}: ChildThreadWindowProps) {
  const threadId = thread.id;
  const threadQuery = useThread(threadId);
  const environmentId = threadQuery.data?.environmentId ?? null;
  const providerId = thread.providerId;
  const providerInfo = useSystemProviderInfo(
    environmentId === null
      ? { enabled: true, providerId }
      : { enabled: true, environmentId, providerId },
  );
  const pluginId = providerInfo?.pluginId ?? null;
  const providerContextValue = useMemo(
    () => ({ providerId, pluginId }),
    [pluginId, providerId],
  );
  const titleText = useThreadTitleDisplayText(title);
  const indicator = threadListIndicatorStateForThread(thread, false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useStickToBottom(scrollRef, contentRef);
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
  };

  return (
    <ThreadProviderContext.Provider value={providerContextValue}>
      <section
        aria-label={`Child thread: ${titleText}`}
        data-testid="child-thread-window"
        data-child-thread-window={threadId}
        onKeyDown={handleKeyDown}
        className="mb-2 flex min-w-0 max-w-full flex-col overflow-hidden rounded-lg border border-border bg-surface-recessed text-xs text-muted-foreground"
      >
        <div className="flex min-h-9 shrink-0 items-center gap-2 border-b border-border-hairline py-1.5 pl-3 pr-1.5">
          <span className="flex size-4 shrink-0 items-center justify-center">
            <ThreadStatusMascot {...indicator} agent={agent} size="compact" />
          </span>
          <h3 className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
            <ThreadTitle title={title} inline />
          </h3>
          <span className="flex shrink-0 items-center gap-0.5">
            <NavLink
              to={href}
              aria-label={`Open ${titleText}`}
              title="Open thread"
              className={WINDOW_ACTION_CLASS}
            >
              <Icon
                name="ExternalLink"
                className="size-3.5"
                aria-hidden="true"
              />
            </NavLink>
            <button
              type="button"
              aria-label="Close child thread"
              title="Close"
              onClick={onClose}
              className={WINDOW_ACTION_CLASS}
            >
              <Icon name="X" className="size-3.5" aria-hidden="true" />
            </button>
          </span>
        </div>
        <div
          ref={scrollRef}
          className="max-h-[50vh] min-h-0 overflow-y-auto overscroll-contain"
        >
          <div ref={contentRef} className="px-3 pb-3 pt-2">
            <ThreadTimelinePanelContent
              includePluginMessageActions={false}
              projectId={thread.projectId}
              resolveMentionLink={resolveMentionLink}
              surfaceKey={`child-thread-window:${threadId}`}
              threadId={threadId}
            />
          </div>
        </div>
      </section>
    </ThreadProviderContext.Provider>
  );
}
