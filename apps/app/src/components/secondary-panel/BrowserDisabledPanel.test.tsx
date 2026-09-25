// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { BbDesktopInfo } from "@bb/desktop-contract";
import { APP_COMMAND_GROUPS } from "@/lib/app-command-metadata";
import {
  getDesktopBrowserApi,
  isDesktopBrowserAvailable,
} from "@/lib/bb-desktop";
import { createBbDesktopApi } from "@/test/bb-desktop-test-utils";
import { BrowserDisabledDeck } from "./BrowserDisabledPanel";

const desktopInfo: BbDesktopInfo = {
  lastCheckedAt: null,
  latestVersion: null,
  pendingVersion: null,
  platform: "macos",
  updateAvailable: false,
  updateDownloaded: false,
  version: "0.0.0-test",
};

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(window, "bbDesktop");
});

function renderDeck(activeBrowserTabId: string | null) {
  render(
    <BrowserDisabledDeck
      browserTabs={[
        {
          kind: "browser",
          id: "browser-1",
          url: "https://x.test",
          environmentId: null,
          title: null,
        },
      ]}
      activeBrowserTabId={activeBrowserTabId}
      environmentId={null}
      canShowNativeBrowserView
      threadId="thr_1"
      onUpdate={() => undefined}
    />,
  );
}

describe("fork browser lockout", () => {
  it("renders a disabled panel for a persisted browser tab", () => {
    renderDeck("browser-1");
    expect(screen.getByText("Browser is disabled in this build")).toBeTruthy();
  });

  it("renders nothing when no browser tab is active", () => {
    renderDeck(null);
    expect(screen.queryByText("Browser is disabled in this build")).toBeNull();
  });

  it("reports the in-app browser as unavailable even in the desktop app", () => {
    window.bbDesktop = createBbDesktopApi(desktopInfo);
    expect(getDesktopBrowserApi()).not.toBeNull();
    expect(isDesktopBrowserAvailable()).toBe(false);
  });

  it("keeps browser commands out of the command palette", () => {
    const browserCommands = APP_COMMAND_GROUPS.flatMap(
      (group) => group.commands,
    ).filter((entry) => entry.command.startsWith("browser."));
    expect(browserCommands.map((entry) => entry.command)).toEqual([
      "browser.focusLocation",
      "browser.reload",
      "browser.find",
    ]);
    expect(browserCommands.every((entry) => !entry.paletteVisible)).toBe(true);
  });
});
