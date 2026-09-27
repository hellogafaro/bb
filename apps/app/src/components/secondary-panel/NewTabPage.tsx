import { useEffect, useRef, type ReactNode } from "react";
import { usePointerCoarse } from "@bb/shared-ui/hooks/use-pointer-coarse";
import type { PluginPanelActionEntry } from "@/components/plugin/PluginPanelActions";
import {
  NewTabActions,
  type OpenBrowserHandler,
  type StartTerminalHandler,
} from "./NewTabActions";

interface NewTabPageProps {
  autoFocus?: boolean;
  onAutoFocusHandled?: () => void;
  onOpenBrowser?: OpenBrowserHandler;
  onOpenFiles?: () => void;
  onStartTerminal?: StartTerminalHandler;
  pluginActions?: readonly PluginPanelActionEntry[];
  startTerminalDisabled?: boolean;
  startTerminalTrailing?: ReactNode;
}

const FIRST_ACTION_SELECTOR = "[data-panel-new-tab-item]:not(:disabled)";

export function NewTabPage({
  autoFocus = false,
  onAutoFocusHandled,
  onOpenBrowser,
  onOpenFiles,
  onStartTerminal,
  pluginActions,
  startTerminalDisabled,
  startTerminalTrailing,
}: NewTabPageProps) {
  const pageRef = useRef<HTMLDivElement>(null);
  const focusFrameRef = useRef<number | null>(null);
  const isPointerCoarse = usePointerCoarse();

  useEffect(
    () => () => {
      if (focusFrameRef.current !== null) {
        cancelAnimationFrame(focusFrameRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (!autoFocus) return;

    if (focusFrameRef.current !== null) {
      cancelAnimationFrame(focusFrameRef.current);
      focusFrameRef.current = null;
    }

    if (isPointerCoarse) {
      onAutoFocusHandled?.();
      return;
    }

    const focusFirstAction = () => {
      pageRef.current
        ?.querySelector<HTMLElement>(FIRST_ACTION_SELECTOR)
        ?.focus({ preventScroll: true });
    };
    focusFirstAction();
    focusFrameRef.current = requestAnimationFrame(() => {
      focusFrameRef.current = null;
      focusFirstAction();
    });
    onAutoFocusHandled?.();
  }, [autoFocus, isPointerCoarse, onAutoFocusHandled]);

  return (
    <div
      ref={pageRef}
      data-panel-new-tab-page=""
      className="flex min-h-full flex-col gap-3 bg-sidebar px-4 pb-3 pt-1"
    >
      <NewTabActions
        onOpenBrowser={onOpenBrowser}
        onOpenFiles={onOpenFiles}
        onStartTerminal={onStartTerminal}
        pluginActions={pluginActions}
        startTerminalDisabled={startTerminalDisabled}
        startTerminalTrailing={startTerminalTrailing}
      />
    </div>
  );
}
