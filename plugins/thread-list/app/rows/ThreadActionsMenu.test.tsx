// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { makeSidebarThread } from "../model/fixtures.js";
import { toSidebarThread } from "../model/sidebar-thread.js";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu.js";

const actions = vi.hoisted(() => ({
  experimental_generateTitle: vi.fn(),
  experimental_isGeneratingTitle: vi.fn(() => false),
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  experimental_useSidebarThreadActions: () => actions,
  useSdk: () => ({}),
}));
vi.mock("../snooze/SnoozeControls.js", () => ({
  ThreadSnoozeMenuItem: () => null,
}));
vi.mock("./ThreadSectionMoveProvider.js", () => ({
  useThreadSectionMove: () => null,
}));

const thread = toSidebarThread(makeSidebarThread({ id: "thread-title" }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  actions.experimental_isGeneratingTitle.mockReturnValue(false);
});

describe("thread-list title generation", () => {
  it.each([
    { compact: false, context: false },
    { compact: false, context: true },
    { compact: true, context: false },
  ])(
    "uses the host action below Rename ($compact, $context)",
    async ({ compact, context }) => {
      render(
        <CompactViewportOverrideProvider isCompactViewport={compact}>
          {context ? (
            <ThreadActionsContextMenu thread={thread} onRename={() => {}}>
              <button type="button">Thread row</button>
            </ThreadActionsContextMenu>
          ) : (
            <ThreadActionsMenu thread={thread} onRename={() => {}} />
          )}
        </CompactViewportOverrideProvider>,
      );
      if (context)
        fireEvent.contextMenu(
          screen.getByRole("button", { name: "Thread row" }),
        );
      else {
        const trigger = screen.getByRole("button", { name: "Thread actions" });
        if (compact) fireEvent.click(trigger);
        else fireEvent.pointerDown(trigger, { button: 0 });
      }
      const item = await screen.findByRole("menuitem", {
        name: "Regenerate title",
      });
      const items = screen.getAllByRole("menuitem");
      expect(items.indexOf(item)).toBe(
        items.indexOf(screen.getByRole("menuitem", { name: "Rename" })) + 1,
      );
      fireEvent.click(item);
      expect(actions.experimental_generateTitle).toHaveBeenCalledWith(
        thread.id,
      );
    },
  );

  it("disables generation when the host reports it pending", async () => {
    actions.experimental_isGeneratingTitle.mockReturnValue(true);
    render(
      <CompactViewportOverrideProvider isCompactViewport={false}>
        <ThreadActionsMenu thread={thread} onRename={() => {}} />
      </CompactViewportOverrideProvider>,
    );
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    const item = await screen.findByRole("menuitem", {
      name: "Generating title…",
    });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(actions.experimental_generateTitle).not.toHaveBeenCalled();
  });
});
