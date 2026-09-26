import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { threadListIndicatorStateForThread } from "@bb/client-core";
import type { ThreadListEntry } from "@bb/domain";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  AGENT_HOVER_CARD_CLASS_NAME,
  AgentHoverCardContent,
  useAgentHoverCardThread,
} from "@/components/agents/AgentHoverCard";
import { ThreadStatusMascot } from "@/components/agents/ThreadStatusMascot";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import {
  computeSidebarHoverCardPosition,
  createSidebarHoverCardTimingController,
  resolveSidebarThreadRowFromTarget,
  SIDEBAR_THREAD_HOVER_CARD_TRANSITION,
} from "./sidebarThreadHoverCard";

const HOVER_NONE_QUERY = "(hover: none)";

interface HoverTarget {
  threadId: string;
  row: HTMLElement;
}

export interface SidebarThreadHoverCardProps {
  container: HTMLElement | null;
  threadsById: ReadonlyMap<string, ThreadListEntry>;
  draftThreadIds: ReadonlySet<string>;
}

function SidebarThreadHoverCardBody({
  thread,
  hasComposerDraft,
}: {
  thread: ThreadListEntry;
  hasComposerDraft: boolean;
}) {
  const agents = useAgents().data ?? [];
  const providers = useSystemProviders().data;
  const agent = resolveThreadAgent(agents, thread.agentId);
  const cardThread = useAgentHoverCardThread(thread, hasComposerDraft);
  if (agent === null) return null;
  const indicatorState = threadListIndicatorStateForThread(
    thread,
    hasComposerDraft,
  );
  return (
    <AgentHoverCardContent
      agent={agent}
      providers={providers}
      thread={cardThread}
      mascot={
        <ThreadStatusMascot
          {...indicatorState}
          agent={agent}
          archived={thread.archivedAt !== null}
          decorative
        />
      }
    />
  );
}

export function SidebarThreadHoverCard({
  container,
  threadsById,
  draftThreadIds,
}: SidebarThreadHoverCardProps) {
  const isCompactViewport = useIsCompactViewport();
  const isCoarsePointer = usePointerCoarse();
  const hasNoHover = useMediaQuery(HOVER_NONE_QUERY);
  const enabled = !isCompactViewport && !isCoarsePointer && !hasNoHover;
  const [target, setTarget] = useState<HoverTarget | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  const [{ controller, rows }] = useState(() => {
    const rowElements = new Map<string, HTMLElement>();
    return {
      rows: rowElements,
      controller: createSidebarHoverCardTimingController({
        onShow: (threadId) => {
          const row = rowElements.get(threadId);
          if (row === undefined) return;
          setTarget({ threadId, row });
        },
        onHide: () => setTarget(null),
      }),
    };
  });

  const hideNow = useCallback(() => controller.hideNow(), [controller]);

  useEffect(() => () => controller.dispose(), [controller]);

  useEffect(() => {
    hideNow();
  }, [hideNow, location.pathname]);

  useEffect(() => {
    if (!enabled) {
      hideNow();
      return;
    }
    if (container === null) return;
    const onPointerOver = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const resolved = resolveSidebarThreadRowFromTarget(
        event.target,
        container,
      );
      if (resolved === null) {
        controller.leaveRows();
        return;
      }
      rows.set(resolved.threadId, resolved.row);
      controller.enterRow(resolved.threadId);
    };
    const onPointerLeave = () => controller.leaveRows();
    container.addEventListener("pointerover", onPointerOver);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("pointerdown", hideNow);
    container.addEventListener("contextmenu", hideNow);
    container.addEventListener("dragstart", hideNow);
    return () => {
      container.removeEventListener("pointerover", onPointerOver);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", hideNow);
      container.removeEventListener("contextmenu", hideNow);
      container.removeEventListener("dragstart", hideNow);
      controller.hideNow();
    };
  }, [container, controller, enabled, hideNow, rows]);

  useEffect(() => {
    if (target === null) return;
    window.addEventListener("scroll", hideNow, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", hideNow, { capture: true });
  }, [hideNow, target]);

  useEffect(() => {
    if (target !== null && !threadsById.has(target.threadId)) hideNow();
  }, [hideNow, target, threadsById]);

  useLayoutEffect(() => {
    const card = cardRef.current;
    if (target === null || card === null) return;
    const anchor = target.row.getBoundingClientRect();
    const position = computeSidebarHoverCardPosition({
      anchor,
      card: { width: card.offsetWidth, height: card.offsetHeight },
      viewport: { width: window.innerWidth, height: window.innerHeight },
    });
    card.style.transform = `translate3d(${position.x}px, ${position.y}px, 0)`;
    card.dataset.side = position.side;
  }, [target]);

  const thread = target === null ? undefined : threadsById.get(target.threadId);
  if (!enabled || target === null || thread === undefined) return null;

  return createPortal(
    <div
      ref={cardRef}
      role="presentation"
      data-sidebar-thread-hover-card={target.threadId}
      className={cn(
        AGENT_HOVER_CARD_CLASS_NAME,
        "pointer-events-none fixed left-0 top-0 animate-in fade-in-0 duration-100",
      )}
      style={{
        zIndex: APP_OVERLAY_LAYER.sharedPortaledOverlay,
        transition: SIDEBAR_THREAD_HOVER_CARD_TRANSITION,
        willChange: "transform",
      }}
    >
      <SidebarThreadHoverCardBody
        thread={thread}
        hasComposerDraft={draftThreadIds.has(target.threadId)}
      />
    </div>,
    document.body,
  );
}
