import type { ComponentProps } from "react";
import { Icon } from "@bb/shared-ui/icon";
import type { BrowserTabDeck } from "./BrowserTabDeck";

export function BrowserDisabledPanel() {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
      <span className="flex size-11 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
        <Icon name="Globe" className="size-6" aria-hidden />
      </span>
      <p className="text-sm font-medium text-foreground">
        Browser is disabled in this build
      </p>
    </div>
  );
}

export function BrowserDisabledDeck({
  browserTabs,
  activeBrowserTabId,
}: ComponentProps<typeof BrowserTabDeck>) {
  return browserTabs.some((tab) => tab.id === activeBrowserTabId) ? (
    <BrowserDisabledPanel />
  ) : null;
}
