import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { useMediaQuery } from "@bb/shared-ui/hooks/use-media-query";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import {
  agentModelLabel,
  providerDisplayName,
} from "@/components/agents/agent-display";
import { ProviderMark } from "@/components/agents/ProviderMark";
import { ProjectColorDot } from "@/components/projects/ProjectColorDot";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { APP_OVERLAY_LAYER } from "@/components/ui/app-overlay-layers";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { useProjectColor } from "@/hooks/queries/project-color-query";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { reasoningLevelLabel } from "@/lib/reasoning-labels";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  formatRelativeAge,
  getThreadLastActivityAt,
  useRelativeTimeNow,
} from "./ThreadRowMeta";
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
}

function SidebarThreadHoverCardBody({ thread }: { thread: ThreadListEntry }) {
  const now = useRelativeTimeNow();
  const projectName = useSidebarProjectName(thread.projectId);
  const isPersonal = thread.projectId === PERSONAL_PROJECT_ID || !projectName;
  const projectColor = useProjectColor(isPersonal ? null : thread.projectId);
  const providers = useSystemProviders().data;
  const agent = resolveThreadAgent(useAgents().data ?? [], thread.agentId);
  const at = getThreadLastActivityAt(thread);
  const age = formatRelativeAge(at, now);
  const providerId = agent?.providerId ?? thread.providerId;
  const provider = providers?.find((entry) => entry.id === providerId);
  const worktree =
    thread.environmentProviderId !== null ? thread.environmentName : null;
  return (
    <div className="flex flex-col gap-2 px-3.5 py-3 text-xs leading-4">
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
      <div className="flex flex-col gap-1.5 border-t border-border pt-2.5 text-muted-foreground">
        <span
          data-sidebar-thread-hover-card-model=""
          className="flex min-h-4 min-w-0 items-center gap-1.5"
        >
          <ProviderMark
            providerId={providerId}
            className="size-3.5 text-subtle-foreground"
          />
          {agent === null ? (
            <span className="min-w-0 truncate">
              {providerDisplayName(providers, providerId)}
            </span>
          ) : (
            <>
              <span className="min-w-0 truncate">{agentModelLabel(agent)}</span>
              <span className="shrink-0 text-subtle-foreground">
                {reasoningLevelLabel(agent.reasoningLevel, provider)}
              </span>
            </>
          )}
        </span>
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
      </div>
    </div>
  );
}

export function SidebarThreadHoverCard({
  container,
  threadsById,
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
          if (row === undefined || row.getBoundingClientRect().height === 0) {
            return;
          }
          setTarget({ threadId, row });
        },
        onHide: () => setTarget(null),
      }),
    };
  });

  const hideNow = useCallback(() => controller.hideNow(), [controller]);
  const suppress = useCallback(() => controller.suppress(), [controller]);

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
    container.addEventListener("pointerdown", suppress);
    container.addEventListener("contextmenu", suppress);
    container.addEventListener("dragstart", suppress);
    return () => {
      container.removeEventListener("pointerover", onPointerOver);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("pointerdown", suppress);
      container.removeEventListener("contextmenu", suppress);
      container.removeEventListener("dragstart", suppress);
      controller.hideNow();
    };
  }, [container, controller, enabled, hideNow, rows, suppress]);

  useEffect(() => {
    if (target === null) return;
    window.addEventListener("scroll", suppress, {
      capture: true,
      passive: true,
    });
    return () =>
      window.removeEventListener("scroll", suppress, { capture: true });
  }, [suppress, target]);

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
        "pointer-events-none fixed left-0 top-0 w-72 rounded-md border border-border bg-popover text-popover-foreground shadow-md",
        "animate-in fade-in-0 duration-100",
      )}
      style={{
        zIndex: APP_OVERLAY_LAYER.sharedPortaledOverlay,
        transition: SIDEBAR_THREAD_HOVER_CARD_TRANSITION,
        willChange: "transform",
      }}
    >
      <SidebarThreadHoverCardBody thread={thread} />
    </div>,
    document.body,
  );
}
