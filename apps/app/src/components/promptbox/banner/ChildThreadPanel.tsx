import { useEffect, useMemo, useRef } from "react";
import type { PromptMentionLinkResolver } from "@/components/promptbox/editor/prompt-mention-link";
import { ThreadProviderContext } from "@/components/thread/thread-provider-context";
import { ThreadTimelinePanelContent } from "@/components/thread/timeline";
import { useSystemProviderInfo } from "@/hooks/queries/system-queries";
import { useThread } from "@/hooks/queries/thread-queries";

const STICK_TO_BOTTOM_THRESHOLD_PX = 24;

interface ChildThreadPanelProps {
  projectId: string;
  providerId: string;
  resolveMentionLink?: PromptMentionLinkResolver;
  threadId: string;
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

export function ChildThreadPanel({
  projectId,
  providerId,
  resolveMentionLink,
  threadId,
}: ChildThreadPanelProps) {
  const threadQuery = useThread(threadId);
  const environmentId = threadQuery.data?.environmentId ?? null;
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
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);
  useStickToBottom(scrollRef, contentRef);

  return (
    <ThreadProviderContext.Provider value={providerContextValue}>
      <div
        ref={scrollRef}
        data-child-thread-panel={threadId}
        className="max-h-[50vh] overflow-y-auto overscroll-contain border-t border-border-hairline bg-background"
      >
        <div ref={contentRef} className="px-2 pb-3 pt-2">
          <ThreadTimelinePanelContent
            includePluginMessageActions={false}
            projectId={projectId}
            resolveMentionLink={resolveMentionLink}
            surfaceKey={`child-thread-panel:${threadId}`}
            threadId={threadId}
          />
        </div>
      </div>
    </ThreadProviderContext.Provider>
  );
}
