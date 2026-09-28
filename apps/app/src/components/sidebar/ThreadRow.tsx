import { SidebarRowControls } from "./SidebarRowControls";
import {
  memo,
  useCallback,
  useState,
  type CSSProperties,
  type MouseEventHandler,
  type PointerEventHandler,
  type ReactNode,
} from "react";
import { useSetAtom } from "jotai";
import { useIsMutating } from "@tanstack/react-query";
import type { Agent, ThreadListEntry } from "@bb/domain";
import type { PluginComposerThreadRowStatus } from "@get-bb/plugin-sdk";
import { getThreadConversationCollapsedAtom } from "@/components/secondary-panel/threadSecondaryPanelAtoms";
import { SidebarStickyTier } from "@/components/ui/sidebar.js";
import { NavLink } from "react-router-dom";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
  ThreadArchiveQuickAction,
  ThreadPinQuickAction,
} from "@/components/thread/ThreadActionsMenu";
import {
  ThreadSnoozeQuickAction,
  useThreadSnoozeState,
} from "@/components/thread/ThreadSnoozeControls";
import { useThreadActions } from "@/components/thread/ThreadActionsProvider";
import { useSidebarRename } from "./SidebarInlineRename";
import {
  COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
  COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
} from "@bb/shared-ui/coarse-pointer-sizing";
import {
  SIDEBAR_HOVER_ACTIONS_CLASS,
  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
  SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
} from "@/components/ui/sidebar-hover-actions.js";
import {
  hasThreadListWorkingActivity,
  threadListIndicatorStateForThread,
  NO_COLLAPSED_CHILD_ACTIVITY,
  type CollapsedChildActivity,
  type ThreadListIndicatorState,
} from "@bb/client-core";
import { TextSkeleton } from "@bb/shared-ui/skeleton";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { getThreadRoutePath } from "@/lib/route-paths";
import { cn } from "@bb/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@bb/shared-ui/motion";
import {
  SIDEBAR_ROW_ACTION_BUTTON_CLASS,
  SIDEBAR_ROW_GLYPH_SLOT_CLASS,
  SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
  SIDEBAR_STATUS_GLYPH_BOX_CLASS,
  getSidebarThreadRowPaddingLeft,
  getSidebarThreadGroupLineLeft,
} from "./sidebarRowClasses";
import type { ConsumeDragClickSuppression } from "@/components/ui/use-drag-click-suppression";
import type { SidebarSortableDragBindings } from "./sortableMotion";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import type {
  SidebarNestTargetState,
  SidebarReorderPlacement,
  ThreadRowNestDrop,
} from "./sidebarThreadRowDroppable";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import { useSidebarThreadShortcut } from "./sidebarThreadShortcuts";
import { SplitPaneMiniMap } from "./SplitPaneMiniMap";
import { usePaneContentSplitIndicator } from "./paneContentSplitIndicator";
import { useThreadRowSplitDrag } from "./useThreadRowSplitDrag";
import { AppCommandShortcutPill } from "@/components/commands/AppCommandShortcutHint";
import {
  ThreadTitleMentions,
  useThreadTitleDisplayText,
} from "@/components/thread/ThreadTitleMentions";
import { ThreadRowMeta } from "./ThreadRowMeta";
import {
  ThreadStatusGlyph,
  resolveThreadStatus,
  type ThreadStatusGlyphProps,
} from "@/components/thread/ThreadStatusGlyph";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { ThreadStatusMascot } from "@/components/agents/ThreadStatusMascot";
import {
  SidebarThreadHoverCard,
  SidebarThreadHoverCardTrigger,
} from "./SidebarThreadHoverCard";
import { resolveThreadAgent, useAgents } from "@/hooks/queries/agent-queries";
import { usePluginThreadRowStatus } from "@/lib/plugin-thread-row-status";

const SIDEBAR_TITLE_DOUBLE_CLICK_MS = 400;

const THREAD_ROW_BASE_CLASS =
  "grid h-[var(--bb-sidebar-thread-row-height)] w-full grid-cols-[minmax(0,1fr)_auto] grid-rows-[20px_16px] content-center items-center gap-x-2 rounded-md py-1.5 pr-0 text-sm transition-colors";

const DRAFT_ROW_CLASS =
  "[background-image:linear-gradient(var(--surface-draft),var(--surface-draft))] hover:[background-image:none] has-[[data-state=open]]:[background-image:none]";

let lastSidebarTitleClick: { at: number; threadId: string } | null = null;

function consumeSidebarTitleDoubleClick(threadId: string): boolean {
  const now = Date.now();
  const previous = lastSidebarTitleClick;
  lastSidebarTitleClick = { at: now, threadId };
  return (
    previous !== null &&
    previous.threadId === threadId &&
    now - previous.at < SIDEBAR_TITLE_DOUBLE_CLICK_MS
  );
}

export function resetSidebarTitleDoubleClickForTest(): void {
  lastSidebarTitleClick = null;
}

interface ThreadRowBaseOptions {
  depth: number;
  isCompact: boolean;
  consumeClickSuppression?: ConsumeDragClickSuppression;
  dragBindings?: SidebarSortableDragBindings;
  nestDrop?: ThreadRowNestDrop;
}

export type ThreadRowOptions =
  | (ThreadRowBaseOptions & {
      kind: "default";
    })
  | (ThreadRowBaseOptions & {
      kind: "parent";
      isCollapsed: boolean;
      childCount: number;
      childActivity: CollapsedChildActivity;
      stickyLevel?: number;
      onToggleCollapsed?: (threadId: string) => void;
    });

interface ThreadRowProps {
  projectId: string;
  thread: ThreadListEntry;
  isActive: boolean;
  hasComposerDraft: boolean;
  onProjectSelect?: () => void;
  options: ThreadRowOptions;
}

type ThreadRowClickCaptureHandler = MouseEventHandler<HTMLDivElement>;

interface ThreadRowContainerArgs {
  children: ReactNode;
  className: string;
  containerRef: (element: HTMLDivElement | null) => void;
  dragBindings?: SidebarSortableDragBindings;
  nestTargetState: SidebarNestTargetState | null;
  reorderPlacement: SidebarReorderPlacement | null;
  onClickCapture?: ThreadRowClickCaptureHandler;
  onSplitDragPointerDown?: PointerEventHandler<HTMLElement>;
  stickyLevel?: number;
  style: CSSProperties;
}

const NEST_TARGET_STATE_CLASS: Record<SidebarNestTargetState, string> = {
  valid:
    "bg-sidebar-accent text-sidebar-accent-foreground ring-1 ring-inset ring-sidebar-ring",
  blocked: "ring-1 ring-inset ring-destructive/60",
  unchanged: "ring-1 ring-inset ring-sidebar-border",
};

export const REORDER_PLACEMENT_CLASS: Record<SidebarReorderPlacement, string> =
  {
    before:
      "before:pointer-events-none before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-sidebar-ring before:content-['']",
    after:
      "after:pointer-events-none after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-sidebar-ring after:content-['']",
  };

function getThreadRowStyle(
  depth: number,
  stickyLevel: number | undefined,
): CSSProperties {
  const style: CSSProperties & Record<`--${string}`, string> = {
    paddingLeft: getSidebarThreadRowPaddingLeft(depth),
  };
  if (stickyLevel !== undefined) {
    style["--bb-sidebar-sticky-tier-height"] =
      "var(--bb-sidebar-thread-row-height)";
  }
  return style;
}

function renderThreadRowContainer({
  children,
  className,
  containerRef,
  dragBindings,
  nestTargetState,
  onClickCapture,
  onSplitDragPointerDown,
  reorderPlacement,
  stickyLevel,
  style,
}: ThreadRowContainerArgs) {
  const containerProps = {
    "data-sidebar-rename-row": "",
    className,
    style,
    "data-sidebar-nest-target": nestTargetState ?? undefined,
    "data-sidebar-reorder-placement": reorderPlacement ?? undefined,
    ...dragBindings?.attributes,
    ...(dragBindings?.listeners ?? {}),
    onClickCapture,
    onPointerDown: onSplitDragPointerDown,
  };
  if (stickyLevel !== undefined) {
    return (
      <SidebarStickyTier
        ref={containerRef}
        tier="parent"
        level={stickyLevel}
        {...containerProps}
      >
        {children}
      </SidebarStickyTier>
    );
  }

  return (
    <div ref={containerRef} {...containerProps}>
      {children}
    </div>
  );
}

interface CollapsedThreadStatusGlyphProps {
  activity: CollapsedChildActivity;
  pluginStatus?: PluginComposerThreadRowStatus | null;
}

export function CollapsedThreadStatusGlyph({
  activity,
  pluginStatus = null,
}: CollapsedThreadStatusGlyphProps) {
  const statusProps: ThreadListIndicatorState = {
    hasPendingInteraction: activity.pending,
    hasUnsubmittedDraft: activity.hasUnsubmittedDraft,
    hasUnreadError: activity.unreadError,
    hasUnreadSuccess: activity.unread,
    isBackgroundAgentActive: activity.backgroundAgent,
    isBackgroundCommandActive: activity.backgroundCommand,
    isGoalActive: activity.goal,
    queuedWork: "none",
    isPlanModeActive: activity.planMode,
    isRuntimeActive: activity.runtimeWorking,
    isWorkflowActive: activity.workflow,
  };
  return <ThreadStatusGlyph {...statusProps} pluginStatus={pluginStatus} />;
}
type ThreadTrailingIndicatorProps = ThreadStatusGlyphProps & {
  agent: Agent | null;
  pluginStatus: PluginComposerThreadRowStatus | null;
};

function ThreadTrailingIndicator({
  agent,
  pluginStatus,
  ...statusProps
}: ThreadTrailingIndicatorProps) {
  const { indicatorKind, pluginStatusIsVisible } = resolveThreadStatus(
    statusProps,
    pluginStatus,
  );

  if (agent === null && indicatorKind === "none" && !pluginStatusIsVisible) {
    return null;
  }

  return (
    <span
      data-sidebar-thread-trailing-indicator=""
      className={cn(
        SIDEBAR_ROW_GLYPH_SLOT_CLASS,
        SIDEBAR_STATUS_GLYPH_BOX_CLASS,
      )}
    >
      <ThreadStatusMascot
        {...statusProps}
        agent={agent}
        pluginStatus={pluginStatus}
      />
    </span>
  );
}

function ThreadRestoreStatusAction({ thread }: { thread: ThreadListEntry }) {
  const pending = useIsMutating({
    mutationKey: ["unarchive-thread"],
    predicate: (mutation) => {
      const variables = mutation.state.variables;
      return (
        typeof variables === "object" &&
        variables !== null &&
        "id" in variables &&
        variables.id === thread.id
      );
    },
  });
  return (
    <span
      className="relative z-10 pointer-events-auto"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <ThreadArchiveQuickAction
        thread={thread}
        disabled={pending > 0}
        className={SIDEBAR_CONTROL_BUTTON_CLASS}
      />
    </span>
  );
}

function ThreadRowComponent({
  projectId,
  thread,
  isActive,
  hasComposerDraft,
  onProjectSelect,
  options,
}: ThreadRowProps) {
  const [isDropdownActionsOpen, setIsDropdownActionsOpen] = useState(false);
  const [isContextActionsOpen, setIsContextActionsOpen] = useState(false);
  const { renameThreadAsync, generatingTitleIds } = useThreadActions();
  const setConversationCollapsed = useSetAtom(
    getThreadConversationCollapsedAtom(thread.id),
  );
  const shortcut = useSidebarThreadShortcut(thread.id);
  const pluginThreadRowStatus = usePluginThreadRowStatus(thread.id);
  const agent = resolveThreadAgent(useAgents().data ?? [], thread.agentId);
  const showActive = isActive;
  const threadStatus = threadListIndicatorStateForThread(
    thread,
    hasComposerDraft,
  );
  const threadTitle = getThreadDisplayTitle(thread);
  const labelTitle = useThreadTitleDisplayText(threadTitle);
  const snoozeState = useThreadSnoozeState();
  const handleRename = useCallback(
    (nextTitle: string) => renameThreadAsync(thread.id, nextTitle),
    [renameThreadAsync, thread.id],
  );
  const rename = useSidebarRename({
    kind: "thread",
    id: thread.id,
    name: threadTitle,
    label: "Thread name",
    onSave: handleRename,
  });
  const { editor, isEditing, startEditing } = rename;
  const startTitleEditing = useCallback(
    (event: { preventDefault: () => void; stopPropagation: () => void }) => {
      event.preventDefault();
      event.stopPropagation();
      startEditing();
    },
    [startEditing],
  );
  const splitIndicator = usePaneContentSplitIndicator(
    { kind: "thread", projectId, threadId: thread.id },
    true,
  );
  const { onPointerDown: onSplitDragPointerDown, openInSplit } =
    useThreadRowSplitDrag({
      projectId,
      threadId: thread.id,
      title: labelTitle,
    });
  const splitAvailable = onSplitDragPointerDown !== undefined;
  const parentOptions = options.kind === "parent" ? options : null;
  const isParentRow = parentOptions !== null;
  const isParentCollapsed = parentOptions?.isCollapsed ?? false;
  const childCount = parentOptions?.childCount ?? 0;
  const childActivity =
    parentOptions?.childActivity ?? NO_COLLAPSED_CHILD_ACTIVITY;
  const hasChildren = childCount > 0;
  const hasHiddenChildren = isParentRow && isParentCollapsed && hasChildren;
  const trailingIndicatorState: ThreadListIndicatorState = {
    hasPendingInteraction:
      threadStatus.hasPendingInteraction ||
      (hasHiddenChildren && childActivity.pending),
    hasUnsubmittedDraft:
      threadStatus.hasUnsubmittedDraft ||
      (hasHiddenChildren && childActivity.hasUnsubmittedDraft),
    hasUnreadError:
      threadStatus.hasUnreadError ||
      (hasHiddenChildren && childActivity.unreadError),
    hasUnreadSuccess:
      threadStatus.hasUnreadSuccess ||
      (hasHiddenChildren && childActivity.unread),
    isBackgroundAgentActive:
      threadStatus.isBackgroundAgentActive ||
      (hasHiddenChildren && childActivity.backgroundAgent),
    isBackgroundCommandActive:
      threadStatus.isBackgroundCommandActive ||
      (hasHiddenChildren && childActivity.backgroundCommand),
    isGoalActive:
      threadStatus.isGoalActive || (hasHiddenChildren && childActivity.goal),
    queuedWork: threadStatus.queuedWork,
    isPlanModeActive:
      threadStatus.isPlanModeActive ||
      (hasHiddenChildren && childActivity.planMode),
    isRuntimeActive:
      threadStatus.isRuntimeActive ||
      (hasHiddenChildren && childActivity.runtimeWorking),
    isWorkflowActive:
      threadStatus.isWorkflowActive ||
      (hasHiddenChildren && childActivity.workflow),
  };
  const trailingIndicatorResolution = resolveThreadStatus(
    trailingIndicatorState,
    pluginThreadRowStatus,
  );
  const trailingIndicatorKind = trailingIndicatorResolution.indicatorKind;
  const splitIndicatorIsWorking = hasThreadListWorkingActivity(
    trailingIndicatorState,
    pluginThreadRowStatus?.tone === "running",
  );
  const splitIndicatorLabel = trailingIndicatorResolution.accessibleLabel
    ? `${labelTitle} — open in split; ${trailingIndicatorResolution.accessibleLabel}`
    : `${labelTitle} — open in split`;
  const linkLabel = hasComposerDraft
    ? `Open ${labelTitle} (unsubmitted draft)`
    : `Open ${labelTitle}`;
  const rowDragBindings = isEditing ? undefined : options.dragBindings;
  const nestTargetState = options.nestDrop?.state ?? null;
  const reorderPlacement = options.nestDrop?.reorderPlacement ?? null;
  const containerRef = useComposedRefs<HTMLDivElement>(
    rowDragBindings?.setActivatorNodeRef,
    options.nestDrop?.setNodeRef,
  );
  const rowClassName = cn(
    SIDEBAR_HOVER_ACTIONS_ROW_CLASS,
    "group/thread-row cursor-pointer",
    THREAD_ROW_BASE_CLASS,
    LIST_HOVER_TRANSITION,
    parentOptions?.stickyLevel === undefined && "relative",
    hasComposerDraft && !showActive && DRAFT_ROW_CLASS,
    showActive
      ? SIDEBAR_ROW_SELECTED_STATE_CLASS
      : SIDEBAR_ROW_INTERACTIVE_STATE_CLASS,
    !showActive &&
      splitIndicator.isOpenInSplit &&
      SIDEBAR_ROW_OPEN_IN_SPLIT_STATE_CLASS,
    !showActive &&
      "has-[[data-state=open]]:bg-sidebar-accent has-[[data-sidebar-rename-anchor]:focus-visible]:bg-sidebar-accent",
    rowDragBindings && !rowDragBindings.disabled && "select-none",
    nestTargetState && NEST_TARGET_STATE_CLASS[nestTargetState],
    reorderPlacement && REORDER_PLACEMENT_CLASS[reorderPlacement],
  );
  const rowStyle = getThreadRowStyle(options.depth, parentOptions?.stickyLevel);
  const parentGuideLeft =
    options.depth > 0 ? getSidebarThreadGroupLineLeft(options.depth - 1) : null;
  const isActionsOpen = isDropdownActionsOpen || isContextActionsOpen;
  const isCompactViewport = useIsCompactViewport();
  const handleRowClickCapture = useCallback<ThreadRowClickCaptureHandler>(
    (event) => {
      if (!options.consumeClickSuppression?.()) {
        return;
      }
      event.preventDefault();
      event.stopPropagation();
    },
    [options],
  );

  const isSnoozeRoot = snoozeState?.isSnoozeRoot(thread.id) ?? false;
  const wakesAt = snoozeState?.activeUntil(thread.id) ?? null;
  const extraHoverActionsWidth = `${(isSnoozeRoot ? 3 : 2) * 30}px`;
  const reservesActionsBesideDisclosure =
    parentOptions?.onToggleCollapsed !== undefined &&
    hasChildren &&
    !shortcut &&
    !isEditing;
  const rowContent = (
    <>
      {parentOptions?.stickyLevel !== undefined && parentGuideLeft !== null ? (
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-0.5 top-0 z-[1] w-px bg-border-hairline opacity-70"
          style={{ left: parentGuideLeft }}
        />
      ) : null}
      <span
        className={cn(
          "col-start-1 row-start-1 flex min-w-0 items-center gap-1.5 self-stretch",
          reservesActionsBesideDisclosure && "bb-sidebar-thread-disclosure-row",
        )}
        style={
          {
            "--bb-sidebar-row-actions-extra": extraHoverActionsWidth,
          } as CSSProperties
        }
      >
        <NavLink
          to={getThreadRoutePath({ projectId, threadId: thread.id })}
          data-sidebar-thread-shortcut-target=""
          data-sidebar-thread-id={thread.id}
          data-sidebar-rename-anchor=""
          onClick={(event) => {
            if (isEditing) {
              event.preventDefault();
              event.stopPropagation();
              return;
            }
            setConversationCollapsed(false);
            if (splitAvailable && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              openInSplit();
              return;
            }
            if (consumeSidebarTitleDoubleClick(thread.id)) {
              event.preventDefault();
              event.stopPropagation();
              startEditing();
              return;
            }
            onProjectSelect?.();
          }}
          onDoubleClick={isEditing ? undefined : startTitleEditing}
          aria-label={linkLabel}
          aria-keyshortcuts={shortcut?.ariaKeyshortcuts}
          className="absolute inset-0 rounded-md outline-none"
        />
        <span className="pointer-events-none relative flex min-w-0 flex-1 items-center self-stretch">
          {isEditing ? (
            <span className="pointer-events-auto relative z-10 min-w-0 flex-1 overflow-visible">
              {editor}
            </span>
          ) : (
            <span
              className="bb-thread-title bb-sidebar-thread-title"
              title={labelTitle}
              style={
                shortcut || reservesActionsBesideDisclosure
                  ? undefined
                  : ({
                      "--bb-sidebar-thread-title-hover-cover":
                        "var(--bb-sidebar-row-actions-extra)",
                    } as CSSProperties)
              }
              onDoubleClick={startTitleEditing}
            >
              <TextSkeleton
                loading={generatingTitleIds.has(thread.id)}
                label="Generating title"
              >
                <ThreadTitleMentions title={threadTitle} />
              </TextSkeleton>
            </span>
          )}
        </span>
        {parentOptions?.onToggleCollapsed && hasChildren ? (
          <SidebarChildToggleChevron
            disabled={isEditing}
            className={isEditing ? "hidden" : undefined}
            isCollapsed={isParentCollapsed}
            expandLabel={`Expand ${labelTitle} threads`}
            collapseLabel={`Collapse ${labelTitle} threads`}
            onToggle={() => parentOptions.onToggleCollapsed?.(thread.id)}
            revealOnHover={!isParentCollapsed}
          />
        ) : null}
      </span>
      <span
        className={cn(
          "col-start-2 row-start-1 flex shrink-0 items-center gap-0.5",
          isEditing && "hidden",
        )}
      >
        {thread.archivedAt !== null ? (
          <span className="relative flex items-center max-md:pointer-coarse:hidden">
            <div
              data-sidebar-hover-actions-open={
                isActionsOpen ? "true" : undefined
              }
              className={cn(
                SIDEBAR_HOVER_ACTIONS_CLASS,
                "absolute right-full z-10 max-md:pointer-coarse:hidden",
              )}
            >
              <ThreadActionsMenu
                thread={thread}
                triggerClassName={SIDEBAR_CONTROL_BUTTON_CLASS}
                onOpenInSplit={splitAvailable ? openInSplit : undefined}
                onOpenChange={setIsDropdownActionsOpen}
                onRename={rename.startEditingFromMenu}
                onCloseAutoFocus={rename.onCloseAutoFocus}
              />
            </div>
            <ThreadRestoreStatusAction thread={thread} />
          </span>
        ) : shortcut ? (
          <AppCommandShortcutPill shortcut={shortcut} className="mr-2" />
        ) : (
          <span
            className={cn(
              "flex shrink-0 items-center justify-end max-md:pointer-coarse:pointer-events-none",
              COARSE_POINTER_COMPACT_ROW_HEIGHT_CLASS,
            )}
          >
            <span
              className={cn(
                "relative shrink-0",
                COARSE_POINTER_ROW_ACTION_SIZE_CLASS,
              )}
            >
              <span
                data-sidebar-hover-actions-open={
                  isActionsOpen ? "true" : undefined
                }
                className={cn(
                  SIDEBAR_HOVER_ACTIONS_FADE_CLASS,
                  "absolute inset-0 flex items-center justify-center",
                )}
              >
                {splitIndicator.miniMap ? (
                  <span
                    data-sidebar-thread-trailing-indicator=""
                    className={cn(
                      SIDEBAR_ROW_GLYPH_SLOT_CLASS,
                      SIDEBAR_STATUS_GLYPH_BOX_CLASS,
                    )}
                  >
                    <SplitPaneMiniMap
                      slots={splitIndicator.miniMap}
                      label={splitIndicatorLabel}
                      isWorking={splitIndicatorIsWorking}
                    />
                  </span>
                ) : (
                  <ThreadTrailingIndicator
                    {...trailingIndicatorState}
                    agent={agent}
                    hideIdleDraftLabel={
                      !hasHiddenChildren && trailingIndicatorKind === "draft"
                    }
                    pluginStatus={pluginThreadRowStatus}
                  />
                )}
              </span>
              <div
                data-sidebar-hover-actions-open={
                  isActionsOpen ? "true" : undefined
                }
                className={cn(
                  SIDEBAR_HOVER_ACTIONS_CLASS,
                  "absolute inset-y-0 right-0 z-10 flex items-center justify-end max-md:pointer-coarse:hidden",
                  isEditing && "invisible pointer-events-none",
                )}
              >
                <SidebarRowControls
                  primaryAction={
                    <>
                      <ThreadPinQuickAction
                        thread={thread}
                        className={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
                      />
                      <ThreadSnoozeQuickAction
                        threadId={thread.id}
                        className={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
                      />
                      <ThreadArchiveQuickAction
                        thread={thread}
                        className={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
                      />
                    </>
                  }
                >
                  <ThreadActionsMenu
                    thread={thread}
                    triggerClassName={SIDEBAR_ROW_ACTION_BUTTON_CLASS}
                    onOpenInSplit={splitAvailable ? openInSplit : undefined}
                    onOpenChange={setIsDropdownActionsOpen}
                    onRename={rename.startEditingFromMenu}
                    onCloseAutoFocus={rename.onCloseAutoFocus}
                  />
                </SidebarRowControls>
              </div>
            </span>
          </span>
        )}
      </span>
      {isEditing ? null : <ThreadRowMeta thread={thread} wakesAt={wakesAt} />}
    </>
  );

  const row = renderThreadRowContainer({
    children: rowContent,
    className: rowClassName,
    containerRef,
    dragBindings: rowDragBindings,
    nestTargetState,
    reorderPlacement,
    onClickCapture:
      !isEditing && options.consumeClickSuppression
        ? handleRowClickCapture
        : undefined,
    onSplitDragPointerDown: isEditing ? undefined : onSplitDragPointerDown,
    stickyLevel: parentOptions?.stickyLevel,
    style: rowStyle,
  });

  const contextMenu = (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={splitAvailable ? openInSplit : undefined}
      onOpenChange={setIsContextActionsOpen}
      onRename={rename.startEditingFromMenu}
      onCloseAutoFocus={rename.onCloseAutoFocus}
      disabled={isEditing}
    >
      {isCompactViewport ? (
        row
      ) : (
        <SidebarThreadHoverCardTrigger>{row}</SidebarThreadHoverCardTrigger>
      )}
    </ThreadActionsContextMenu>
  );
  if (isCompactViewport) return contextMenu;
  return (
    <SidebarThreadHoverCard
      thread={thread}
      suppressed={isActionsOpen || isEditing}
    >
      {contextMenu}
    </SidebarThreadHoverCard>
  );
}

export const ThreadRow = memo(ThreadRowComponent);
