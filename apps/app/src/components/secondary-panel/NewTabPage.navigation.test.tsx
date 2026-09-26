// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { AppCommandProvider } from "@/components/commands/AppCommandProvider";
import { SidebarProvider } from "@/components/ui/sidebar";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { NewTabPage } from "./NewTabPage";
import { SidebarSplitContainer } from "./SidebarSplitContainer";

vi.mock("@/hooks/usePluginCommandBindings", () => {
  const bindings = [
    ["panel.previousNewTabItem", "ArrowUp"],
    ["panel.nextNewTabItem", "ArrowDown"],
  ].map(([command, key]) => ({
    command,
    desktopOnly: false,
    shortcut: {
      key,
      control: true,
      shift: true,
      mod: false,
      meta: false,
      alt: false,
    },
    when: { all: ["mainSurface"], none: ["modalOpen"] },
  }));
  return {
    usePluginCommandBindings: () => ({
      keybindings: bindings,
      defaults: bindings,
    }),
  };
});

vi.mock("@bb/shared-ui/hooks/use-pointer-coarse", () => ({
  usePointerCoarse: () => false,
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

function mountPage({
  autoFocus = false,
  canNavigateTabs = true,
  selected = true,
  disabled = false,
  onAutoFocusHandled = vi.fn(),
} = {}) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  render(
    <Wrapper>
      <AppCommandProvider>
        <SidebarProvider>
          <TooltipProvider>
            <input aria-label="Composer" />
            <SidebarSplitContainer
              activeTabId="new-tab"
              canNavigateTabs={canNavigateTabs}
              isFullScreen={false}
              onActivateTab={() => {}}
              onGlobalTabReorder={() => {}}
              onToggleFullScreen={() => {}}
              panelStateId="new-tab-items"
              tabs={[
                {
                  id: "new-tab",
                  label: "New tab",
                  restoresPlacementAfterRemoval: false,
                },
              ]}
              renderPane={() =>
                selected ? (
                  <NewTabPage
                    autoFocus={autoFocus}
                    onAutoFocusHandled={onAutoFocusHandled}
                    onStartTerminal={() => {}}
                    startTerminalDisabled={disabled}
                    pluginActions={[
                      {
                        id: "side-chat",
                        pluginId: "side-chat",
                        icon: null,
                        title: "Start side chat",
                        onSelect: () => {},
                      },
                    ]}
                  />
                ) : (
                  <input aria-label="Editor" />
                )
              }
            />
          </TooltipProvider>
        </SidebarProvider>
      </AppCommandProvider>
    </Wrapper>,
  );
  return onAutoFocusHandled;
}

function move(key: "ArrowUp" | "ArrowDown") {
  const target = document.activeElement;
  if (!target) throw new Error("Missing focus target");
  return fireEvent.keyDown(target, { key, ctrlKey: true, shiftKey: true });
}

it("renders only the actions list without a file search", () => {
  mountPage();
  expect(screen.queryByRole("combobox")).toBeNull();
  expect(screen.queryByRole("option")).toBeNull();
  expect(screen.getByRole("button", { name: "Terminal" })).toBeDefined();
  expect(screen.getByRole("button", { name: "Start side chat" })).toBeDefined();
});

it("moves focus through the actions, skipping reorder handles", () => {
  mountPage();
  const composer = screen.getByRole("textbox", { name: "Composer" });
  const terminal = screen.getByRole("button", { name: "Terminal" });
  const sideChat = screen.getByRole("button", { name: "Start side chat" });
  act(() => composer.focus());
  for (const target of [terminal, sideChat, terminal]) {
    expect(move("ArrowDown")).toBe(false);
    expect(document.activeElement).toBe(target);
  }
  move("ArrowUp");
  expect(document.activeElement).toBe(sideChat);
});

it("skips disabled actions", () => {
  mountPage({ disabled: true });
  const composer = screen.getByRole("textbox", { name: "Composer" });
  act(() => composer.focus());
  move("ArrowDown");
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Start side chat" }),
  );
});

it("focuses the first enabled action when asked to auto focus", () => {
  const onAutoFocusHandled = mountPage({ autoFocus: true, disabled: true });
  expect(document.activeElement).toBe(
    screen.getByRole("button", { name: "Start side chat" }),
  );
  expect(onAutoFocusHandled).toHaveBeenCalledOnce();
});

it.each([
  { canNavigateTabs: false, selected: true },
  { canNavigateTabs: true, selected: false },
])(
  "leaves focus alone when the active panel has no navigable New tab page: %j",
  (options) => {
    mountPage(options);
    const input = screen.getByRole("textbox", {
      name: options.selected ? "Composer" : "Editor",
    });
    act(() => input.focus());
    move("ArrowDown");
    expect(document.activeElement).toBe(input);
  },
);
