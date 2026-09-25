// @vitest-environment jsdom

import { useEffect, type ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makePluginRegistrationSet } from "@/test/fixtures/plugins";
import {
  resetPluginSlotStoreForTest,
  setPluginSlotRegistrations,
} from "@/lib/plugin-slots";
import { resetAllCrashedPluginSlotsForTest } from "@/components/plugin/PluginSlotMount";
import { useBbNavigate } from "@/lib/plugin-sdk-hooks";
import { sdk } from "@/lib/sdk";
import { AppRoutes } from "../App";

vi.mock("../components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));
vi.mock("./SplitWorkspaceRoute", () => ({
  default: () => <h1>App workspace</h1>,
}));

const SKILL_ID = `skill_${"a".repeat(64)}`;
const panelMounts = vi.fn();

function McpsPanelFixture({ subPath }: { subPath: string }) {
  const nav = useBbNavigate();
  useEffect(() => {
    panelMounts();
  }, []);
  return (
    <div data-testid="mcps-panel">
      <span data-testid="mcps-sub-path">{subPath}</span>
      <button
        type="button"
        onClick={() =>
          nav.toPluginPanel("mcp", { subPath: "installed/github" })
        }
      >
        Open GitHub
      </button>
    </div>
  );
}

function LocationPath() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
      {location.hash}
    </span>
  );
}

function renderRoutes(initialPath: string) {
  const skillsList = vi.spyOn(sdk.skills, "list").mockResolvedValue({
    skills: [
      {
        id: SKILL_ID,
        name: "bb-review",
        description: "Review the current diff.",
        provider: null,
        scope: "bb-user",
        pluginId: null,
        filePath: "/home/u/.bb/skills/bb-review/SKILL.md",
        manageable: true,
        registrySkillId: null,
      },
    ],
  });
  vi.spyOn(sdk.providers, "list").mockResolvedValue([]);
  const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  setPluginSlotRegistrations(
    "mcp",
    makePluginRegistrationSet({
      navPanels: [
        {
          id: "mcp",
          title: "MCPs",
          icon: "Layers",
          path: "mcp",
          component: McpsPanelFixture,
        },
      ],
    }),
  );
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientWrapper>
        <AppRoutes />
        <LocationPath />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
  return { fetchMock, skillsList };
}

function selectedTab(): string | null {
  return (
    screen
      .getAllByRole("tab")
      .find((tab) => tab.getAttribute("aria-selected") === "true")
      ?.textContent ?? null
  );
}

beforeAll(async () => {
  await Promise.all([import("./CustomizeView"), import("./ToolsView")]);
}, 60_000);

afterEach(() => {
  cleanup();
  resetAllCrashedPluginSlotsForTest();
  resetPluginSlotStoreForTest();
  panelMounts.mockReset();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Customize page", () => {
  it("renders the skills library under the tabs without the registry or MCPs panel", async () => {
    const { fetchMock } = renderRoutes("/customize");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(selectedTab()).toBe("Skills");
    expect(screen.getByPlaceholderText("Search skills")).toBeTruthy();
    expect(screen.queryByTestId("mcps-panel")).toBeNull();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
  });

  it("renders the MCPs panel under the tabs without loading skills", async () => {
    const { fetchMock, skillsList } = renderRoutes(
      "/customize/mcps/installed/github",
    );
    expect((await screen.findByTestId("mcps-sub-path")).textContent).toBe(
      "installed/github",
    );
    expect(selectedTab()).toBe("MCPs");
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
    expect(skillsList).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("switches tabs and follows plugin navigation without remounting the page", async () => {
    renderRoutes("/customize/mcps");
    await screen.findByTestId("mcps-panel");
    const tabList = screen.getByRole("tablist", { name: "Customize" });

    fireEvent.click(screen.getByRole("button", { name: "Open GitHub" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/customize/mcps/installed/github",
    );
    expect(screen.getByTestId("mcps-sub-path").textContent).toBe(
      "installed/github",
    );
    expect(panelMounts).toHaveBeenCalledTimes(1);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skills" }));
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/customize");
    expect(screen.queryByTestId("mcps-panel")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Customize" })).toBe(tabList);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCPs" }));
    expect(await screen.findByTestId("mcps-panel")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
    expect(screen.getByRole("tablist", { name: "Customize" })).toBe(tabList);
  });

  it("redirects unknown Customize paths to the Skills tab", async () => {
    renderRoutes("/customize/unknown");
    await waitFor(() =>
      expect(screen.getByTestId("location").textContent).toBe("/customize"),
    );
  });

  it("keeps skill detail deep links working without the tabs", async () => {
    renderRoutes(`/skills/library/${SKILL_ID}`);
    expect(
      await screen.findByRole("heading", { name: "bb-review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Customize" })).toBeNull();
  });
});
