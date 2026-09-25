// @vitest-environment jsdom

import type { ReactNode } from "react";
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
import {
  makeMcpProviderStatus,
  makeMcpServer,
  makeMcpToolPolicy,
} from "@/test/fixtures/mcp";
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
  const server = makeMcpServer();
  const mcpList = vi
    .spyOn(sdk.mcp, "list")
    .mockImplementation(async () => [server]);
  const mcpGet = vi.spyOn(sdk.mcp, "get").mockResolvedValue(server);
  const mcpTools = vi.spyOn(sdk.mcp, "serverTools").mockResolvedValue({
    tools: [
      {
        id: "github__search_issues",
        sourceId: "github",
        handle: "github",
        name: "search_issues",
        description: "Search issues",
        risk: "read",
      },
    ],
    error: null,
  });
  const mcpPolicies = vi
    .spyOn(sdk.mcp, "listPolicies")
    .mockResolvedValue([makeMcpToolPolicy()]);
  const providerStatus = vi
    .spyOn(sdk.mcp, "providerStatus")
    .mockResolvedValue(makeMcpProviderStatus());
  const fetchMock = vi.fn(async () => new Response(null, { status: 500 }));
  vi.stubGlobal("fetch", fetchMock);
  const { wrapper: QueryClientWrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientWrapper>
        <AppRoutes />
        <LocationPath />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
  return {
    fetchMock,
    mcpGet,
    mcpList,
    mcpPolicies,
    mcpTools,
    providerStatus,
    skillsList,
  };
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
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Customize page", () => {
  it("renders the skills library without fetching MCP data", async () => {
    const { fetchMock, mcpGet, mcpList, providerStatus } =
      renderRoutes("/customize");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(selectedTab()).toBe("Skills");
    expect(screen.getByPlaceholderText("Search skills")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search MCPs")).toBeNull();
    await waitFor(() => expect(fetchMock).not.toHaveBeenCalled());
    expect(mcpList).not.toHaveBeenCalled();
    expect(mcpGet).not.toHaveBeenCalled();
    expect(providerStatus).not.toHaveBeenCalled();
  });

  it("renders the MCP list with full rows without loading skills", async () => {
    const { mcpGet, mcpList, skillsList } = renderRoutes("/customize/mcps");
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(selectedTab()).toBe("MCPs");
    expect(screen.getByText("HTTP · authenticated · 2 tools")).toBeTruthy();
    expect(mcpList).toHaveBeenCalledWith(
      expect.objectContaining({ details: true }),
    );
    expect(mcpGet).not.toHaveBeenCalled();
    expect(skillsList).not.toHaveBeenCalled();
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
  });

  it("opens /customize/mcps/:ref with one server fetch and no list", async () => {
    const { mcpGet, mcpList, mcpPolicies, mcpTools, skillsList } = renderRoutes(
      "/customize/mcps/github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(selectedTab()).toBe("MCPs");
    expect(mcpGet).toHaveBeenCalledTimes(1);
    expect(mcpGet).toHaveBeenCalledWith(
      expect.objectContaining({ server: "github" }),
    );
    await screen.findByText("search_issues");
    expect(mcpTools).toHaveBeenCalledWith(
      expect.objectContaining({ server: "mcp_github" }),
    );
    expect(mcpPolicies).toHaveBeenCalledWith(
      expect.objectContaining({ server: "mcp_github" }),
    );
    expect(mcpList).not.toHaveBeenCalled();
    expect(skillsList).not.toHaveBeenCalled();
  });

  it("opens a server from the list and switches tabs in place", async () => {
    renderRoutes("/customize/mcps");
    const tabList = await screen.findByRole("tablist", { name: "Customize" });

    fireEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/customize/mcps/mcp_github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skills" }));
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(screen.getByTestId("location").textContent).toBe("/customize");
    expect(screen.getByRole("tablist", { name: "Customize" })).toBe(tabList);

    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCPs" }));
    expect(await screen.findByPlaceholderText("Search MCPs")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Customize" })).toBe(tabList);
  });

  it.each(["/customize/unknown", "/customize/mcps/installed/github"])(
    "redirects %s to the Skills tab",
    async (path) => {
      renderRoutes(path);
      await waitFor(() =>
        expect(screen.getByTestId("location").textContent).toBe("/customize"),
      );
    },
  );

  it("keeps skill detail deep links working without the tabs", async () => {
    renderRoutes(`/skills/library/${SKILL_ID}`);
    expect(
      await screen.findByRole("heading", { name: "bb-review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("tablist", { name: "Customize" })).toBeNull();
  });
});
