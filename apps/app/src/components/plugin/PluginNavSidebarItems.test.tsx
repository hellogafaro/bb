// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { type ComponentType } from "react";
import { createStore, Provider } from "jotai";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { SidebarProvider } from "@/components/ui/sidebar.js";
import { useSidebarReorderDnd } from "@/components/sidebar/useSidebarReorderDnd";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import {
  AUTOMATIONS_PLUGIN_ID,
  getPluginPanelRoutePath,
} from "@/lib/route-paths";
import {
  resetAllCrashedPluginSlotsForTest,
  resetCrashedPluginSlots,
} from "./PluginSlotMount";
import { makePluginRegistrationSet as registrationSet } from "@/test/fixtures/plugins";
import {
  type BuiltInSidebarNavEntry,
  ResourceNavSidebarItem,
  PluginNavSidebarItems,
} from "./PluginNavSidebarItems";
import {
  pluginNavPanelOrderAtom,
  pluginNavVisiblePanelKeysAtom,
} from "./pluginNavSidebarAtoms";
import {
  markPluginFrontendsSettled,
  resetPluginFrontendBootStateForTest,
  setServerPluginsStarting,
  setPluginFrontendReconcilePending,
} from "@/lib/plugin-frontend-boot-state";
import { writeLastKnownPluginNavPanelChrome } from "@/lib/plugin-nav-panel-chrome";
import { splitLayoutAtom } from "@/lib/split-layout/atoms";
import { countPanes, findPaneByContent } from "@/lib/split-layout";

vi.mock("@/components/sidebar/useSidebarReorderDnd", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/sidebar/useSidebarReorderDnd")
    >();
  return {
    ...actual,
    useSidebarReorderDnd: vi.fn(actual.useSidebarReorderDnd),
  };
});

function reorderSidebar(activeId: string, overId: string) {
  const options = vi.mocked(useSidebarReorderDnd).mock.lastCall?.[0];
  if (!options) throw new Error("Sidebar reorder handler is not mounted");
  act(() => {
    options.onDragEnd({
      active: {
        id: activeId,
        data: { current: {} },
        rect: { current: { initial: null, translated: null } },
      },
      over: {
        id: overId,
        data: { current: {} },
        rect: new DOMRect(),
        disabled: false,
      },
      activatorEvent: new Event("pointerdown"),
      collisions: [],
      delta: { x: 0, y: 0 },
    });
  });
}

function registerPanel(
  pluginId: string,
  title: string,
  experimentalSidebarAccessory?: ComponentType,
) {
  setPluginSlotRegistrations(
    pluginId,
    registrationSet({
      navPanels: [
        {
          id: "main",
          title,
          icon: "Puzzle",
          path: "main",
          component: () => null,
          ...(experimentalSidebarAccessory === undefined
            ? {}
            : {
                experimental_sidebarAccessory: experimentalSidebarAccessory,
              }),
        },
      ],
    }),
  );
}

interface RenderSidebarItemsOptions {
  builtInEntries?: readonly BuiltInSidebarNavEntry[];
  storedOrder?: string[];
  storedVisibleKeys?: string[] | null;
  compactViewport?: boolean;
  splitEnabled?: boolean;
}

function renderSidebarItems(options: RenderSidebarItemsOptions = {}) {
  const store = createStore();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  if (options.storedOrder) {
    store.set(pluginNavPanelOrderAtom, options.storedOrder);
  }
  if ("storedVisibleKeys" in options) {
    store.set(pluginNavVisiblePanelKeysAtom, options.storedVisibleKeys ?? null);
  }
  if (options.splitEnabled) {
    store.set(splitLayoutAtom, {
      root: {
        type: "pane",
        paneId: "pane-1",
        content: { kind: "new-thread" },
      },
      focusedPaneId: "pane-1",
    });
  }
  const view = render(
    <CompactViewportOverrideProvider
      isCompactViewport={options.compactViewport ?? false}
    >
      <QueryClientProvider client={queryClient}>
        <Provider store={store}>
          <MemoryRouter>
            <SidebarProvider>
              <PluginNavSidebarItems
                builtInEntries={options.builtInEntries}
                splitEnabled={options.splitEnabled}
              />
              <LocationProbe />
            </SidebarProvider>
          </MemoryRouter>
        </Provider>
      </QueryClientProvider>
    </CompactViewportOverrideProvider>,
  );
  return { ...view, store };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location-path">{location.pathname}</output>;
}

function panelRowNames(
  labels: readonly string[] = ["Docs", "GitHub"],
): string[] {
  const rowLabels = new Set(labels);
  const container = screen.queryByTestId("plugin-nav-sidebar-items");
  if (!container) return [];
  return Array.from(
    container.querySelectorAll<HTMLElement>("[data-sidebar-navigation-item]"),
  )
    .map((row) => row.textContent?.trim() ?? "")
    .filter((label) => rowLabels.has(label));
}

function builtInEntry(id: string, title: string): BuiltInSidebarNavEntry {
  return {
    kind: "built-in",
    pluginId: "__bb__",
    id,
    content: <button type="button">{title}</button>,
  };
}

function visibleRowKeys(): string[] {
  return Array.from(
    screen
      .getByTestId("plugin-nav-sidebar-items")
      .querySelectorAll("[data-sidebar-navigation-item]"),
  ).map((row) => row.getAttribute("data-sidebar-navigation-item") ?? "");
}

beforeEach(() => {
  vi.clearAllMocks();
  resetPluginFrontendBootStateForTest();
  markPluginFrontendsSettled();
  window.localStorage.clear();
  resetAllCrashedPluginSlotsForTest();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  resetPluginFrontendBootStateForTest();
  resetPluginSlotStoreForTest();
  resetAllCrashedPluginSlotsForTest();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("PluginNavSidebarItems", () => {
  it("keeps built-in actions visible without placeholders during startup", () => {
    resetPluginFrontendBootStateForTest();
    renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread")],
    });
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
    expect(screen.getByRole("button", { name: "New thread" })).toBeTruthy();
    act(() => markPluginFrontendsSettled());
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
  });

  it("keeps remembered labels while the server starts, then reveals ready panels in place", () => {
    writeLastKnownPluginNavPanelChrome([
      {
        pluginId: "docs",
        id: "main",
        path: "main",
        title: "Docs",
        icon: "Puzzle",
      },
    ]);
    setServerPluginsStarting(true);
    renderSidebarItems();
    const row = screen.getByRole("button", { name: "Docs" });
    expect(row.getAttribute("aria-busy")).toBe("true");
    expect(screen.queryByTestId("plugin-nav-loading-placeholders")).toBeNull();
    act(() => {
      setPluginFrontendReconcilePending(true);
      setServerPluginsStarting(false);
      registerPanel("docs", "Docs");
    });
    expect(screen.getByRole("button", { name: "Docs" })).toBe(row);
    expect(row.hasAttribute("aria-busy")).toBe(false);
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
    act(() => setPluginFrontendReconcilePending(false));
    expect(
      screen.queryByRole("status", { name: "Loading plugins" }),
    ).toBeNull();
  });

  it("collapses the entire subsection with zero traditional plugins", () => {
    renderSidebarItems();

    expect(screen.queryByTestId("plugin-nav-sidebar-items")).toBeNull();
    expect(screen.queryByText("Plugins")).toBeNull();
  });

  it("navigates to a plugin panel on click", () => {
    registerPanel("docs", "Docs");
    renderSidebarItems();

    expect(screen.queryByText("Plugins")).toBeNull();
    expect(panelRowNames(["Docs"])).toEqual(["Docs"]);
    fireEvent.click(screen.getByRole("button", { name: "Docs" }));

    expect(screen.getByTestId("location-path").textContent).toBe(
      getPluginPanelRoutePath({ pluginId: "docs", path: "main" }),
    );
  });

  it("renders rows without option menus or a More drawer", () => {
    registerPanel("docs", "Docs");
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
    });

    expect(screen.queryByRole("button", { name: /options/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /More/ })).toBeNull();
    expect(screen.queryByText("Customize sidebar")).toBeNull();
    fireEvent.contextMenu(screen.getByRole("button", { name: "Docs" }));
    fireEvent.contextMenu(screen.getByRole("button", { name: "New thread" }));
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("keeps an accessory-less plugin row unchanged", () => {
    registerPanel("docs", "Docs");

    const view = renderSidebarItems();

    expect(screen.getByRole("button", { name: "Docs" }).textContent).toBe(
      "Docs",
    );
    expect(
      screen.getByRole("button", { name: "Docs" }).classList.contains("pr-18"),
    ).toBe(false);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("bounds and truncates a long sidebar accessory", () => {
    registerPanel("tasks", "Tasks", () => (
      <span>123456789012345678901234567890</span>
    ));

    const view = renderSidebarItems();
    const accessory = view.container.querySelector(
      "[data-plugin-nav-sidebar-accessory]",
    );

    expect(accessory?.textContent).toBe("123456789012345678901234567890");
    expect(screen.getByRole("button", { name: "Tasks" })).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Tasks" }).classList.contains("pr-18"),
    ).toBe(true);
    expect(accessory?.classList.contains("bb-sidebar-hover-actions-fade")).toBe(
      false,
    );
    for (const className of [
      "right-1",
      "min-w-5",
      "max-h-5",
      "max-w-16",
      "overflow-hidden",
      "text-xs",
      "text-ellipsis",
      "whitespace-nowrap",
    ]) {
      expect(accessory?.classList.contains(className), className).toBe(true);
    }
  });

  it("does not mount sidebar accessories on compact viewports", () => {
    let mounts = 0;
    registerPanel("tasks", "Tasks", () => {
      mounts += 1;
      return <span>12</span>;
    });

    const view = renderSidebarItems({ compactViewport: true });

    expect(mounts).toBe(0);
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).toBeNull();
  });

  it("hides a crashed accessory and retries it after a plugin reload", () => {
    function CrashingAccessory(): never {
      throw new Error("accessory crashed");
    }
    registerPanel("tasks", "Tasks", CrashingAccessory);

    const view = renderSidebarItems();

    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]"),
    ).not.toBeNull();

    resetCrashedPluginSlots("tasks");
    act(() => registerPanel("tasks", "Tasks", () => <span>18</span>));

    expect(screen.getByText("18")).toBeDefined();
    expect(screen.queryByText("plugin tasks crashed")).toBeNull();
  });

  it("shows every plugin directly by default", () => {
    const labels = ["One", "Two", "Three", "Four", "Five", "Six"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));

    renderSidebarItems();

    expect(panelRowNames(labels)).toEqual(labels);
  });

  it("hides only Search by default and renders nothing in its place", () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      storedOrder: [
        "plugin-0/main",
        "__bb__/new-thread",
        "plugin-1/main",
        "__bb__/search-threads",
        "plugin-2/main",
        "plugin-3/main",
      ],
    });

    expect(visibleRowKeys()).toEqual([
      "plugin-0/main",
      "__bb__/new-thread",
      "plugin-1/main",
      "plugin-2/main",
      "plugin-3/main",
    ]);
    expect(screen.queryByRole("button", { name: "Search threads" })).toBeNull();
  });

  it("omits rows hidden by stored preferences", () => {
    registerPanel("docs", "Docs");
    const { store } = renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread")],
      storedOrder: ["__bb__/new-thread", "docs/main"],
      storedVisibleKeys: ["__bb__/new-thread"],
    });

    expect(visibleRowKeys()).toEqual(["__bb__/new-thread"]);
    expect(screen.queryByRole("button", { name: "Docs" })).toBeNull();
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "__bb__/new-thread",
    ]);
  });

  it("persists new rows and existing hidden choices when reordered", () => {
    registerPanel("docs", "Docs");
    registerPanel("github", "GitHub");
    registerPanel("tasks", "Tasks");
    const builtInEntries = [
      builtInEntry("new-thread", "New thread"),
      builtInEntry("search-threads", "Search threads"),
      builtInEntry("extensions", "Plugins"),
      builtInEntry("skills", "Skills"),
    ];
    const view = renderSidebarItems({
      builtInEntries,
      storedOrder: [
        "__bb__/extensions",
        "docs/main",
        "github/main",
        "unregistered/main",
      ],
      storedVisibleKeys: [
        "__bb__/extensions",
        "docs/main",
        "unregistered/main",
      ],
    });
    const initialVisibleKeys = visibleRowKeys();
    expect(initialVisibleKeys).toEqual([
      "__bb__/new-thread",
      "__bb__/extensions",
      "__bb__/skills",
      "docs/main",
      "tasks/main",
    ]);
    reorderSidebar("tasks/main", "docs/main");
    const storedOrder = view.store.get(pluginNavPanelOrderAtom);
    const storedVisibleKeys = view.store.get(pluginNavVisiblePanelKeysAtom);
    expect(new Set(storedVisibleKeys)).toEqual(
      new Set([...initialVisibleKeys, "unregistered/main"]),
    );
    expect(storedOrder).toContain("unregistered/main");
    expect(storedOrder.indexOf("tasks/main")).toBeLessThan(
      storedOrder.indexOf("docs/main"),
    );
    view.unmount();
    renderSidebarItems({ builtInEntries, storedOrder, storedVisibleKeys });
    expect(visibleRowKeys()).toEqual([
      "__bb__/new-thread",
      "__bb__/extensions",
      "__bb__/skills",
      "tasks/main",
      "docs/main",
    ]);
  });

  it("keeps Skills hidden when inherited from a hidden Plugins row after reordering", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderSidebarItems({
      builtInEntries: [
        builtInEntry("extensions", "Plugins"),
        builtInEntry("skills", "Skills"),
      ],
      storedOrder: ["__bb__/extensions", "docs/main"],
      storedVisibleKeys: ["docs/main"],
    });
    reorderSidebar("tasks/main", "docs/main");
    expect(visibleRowKeys()).toEqual(["tasks/main", "docs/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "tasks/main",
      "docs/main",
    ]);
  });

  it("preserves default visibility when reordering the sidebar without saved choices", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderSidebarItems({ storedVisibleKeys: null });
    reorderSidebar("tasks/main", "docs/main");
    expect(visibleRowKeys()).toEqual(["tasks/main", "docs/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toBeNull();
  });

  it("seeds newly introduced built-ins without overriding existing plugin visibility", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      storedOrder: ["tasks/main", "docs/main"],
      storedVisibleKeys: ["docs/main"],
    });

    expect(visibleRowKeys()).toEqual(["__bb__/new-thread", "docs/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual(["docs/main"]);
    expect(store.get(pluginNavPanelOrderAtom)).toEqual([
      "tasks/main",
      "docs/main",
    ]);
  });

  it("shows a newly installed plugin without touching existing choices", () => {
    registerPanel("docs", "Docs");
    registerPanel("tasks", "Tasks");
    const { store } = renderSidebarItems({
      builtInEntries: [builtInEntry("new-thread", "New thread")],
      storedOrder: ["__bb__/new-thread", "docs/main"],
      storedVisibleKeys: ["__bb__/new-thread"],
    });

    expect(visibleRowKeys()).toEqual(["__bb__/new-thread", "tasks/main"]);
    expect(store.get(pluginNavVisiblePanelKeysAtom)).toEqual([
      "__bb__/new-thread",
    ]);
    expect(store.get(pluginNavPanelOrderAtom)).toEqual([
      "__bb__/new-thread",
      "docs/main",
    ]);
  });

  it("respects a stored choice to keep Search visible", () => {
    renderSidebarItems({
      builtInEntries: [
        builtInEntry("new-thread", "New thread"),
        builtInEntry("search-threads", "Search threads"),
      ],
      storedOrder: ["__bb__/new-thread", "__bb__/search-threads"],
      storedVisibleKeys: ["__bb__/new-thread", "__bb__/search-threads"],
    });

    expect(visibleRowKeys()).toEqual([
      "__bb__/new-thread",
      "__bb__/search-threads",
    ]);
  });

  it("applies one persisted mixed order to direct rows", () => {
    const labels = ["One", "Two", "Three", "Four"];
    labels.forEach((label, index) => registerPanel(`plugin-${index}`, label));
    const newThread = builtInEntry("new-thread", "New thread");
    const searchThreads = builtInEntry("search-threads", "Search threads");
    renderSidebarItems({
      builtInEntries: [newThread, searchThreads],
      storedOrder: [
        "plugin-3/main",
        "__bb__/search-threads",
        "plugin-1/main",
        "__bb__/new-thread",
        "plugin-0/main",
        "plugin-2/main",
      ],
      storedVisibleKeys: [
        "plugin-3/main",
        "__bb__/search-threads",
        "__bb__/new-thread",
        "plugin-0/main",
      ],
    });

    expect(visibleRowKeys()).toEqual([
      "plugin-3/main",
      "__bb__/search-threads",
      "__bb__/new-thread",
      "plugin-0/main",
    ]);
  });

  it("keeps Automations on the plugin row contract with a unified identity", () => {
    registerPanel(AUTOMATIONS_PLUGIN_ID, "Automations", () => (
      <span>Scheduled</span>
    ));
    const view = renderSidebarItems({ splitEnabled: true });

    expect(
      view.container.querySelector(
        '[data-sidebar-navigation-item="__bb__/automations"]',
      ),
    ).not.toBeNull();
    expect(
      view.container.querySelector("[data-plugin-nav-sidebar-accessory]")
        ?.textContent,
    ).toBe("Scheduled");

    fireEvent.click(screen.getByRole("button", { name: "Automations" }), {
      metaKey: true,
    });
    const layout = view.store.get(splitLayoutAtom);
    expect(layout).not.toBeNull();
    expect(countPanes(layout!.root)).toBe(2);
    expect(
      findPaneByContent(layout!.root, {
        kind: "plugin-panel",
        pluginId: AUTOMATIONS_PLUGIN_ID,
        panelPath: "main",
        subPath: "",
      }),
    ).not.toBeNull();
  });
});

describe("ResourceNavSidebarItem", () => {
  it.each([
    ["Plugins", "Plug02", "/plugins"],
    ["Skills", "Zap", "/skills"],
  ] as const)("renders the static %s icon", (title, icon, routePath) => {
    render(
      <MemoryRouter>
        <ResourceNavSidebarItem
          icon={icon}
          title={title}
          routePath={routePath}
        />
      </MemoryRouter>,
    );

    const row = screen.getByRole("button", { name: title });
    expect(row.querySelector(`[data-icon="${icon}"]`)).not.toBeNull();
  });
});
