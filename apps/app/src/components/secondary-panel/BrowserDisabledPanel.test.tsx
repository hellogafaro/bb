// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { APP_COMMAND_GROUPS } from "@/lib/app-command-metadata";
import { BrowserDisabledDeck } from "./BrowserDisabledPanel";

afterEach(() => {
  cleanup();
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
    />,
  );
}

describe("browser lockout", () => {
  it("renders a disabled panel for a persisted browser tab", () => {
    renderDeck("browser-1");
    expect(screen.getByText("Browser is disabled in this build")).toBeTruthy();
  });

  it("renders nothing when no browser tab is active", () => {
    renderDeck(null);
    expect(screen.queryByText("Browser is disabled in this build")).toBeNull();
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
