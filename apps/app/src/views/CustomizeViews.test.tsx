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
  makeProviderGuard,
  makeMcpServer,
  makeMcpToolPolicy,
} from "@/test/fixtures/mcp";
import { sdk } from "@/lib/sdk";
import { CREATE_SKILL_PROMPT } from "@bb/client-core";
import { CREATE_MCP_PROMPT } from "@/components/mcp/mcp-prompts";
import { AppRoutes } from "../App";
import { MCPS_PAGE_DESCRIPTION } from "./CustomizeMcpsView";
import { SKILLS_PAGE_DESCRIPTION } from "./CustomizeSkillsView";

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

function renderRoutes(
  initialPath: string,
  { pendingSkills = false }: { pendingSkills?: boolean } = {},
) {
  const skillsList = vi.spyOn(sdk.skills, "list");
  if (pendingSkills) {
    skillsList.mockImplementation(() => new Promise(() => {}));
  } else {
    skillsList.mockResolvedValue({
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
        {
          id: `skill_${"b".repeat(64)}`,
          name: "claude-synced",
          description: "Synced from claude.ai.",
          provider: "claude-code",
          scope: "provider-user",
          pluginId: null,
          filePath: "/home/u/.claude/skills/synced/claude-synced/SKILL.md",
          manageable: true,
          registrySkillId: null,
        },
      ],
    });
  }
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
    .spyOn(sdk.providers, "guardStatus")
    .mockResolvedValue(makeProviderGuard());
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
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
  return { mcpGet, mcpList, mcpPolicies, mcpTools, providerStatus, skillsList };
}

function locationState(): unknown {
  return JSON.parse(screen.getByTestId("location-state").textContent ?? "null");
}

beforeAll(async () => {
  await Promise.all([
    import("./CustomizeSkillsView"),
    import("./CustomizeMcpsView"),
    import("./ToolsView"),
  ]);
}, 60_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Skills settings page", () => {
  it("renders skill cards with a search box and New skill, without tabs", async () => {
    const { mcpGet, providerStatus } = renderRoutes("/settings/skills");
    expect(await screen.findByText("bb-review")).toBeTruthy();
    expect(screen.getByText("Review the current diff.")).toBeTruthy();
    expect(screen.queryByText("claude-synced")).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    await waitFor(() =>
      expect(
        screen.getByText(`${SKILLS_PAGE_DESCRIPTION} 1 installed.`),
      ).toBeTruthy(),
    );
    expect(screen.getByPlaceholderText("Search skills")).toBeTruthy();
    expect(screen.getByRole("button", { name: "New skill" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /filter|sort/i })).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(mcpGet).not.toHaveBeenCalled();
    expect(providerStatus).not.toHaveBeenCalled();
  });

  it("shows a card skeleton while skills load", async () => {
    renderRoutes("/settings/skills", { pendingSkills: true });
    expect(
      await screen.findByRole("status", { name: "Loading skills" }),
    ).toBeTruthy();
  });

  it("prefills chat with the skill prompt from New skill", async () => {
    renderRoutes("/settings/skills");
    fireEvent.click(await screen.findByRole("button", { name: "New skill" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(locationState()).toEqual({
      focusPrompt: true,
      replaceInitialPrompt: true,
      initialPrompt: CREATE_SKILL_PROMPT,
      createDraftKind: "skill",
    });
  });

  it("opens a skill from its card and back to the list", async () => {
    renderRoutes("/settings/skills");
    fireEvent.click(await screen.findByRole("button", { name: "bb-review" }));
    expect(screen.getByTestId("location").textContent).toBe(
      `/settings/skills/${SKILL_ID}`,
    );
    expect(
      await screen.findByRole("heading", { name: "bb-review" }),
    ).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
  });
});

describe("MCPs settings page", () => {
  it("renders MCP cards with a search box and New MCP", async () => {
    const { mcpGet, mcpList } = renderRoutes("/settings/mcps");
    expect(await screen.findByText("GitHub")).toBeTruthy();
    expect(screen.getAllByText("GitHub remote MCP")).toHaveLength(2);
    await waitFor(() =>
      expect(
        screen.getByText(`${MCPS_PAGE_DESCRIPTION} 2 installed.`),
      ).toBeTruthy(),
    );
    expect(mcpList).toHaveBeenCalledWith(
      expect.objectContaining({ details: true }),
    );
    expect(mcpGet).not.toHaveBeenCalled();
    expect(screen.getByPlaceholderText("Search MCPs")).toBeTruthy();
    expect(screen.queryByPlaceholderText("Search skills")).toBeNull();
    expect(screen.getByRole("button", { name: "New MCP" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });

  it("prefills chat with the MCP prompt from New MCP", async () => {
    renderRoutes("/settings/mcps");
    fireEvent.click(await screen.findByRole("button", { name: "New MCP" }));
    expect(screen.getByTestId("location").textContent).toBe("/");
    expect(locationState()).toEqual({
      focusPrompt: true,
      replaceInitialPrompt: true,
      initialPrompt: CREATE_MCP_PROMPT,
    });
  });

  it("opens /settings/mcps/:ref with one server fetch and no collection", async () => {
    const { mcpGet, mcpList, mcpPolicies, mcpTools, skillsList } = renderRoutes(
      "/settings/mcps/github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
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

  it("opens a server from its card", async () => {
    renderRoutes("/settings/mcps");
    fireEvent.click(await screen.findByRole("button", { name: "GitHub" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/settings/mcps/mcp_github",
    );
    expect(await screen.findByRole("heading", { name: "GitHub" })).toBeTruthy();
  });
});
