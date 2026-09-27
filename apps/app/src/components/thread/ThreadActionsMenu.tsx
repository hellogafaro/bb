import {
  ActionMenuItem,
  ActionMenuSeparator,
} from "@/components/ui/action-menu-items";
import type { Thread } from "@bb/domain";
import type { ReactNode } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuTrigger,
} from "@bb/shared-ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@bb/shared-ui/dropdown-menu";
import { Icon, type IconName } from "@bb/shared-ui/icon";
import { Button } from "@bb/shared-ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@bb/shared-ui/tooltip";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@bb/shared-ui/coarse-pointer-sizing";
import { useIsCompactViewport } from "@bb/shared-ui/hooks/use-compact-viewport";
import { cn } from "@bb/shared-ui/lib/utils";
import { CompactLongPressMenu } from "@/components/ui/compact-long-press-menu";
import { isThreadRead } from "@bb/client-core";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import { getThreadRoutePath } from "@/lib/route-paths";
import { useThreadActions } from "./ThreadActionsProvider";
import { ThreadSnoozeMenuItem } from "./ThreadSnoozeControls";

interface ThreadActionsMenuBaseProps {
  thread: Thread;
  onOpenInSplit?: () => void;
  onRename?: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export interface ThreadActionsMenuResponsiveAction {
  icon: IconName;
  label: string;
  onSelect: () => void | Promise<void>;
}

interface ThreadActionsMenuProps extends ThreadActionsMenuBaseProps {
  onOpenChange?: (open: boolean) => void;
  triggerClassName?: string;
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
}

interface ThreadActionsContextMenuProps extends ThreadActionsMenuBaseProps {
  children: ReactNode;
  disabled?: boolean;
  onOpenChange?: (open: boolean) => void;
}

type ThreadActionsMenuSurface = "context" | "dropdown";

interface ThreadActionsMenuItemsProps extends ThreadActionsMenuBaseProps {
  responsiveActions?: readonly ThreadActionsMenuResponsiveAction[];
  surface: ThreadActionsMenuSurface;
}

function ThreadActionsMenuItems({
  thread,
  onOpenInSplit,
  onRename,
  responsiveActions = [],
  surface,
}: ThreadActionsMenuItemsProps) {
  const {
    generateTitle,
    generatingTitleIds,
    requestArchive,
    requestRename,
    requestDelete,
    togglePin,
    toggleRead,
    unarchiveThread,
  } = useThreadActions();
  const isCompactViewport = useIsCompactViewport();
  const isDrawer = surface === "dropdown" && isCompactViewport;
  const showSeparators = !isDrawer;
  const isRead = isThreadRead(thread);
  const isArchived = thread.archivedAt != null;
  const isPinned = thread.pinnedAt !== null;
  const threadUrl = new URL(
    getThreadRoutePath({ projectId: thread.projectId, threadId: thread.id }),
    window.location.origin,
  ).toString();

  return (
    <>
      {responsiveActions.length > 0 ? (
        <>
          {responsiveActions.map((action) => (
            <ActionMenuItem
              key={action.label}
              surface={surface}
              icon={action.icon}
              onSelect={() => {
                void action.onSelect();
              }}
            >
              {action.label}
            </ActionMenuItem>
          ))}
          {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
        </>
      ) : null}
      {onOpenInSplit ? (
        <>
          <ActionMenuItem
            surface={surface}
            icon="Columns2"
            onSelect={() => {
              onOpenInSplit();
            }}
          >
            Open in split
          </ActionMenuItem>
          {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
        </>
      ) : null}
      <ActionMenuItem
        surface={surface}
        icon="Copy"
        onSelect={() => {
          void copyToClipboardWithToast(threadUrl, {
            successMessage: "Thread link copied",
            errorMessage: "Failed to copy thread link",
          });
        }}
      >
        Copy thread link
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon={isRead ? "Mail" : "MailOpen"}
        onSelect={() => {
          toggleRead(thread);
        }}
      >
        {isRead ? "Mark unread" : "Mark read"}
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon={isPinned ? "PinOff" : "Pin"}
        onSelect={() => {
          togglePin(thread);
        }}
      >
        {isPinned ? "Unpin" : "Pin"}
      </ActionMenuItem>
      <ThreadSnoozeMenuItem threadId={thread.id} surface={surface} />
      <ActionMenuItem
        surface={surface}
        icon="Edit"
        onSelect={() => {
          if (onRename) {
            onRename();
            return;
          }
          window.setTimeout(() => {
            requestRename(thread);
          }, 0);
        }}
      >
        Rename
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon="RotateCcw"
        disabled={generatingTitleIds.has(thread.id)}
        onSelect={() => {
          void generateTitle(thread.id);
        }}
      >
        {generatingTitleIds.has(thread.id)
          ? "Generating title…"
          : "Regenerate title"}
      </ActionMenuItem>
      {showSeparators ? <ActionMenuSeparator surface={surface} /> : null}
      <ActionMenuItem
        surface={surface}
        icon={isArchived ? "ArchiveRestore" : "Archive"}
        onSelect={() => {
          if (isArchived) {
            unarchiveThread(thread);
            return;
          }
          window.setTimeout(() => {
            requestArchive(thread);
          }, 0);
        }}
      >
        {isArchived ? "Unarchive" : "Archive"}
      </ActionMenuItem>
      <ActionMenuItem
        surface={surface}
        icon="Trash2"
        variant="destructive"
        onSelect={() => {
          window.setTimeout(() => {
            requestDelete(thread);
          }, 0);
        }}
      >
        Delete
      </ActionMenuItem>
    </>
  );
}

export function ThreadArchiveQuickAction({
  thread,
  className,
  disabled,
}: {
  thread: Thread;
  className?: string;
  disabled?: boolean;
}) {
  const { requestArchive, unarchiveThread } = useThreadActions();
  const isArchived = thread.archivedAt != null;
  const label = isArchived ? "Unarchive" : "Archive";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("rounded-md p-0", className)}
          aria-label={`${label} thread`}
          disabled={disabled}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            if (isArchived) {
              unarchiveThread(thread);
              return;
            }
            requestArchive(thread);
          }}
        >
          <Icon
            name={isArchived ? "ArchiveRestore" : "Archive"}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadPinQuickAction({
  thread,
  className,
}: {
  thread: Thread;
  className?: string;
}) {
  const { togglePin } = useThreadActions();
  const isPinned = thread.pinnedAt !== null;
  const label = isPinned ? "Unpin" : "Pin";
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn("rounded-md p-0", className)}
          aria-label={`${label} thread`}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            togglePin(thread);
          }}
        >
          <Icon
            name={isPinned ? "PinOff" : "Pin"}
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  );
}

export function ThreadActionsMenu({
  thread,
  onOpenInSplit,
  onRename,
  onCloseAutoFocus,
  responsiveActions,
  onOpenChange,
  triggerClassName,
}: ThreadActionsMenuProps) {
  return (
    <DropdownMenu onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className={cn(
            "rounded-md p-0",
            "data-[state=open]:bg-state-active data-[state=open]:text-foreground",
            triggerClassName,
          )}
          aria-label="Thread actions"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onCloseAutoFocus={onCloseAutoFocus}>
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          responsiveActions={responsiveActions}
          surface="dropdown"
        />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ThreadActionsContextMenu(props: ThreadActionsContextMenuProps) {
  const isCompactViewport = useIsCompactViewport();
  if (isCompactViewport) {
    return <ThreadActionsCompactLongPressMenu {...props} />;
  }
  return <ThreadActionsDesktopContextMenu {...props} />;
}

function ThreadActionsCompactLongPressMenu({
  children,
  disabled,
  thread,
  onOpenInSplit,
  onOpenChange,
  onRename,
}: ThreadActionsContextMenuProps) {
  return (
    <CompactLongPressMenu
      label="Thread actions"
      disabled={disabled}
      onOpenChange={onOpenChange}
      items={
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          surface="dropdown"
        />
      }
    >
      {children}
    </CompactLongPressMenu>
  );
}

function ThreadActionsDesktopContextMenu({
  children,
  disabled,
  thread,
  onOpenInSplit,
  onOpenChange,
  onRename,
  onCloseAutoFocus,
}: ThreadActionsContextMenuProps) {
  return (
    <ContextMenu onOpenChange={onOpenChange}>
      <ContextMenuTrigger asChild disabled={disabled}>
        {children}
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label="Thread actions"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <ThreadActionsMenuItems
          thread={thread}
          onOpenInSplit={onOpenInSplit}
          onRename={onRename}
          surface="context"
        />
      </ContextMenuContent>
    </ContextMenu>
  );
}
