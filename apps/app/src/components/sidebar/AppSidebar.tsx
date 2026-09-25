import { useCallback, useEffect, useRef, useState } from "react";
import { THREAD_JUMP_APP_COMMAND_IDS } from "@bb/domain";
import { useNavigate } from "react-router-dom";
import { OverflowFade } from "@/components/ui/overflow-fade.js";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  useCloseMobileSidebar,
} from "@/components/ui/sidebar.js";
import { PluginThreadList } from "./PluginThreadList";
import { useThreadListReplacement } from "./threadListProvider";
import {
  PluginSidebarFooterDisclosure,
  PluginSidebarFooterItems,
  usePluginSidebarFooterDisclosure,
} from "@/components/plugin/PluginSidebarFooterItems";
import { SidebarPluginAttentionGlyph } from "./SidebarPluginAttentionGlyph";
import { SidebarUpdatesBadge } from "./SidebarUpdatesBadge";
import { SidebarResizeHandle, SidebarTopReserveRow } from "./SidebarChrome";
import { SIDEBAR_FOOTER_ACTION_CLASS } from "./sidebarRowClasses";
import { getRootComposeRoutePath, getThreadRoutePath } from "@/lib/route-paths";
import { usePaneContentSplitDrag } from "./usePaneContentSplitDrag";
import {
  EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS,
  getSidebarThreadNavigationTargets,
  getSidebarThreadShortcutTargets,
  SidebarThreadShortcutKeysContext,
  type SidebarThreadShortcutPresentation,
  type SidebarThreadShortcutTarget,
} from "./sidebarThreadShortcuts";
import {
  useAppCommandHandler,
  useAppCommandShortcut,
  useAppCommandShortcuts,
  useIsAppCommandModifierHeld,
  useIndexedAppCommandHandlers,
} from "@/components/commands/AppCommandProvider";
import { AppCommandShortcutHintScope } from "@/components/commands/AppCommandShortcutHint";
import { useRouteState } from "@/hooks/useRouteState";
import { SidebarNavigationRegion } from "./SidebarNavigationRegion";

const NEW_THREAD_PANE_CONTENT = { kind: "new-thread" } as const;

interface AppSidebarProps {
  onResizeMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  isResizing: boolean;
  settingsRoutePath: string;
  mobileHosted?: { hidden: boolean };
}

export function AppSidebar({
  onResizeMouseDown,
  isResizing,
  settingsRoutePath,
  mobileHosted,
}: AppSidebarProps) {
  const threadListReplacement = useThreadListReplacement();
  const { threadId: activeThreadId } = useRouteState();
  const navigate = useNavigate();
  const newThreadSplit = usePaneContentSplitDrag({
    content: NEW_THREAD_PANE_CONTENT,
    enabled: true,
    label: "New thread",
  });
  const closeOnMobile = useCloseMobileSidebar();
  const [threadShortcutKeysById, setThreadShortcutKeysById] = useState<
    ReadonlyMap<string, SidebarThreadShortcutPresentation>
  >(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  const sidebarRef = useRef<HTMLDivElement | null>(null);
  const threadShortcutTargetsRef = useRef<
    readonly SidebarThreadShortcutTarget[]
  >([]);
  const threadJumpShortcuts = useAppCommandShortcuts(
    THREAD_JUMP_APP_COMMAND_IDS,
  );
  const isAppCommandModifierHeld = useIsAppCommandModifierHeld();
  const settingsShortcut = useAppCommandShortcut("settings.open");
  const pluginSidebarFooter = usePluginSidebarFooterDisclosure();

  const handleNewChat = useCallback(() => {
    closeOnMobile();
    void navigate(getRootComposeRoutePath(), {
      state: { focusPrompt: true },
    });
  }, [closeOnMobile, navigate]);

  const showThreadShortcuts = useCallback(() => {
    const targets = getSidebarThreadShortcutTargets(sidebarRef.current);
    threadShortcutTargetsRef.current = targets;
    setThreadShortcutKeysById(
      new Map(
        targets.flatMap((target, index) => {
          const command = THREAD_JUMP_APP_COMMAND_IDS[index];
          const shortcut = command
            ? threadJumpShortcuts.get(command)
            : undefined;
          return shortcut ? [[target.threadId, shortcut] as const] : [];
        }),
      ),
    );
  }, [threadJumpShortcuts]);

  const hideThreadShortcuts = useCallback(() => {
    threadShortcutTargetsRef.current = [];
    setThreadShortcutKeysById(EMPTY_SIDEBAR_THREAD_SHORTCUT_KEYS);
  }, []);

  const activateThreadShortcut = useCallback((index: number): boolean => {
    const targets = threadShortcutTargetsRef.current;
    const target =
      targets[index] ??
      getSidebarThreadShortcutTargets(sidebarRef.current)[index];
    if (!target?.element) return false;
    target.element.click();
    return true;
  }, []);

  const activateAdjacentThread = useCallback(
    (offset: -1 | 1): boolean => {
      const targets = getSidebarThreadNavigationTargets(sidebarRef.current);
      if (targets.length === 0) return false;
      const activeIndex = targets.findIndex(
        (target) => target.threadId === activeThreadId,
      );
      const nextIndex =
        activeIndex === -1
          ? offset === 1
            ? 0
            : targets.length - 1
          : (activeIndex + offset + targets.length) % targets.length;
      const target = targets[nextIndex];
      if (!target) return false;
      if (target.element) {
        target.element.click();
        return true;
      }
      if (!target.projectId) return false;
      closeOnMobile();
      void navigate(
        getThreadRoutePath({
          projectId: target.projectId,
          threadId: target.threadId,
        }),
      );
      return true;
    },
    [activeThreadId, closeOnMobile, navigate],
  );

  const isHiddenHostedBody = mobileHosted?.hidden === true;
  const activateVisibleThreadShortcut = useCallback(
    (index: number) =>
      isHiddenHostedBody ? false : activateThreadShortcut(index),
    [activateThreadShortcut, isHiddenHostedBody],
  );
  useIndexedAppCommandHandlers(
    THREAD_JUMP_APP_COMMAND_IDS,
    activateVisibleThreadShortcut,
  );
  useAppCommandHandler("thread.previous", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(-1),
  );
  useAppCommandHandler("thread.next", () =>
    isHiddenHostedBody ? false : activateAdjacentThread(1),
  );

  useEffect(() => {
    if (isAppCommandModifierHeld) {
      showThreadShortcuts();
      return;
    }
    hideThreadShortcuts();
  }, [hideThreadShortcuts, isAppCommandModifierHeld, showThreadShortcuts]);

  const body = (
    <AppCommandShortcutHintScope>
      <SidebarTopReserveRow testId="app-sidebar-top-reserve-row" />
      <SidebarNavigationRegion
        onNavigate={closeOnMobile}
        splitEnabled
        newThreadSplit={newThreadSplit}
        onNewChat={handleNewChat}
        onSearch={closeOnMobile}
      />
      <SidebarContent>
        <PluginThreadList
          replacement={threadListReplacement}
          onNavigate={closeOnMobile}
        />
      </SidebarContent>
      <SidebarFooter className="relative">
        <OverflowFade placement="above" tone="sidebar" size="sm" />
        <PluginSidebarFooterDisclosure
          item={pluginSidebarFooter.activeItem}
          onDismiss={pluginSidebarFooter.dismiss}
        />
        <SidebarMenu className="flex-row flex-wrap-reverse items-center gap-1">
          <PluginSidebarFooterItems
            activeDisclosureKey={pluginSidebarFooter.activeKey}
            onDisclosureCommand={pluginSidebarFooter.handleCommand}
            onNavigate={closeOnMobile}
            builtInActions={[
              {
                id: "settings",
                href: settingsRoutePath,
                ariaLabel: settingsShortcut
                  ? `Settings (${settingsShortcut.label})`
                  : "Settings",
                ariaKeyShortcuts: settingsShortcut?.ariaKeyshortcuts,
                onActivate: () => {
                  closeOnMobile();
                  void navigate(settingsRoutePath);
                },
              },
            ]}
          />
          <li aria-hidden="true" className="min-w-0 flex-1" />
          <SidebarPluginAttentionGlyph
            className={SIDEBAR_FOOTER_ACTION_CLASS}
            onNavigate={closeOnMobile}
          />
          <SidebarUpdatesBadge onNavigate={closeOnMobile} />
        </SidebarMenu>
      </SidebarFooter>
      <SidebarResizeHandle
        testId="app-sidebar-resize-handle"
        isResizing={isResizing}
        onMouseDown={onResizeMouseDown}
      />
    </AppCommandShortcutHintScope>
  );

  return (
    <SidebarThreadShortcutKeysContext.Provider value={threadShortcutKeysById}>
      {mobileHosted ? (
        <div
          ref={sidebarRef}
          data-testid="app-sidebar-body"
          hidden={mobileHosted.hidden}
          className="flex min-h-0 flex-1 flex-col"
        >
          {body}
        </div>
      ) : (
        <Sidebar ref={sidebarRef}>{body}</Sidebar>
      )}
    </SidebarThreadShortcutKeysContext.Provider>
  );
}
