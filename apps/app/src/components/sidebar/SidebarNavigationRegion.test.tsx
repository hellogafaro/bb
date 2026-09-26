// @vitest-environment jsdom

import { useEffect, useState, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExperimentalSidebarNavigationProps } from "@get-bb/plugin-sdk";
import { SidebarProvider } from "@/components/ui/sidebar";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  getNotifications,
  resetNotificationStore,
} from "@/lib/notifications/notification-store";
import { SidebarNavigationRegion } from "./SidebarNavigationRegion";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  openNewThreadInSplit: vi.fn(),
  onSearch: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));
vi.mock("@/components/plugin/PluginNavSidebarItems", () => ({
  ResourceNavSidebarItem: () => <div />,
  PluginNavSidebarItems: ({
    builtInEntries = [],
  }: {
    builtInEntries?: Array<{ id: string; content: ReactNode }>;
  }) => (
    <div>
      {builtInEntries.map((entry) => (
        <div key={entry.id}>{entry.content}</div>
      ))}
    </div>
  ),
}));
vi.mock("./usePaneContentSplitDrag", () => ({
  usePaneContentSplitActions: () => ({
    beginDrag: vi.fn(),
    isCompact: false,
    openInSplit: vi.fn(),
  }),
}));

function Replacement({
  activeItemId,
  experimental_Original: Original,
  experimental_activate,
  items,
}: ExperimentalSidebarNavigationProps) {
  const [delegate, setDelegate] = useState(false);
  const [crash, setCrash] = useState(false);
  if (crash) throw new Error("navigation fixture crash");
  if (delegate) return <Original />;
  return (
    <div data-testid="replacement-navigation">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          aria-current={activeItemId === item.id ? "page" : undefined}
          {...item.experimental_splitProps}
          onClick={(event) =>
            experimental_activate(item.id, {
              openInSplit: event.metaKey || event.ctrlKey,
            })
          }
        >
          {item.label}
        </button>
      ))}
      <button type="button" onClick={() => setDelegate(true)}>
        Delegate to BB
      </button>
      <button type="button" onClick={() => setCrash(true)}>
        Crash replacement
      </button>
    </div>
  );
}

function LocationProbe() {
  return <output data-testid="pathname">{useLocation().pathname}</output>;
}

function RetainedOwner({ onMount }: { onMount: () => void }) {
  useEffect(onMount, [onMount]);
  return <div data-testid="retained-owner">Retained thread list</div>;
}

function Harness({ onOwnerMount }: { onOwnerMount: () => void }) {
  return (
    <>
      <SidebarNavigationRegion
        splitEnabled
        newThreadSplit={{ openInSplit: mocks.openNewThreadInSplit }}
        onNavigate={vi.fn()}
        onNewChat={vi.fn()}
        onSearch={mocks.onSearch}
      />
      <RetainedOwner onMount={onOwnerMount} />
      <LocationProbe />
    </>
  );
}

function renderHarness(
  onOwnerMount = vi.fn(),
  initialEntries: string[] = ["/"],
) {
  return render(
    <Provider store={createStore()}>
      <MemoryRouter initialEntries={initialEntries}>
        <SidebarProvider>
          <Harness onOwnerMount={onOwnerMount} />
        </SidebarProvider>
      </MemoryRouter>
    </Provider>,
  );
}

function registerFixture() {
  setPluginSlotRegistrations(
    "garden",
    registrationSet({
      navPanels: [
        {
          id: "docs",
          title: "Docs",
          icon: "BookOpen",
          path: "docs",
          component: () => null,
        },
      ],
      experimentalSidebarNavigations: [
        {
          id: "navbar",
          title: "Garden Navbar",
          component: Replacement,
        },
      ],
    }),
  );
}

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  resetNotificationStore();
  window.localStorage.clear();
  vi.restoreAllMocks();
  mocks.dispatch.mockReset();
  mocks.openNewThreadInSplit.mockReset();
  mocks.onSearch.mockReset();
});

describe("SidebarNavigationRegion", () => {
  it("navigates to a current plugin destination through the host", () => {
    registerFixture();
    renderHarness();

    fireEvent.click(screen.getByRole("button", { name: "Docs" }));

    expect(screen.getByTestId("pathname").textContent).toBe(
      "/plugins/garden/docs",
    );
  });

  it.each(["/settings/skills", "/settings/agents", "/plugins"])(
    "offers no Customize, Agents, or Plugins entry on %s",
    (route) => {
      registerFixture();
      renderHarness(vi.fn(), [route]);

      expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Plugins" })).toBeNull();
    },
  );

  it("delegates and falls back after a crash without owner remounts", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    registerFixture();
    const ownerMount = vi.fn();
    renderHarness(ownerMount);
    expect(ownerMount).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "Delegate to BB" }));
    expect(screen.getByTestId("built-in-sidebar-navigation")).toBeDefined();
    expect(ownerMount).toHaveBeenCalledOnce();

    cleanup();
    resetAllCrashedPluginSlotsForTest();
    renderHarness(ownerMount);
    fireEvent.click(screen.getByRole("button", { name: "Crash replacement" }));
    expect(screen.getByTestId("built-in-sidebar-navigation")).toBeDefined();
    expect(ownerMount).toHaveBeenCalledTimes(2);
    expect(getNotifications()).toEqual([
      expect.objectContaining({
        title: "Sidebar navigation plugin crashed",
        description:
          "Garden Navbar (garden) stopped working, so bb's own navigation is back.",
      }),
    ]);
  });
});
