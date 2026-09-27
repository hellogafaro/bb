import { useEffect, useMemo, useRef } from "react";
import type { BrowserFixedPanelTab } from "@/lib/fixed-panel-tabs-state";
import { getDesktopBrowserApi } from "@/lib/bb-desktop";

interface BrowserTabLifecycleObserverProps {
  browserTabs: readonly BrowserFixedPanelTab[];
  threadId: string;
}

interface BrowserTabIdSnapshot {
  tabIds: ReadonlySet<string>;
  threadId: string;
}

export function BrowserTabLifecycleObserver({
  browserTabs,
  threadId,
}: BrowserTabLifecycleObserverProps) {
  const desktopBrowser = useMemo(() => getDesktopBrowserApi(), []);
  const previousTabIdsRef = useRef<BrowserTabIdSnapshot | null>(null);

  useEffect(() => {
    const tabIds = new Set(browserTabs.map((tab) => tab.id));
    const previous = previousTabIdsRef.current;
    if (
      desktopBrowser !== null &&
      previous !== null &&
      previous.threadId === threadId
    ) {
      for (const tabId of previous.tabIds) {
        if (!tabIds.has(tabId)) {
          desktopBrowser.setVisible({ tabId, visible: false });
          desktopBrowser.detach(tabId);
        }
      }
    }
    previousTabIdsRef.current = { tabIds, threadId };
  }, [browserTabs, desktopBrowser, threadId]);

  return null;
}
