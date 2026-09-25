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
import { CREATE_SKILL_PROMPT } from "@bb/client-core";
import { CREATE_MCP_PROMPT } from "@/components/mcp/mcp-prompts";
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
    <>
      <span data-testid="location">
        {location.pathname}
        {location.search}
        {location.hash}
      </span>
      <span data-testid="location-state">
        {JSON.stringify(location.state ?? null)}
      </span>
    </>
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
    .mockImplementation(async () => [
      server,
      makeMcpServer({ id: "mcp_notion", handle: "notion", name: "Notion" }),
    ]);
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

function tabCounts(): Array<string | null> {
  return screen.getAllByRole("tab").map((tab) => tab.textContent);
}

function locationState(): unknown {
  return JSON.parse(screen.getByTestId("location-state").textContent ?? "null");
}

function expectNoFilterOrSortControls() {
  expect(screen.queryByRole("button", { name: /filter|sort/i })).toBeNull();
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
  it("renders the skills tab with counts on both mode chips", async () => {
    const { mcpGet, providerStatus } = renderRoutes("/customize");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    await waitFor(() => expect(tabCounts()).toEqual(["Skills1", "MCPs2"]));
    expect(selectedTab()).toBe("Skills1");
    expect(
      screen.getByText(
        "Skills and MCP servers every agent can use. Add new ones in chat.",
      ),
    ).toBeTruthy();
    expect(screen.getByPlaceholderText("Search skills")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search MCPs")).toBeNull();
    expect(screen.getByRole("button", { name: "New skill" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /options$/ })).toBeNull();
    expectNoFilterOrSortControls();
    expect(mcpGet).not.toHaveBeenCalled();
    expect(providerStatus).not.toHaveBeenCalled();
  });

  it("renders the MCP list with full rows and a New MCP button", async () => {
    const { mcpGet, mcpList } = renderRoutes("/customize/mcps");
    expect(await screen.findByText("GitHub")).toBeTruthy();
    await waitFor(() => expect(tabCounts()).toEqual(["Skills1", "MCPs2"]));
    expect(selectedTab()).toBe("MCPs2");
    expect(screen.getAllByText("HTTP · authenticated · 2 tools")).toHaveLength(
      2,
    );
    expect(mcpList).toHaveBeenCalledWith(
      expect.objectContaining({ details: true }),
    );
    expect(mcpGet).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Search MCPs")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
    expect(screen.getByRole("button", { name: "New MCP" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "New skill" })).toBeNull();
    expect(screen.queryByRole("button", { name: /options$/ })).toBeNull();
    expectNoFilterOrSortControls();
  });

  it("prefills chat with the skill prompt from New skill", async () => {
    renderRoutes("/customize");
    fireEvent.click(await screen.findByRole("button", { name: "New skill" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(locationState()).toEqual({
      focusPrompt: true,
      replaceInitialPrompt: true,
      initialPrompt: CREATE_SKILL_PROMPT,
      createDraftKind: "skill",
    });
  });

  it("prefills chat with the MCP prompt from New MCP", async () => {
    renderRoutes("/customize/mcps");
    fireEvent.click(await screen.findByRole("button", { name: "New MCP" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(locationState()).toEqual({
      focusPrompt: true,
      replaceInitialPrompt: true,
      initialPrompt: CREATE_MCP_PROMPT,
    });
  });

  it("switches routes with the mode chips without remounting the page", async () => {
    renderRoutes("/customize");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    const tabList = screen.getByRole("tablist");

    fireEvent.click(screen.getByRole("tab", { name: /^MCPs/ }));
    expect(screen.getByTestId("location").textContent).toBe("/customize/mcps");
    expect(await screen.findByPlaceholderText("Search MCPs")).toBeTruthy();
    expect(screen.getByRole("tablist")).toBe(tabList);

    fireEvent.click(screen.getByRole("tab", { name: /^Skills/ }));
    expect(screen.getByTestId("location").textContent).toBe("/customize");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(screen.getByRole("tablist")).toBe(tabList);
  });

  it("opens /customize/mcps/:ref with one server fetch and no collection", async () => {
    const { mcpGet, mcpList, mcpPolicies, mcpTools, skillsList } = renderRoutes(
      "/customize/mcps/github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
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

  it("opens a server from the list", async () => {
    renderRoutes("/customize/mcps");
    fireEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/customize/mcps/mcp_github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
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
    expect(screen.queryByRole("tablist")).toBeNull();
  });
});
