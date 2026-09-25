// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { CREATE_AGENT_PROMPT } from "@bb/client-core";
import type { Agent } from "@bb/domain";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeMcpServer } from "@/test/fixtures/mcp";
import { sdk } from "@/lib/sdk";
import { AppRoutes } from "../App";
import { AGENTS_PAGE_DESCRIPTION } from "./AgentsView";

vi.mock("../components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));
vi.mock("./SplitWorkspaceRoute", () => ({
  default: () => <h1>App workspace</h1>,
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_default01",
    name: "BB",
    description: "The default agent.",
    providerId: "codex",
    model: null,
    reasoningLevel: "medium",
    skills: [],
    mcpServers: [],
    instructions: "",
    mascot: "robot",
    color: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const coder = makeAgent({
  id: "agent_coder0001",
  name: "Coder",
  description: "Writes code",
  model: "gpt-5",
  reasoningLevel: "high",
  skills: ["bb-review"],
  mcpServers: ["notion"],
  instructions: "Keep diffs small.",
  mascot: "robot",
  color: 1,
  createdAt: 2,
});

function LocationPath() {
  const location = useLocation();
  return (
    <>
      <span data-testid="location">{location.pathname}</span>
      <span data-testid="location-state">
        {JSON.stringify(location.state ?? null)}
      </span>
    </>
  );
}

function renderRoutes(initialPath: string, agents: Agent[]) {
  const list = vi.spyOn(sdk.agents, "list").mockResolvedValue(agents);
  const update = vi
    .spyOn(sdk.agents, "update")
    .mockImplementation(async ({ agent, signal: _signal, ...patch }) => ({
      ...(agents.find((entry) => entry.id === agent) ?? coder),
      ...patch,
    }));
  const remove = vi
    .spyOn(sdk.agents, "remove")
    .mockImplementation(async ({ agent }) => ({ deleted: true, id: agent }));
  vi.spyOn(sdk.providers, "list").mockResolvedValue([
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
    makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
  ]);
  vi.spyOn(sdk.system, "executionOptions").mockResolvedValue({
    providers: [],
    permissionCeiling: "full",
    models: [],
    selectedOnlyModels: [],
    modelLoadError: null,
  });
  vi.spyOn(sdk.skills, "list").mockResolvedValue({
    skills: [
      {
        id: `skill_${"a".repeat(64)}`,
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
        name: "triage",
        description: "Triage issues.",
        provider: null,
        scope: "bb-user",
        pluginId: null,
        filePath: "/home/u/.bb/skills/triage/SKILL.md",
        manageable: true,
        registrySkillId: null,
      },
    ],
  });
  vi.spyOn(sdk.mcp, "list").mockImplementation(async () => [
    makeMcpServer({ id: "mcp_notion", handle: "notion", name: "Notion" }),
    makeMcpServer({
      id: "mcp_off",
      handle: "off",
      name: "Off",
      enabled: false,
    }),
  ]);
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
  return { list, update, remove };
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

beforeAll(async () => {
  await import("./AgentsView");
}, 60_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Agents page", () => {
  it("lists agents with provider, model, skill, and MCP counts", async () => {
    renderRoutes("/agents", [makeAgent(), coder]);
    expect(await screen.findByText("Coder")).toBeTruthy();
    expect(screen.getByText(AGENTS_PAGE_DESCRIPTION)).toBeTruthy();
    expect(screen.getByText("Default")).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.getByText("Codex · GPT-5 · 1 skill · 1 MCP"),
      ).toBeTruthy(),
    );
    expect(
      screen.getByText("Codex · Default model · all skills · all MCPs"),
    ).toBeTruthy();
  });

  it("filters rows with the search box", async () => {
    renderRoutes("/agents", [makeAgent(), coder]);
    expect(await screen.findByText("Coder")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search agents"), {
      target: { value: "writes" },
    });
    expect(screen.queryByText("BB")).toBeNull();
    expect(screen.getByText("Coder")).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText("Search agents"), {
      target: { value: "nothing-matches" },
    });
    expect(screen.getByText("No agents match this search.")).toBeTruthy();
  });

  it("prefills chat from New agent", async () => {
    renderRoutes("/agents", [makeAgent()]);
    fireEvent.click(await screen.findByRole("button", { name: "New agent" }));
    expect(location()).toBe("/");
    expect(
      JSON.parse(screen.getByTestId("location-state").textContent ?? "null"),
    ).toEqual({
      focusPrompt: true,
      replaceInitialPrompt: true,
      initialPrompt: CREATE_AGENT_PROMPT,
    });
  });

  it("opens an agent's detail page from its row", async () => {
    renderRoutes("/agents", [makeAgent(), coder]);
    fireEvent.click(await screen.findByRole("button", { name: "Coder" }));
    expect(location()).toBe("/agents/agent_coder0001");
    expect(await screen.findByRole("heading", { name: "Coder" })).toBeTruthy();
  });

  it("edits skills, MCPs, and instructions inline", async () => {
    const { update } = renderRoutes("/agents/Coder", [makeAgent(), coder]);
    expect(await screen.findByRole("heading", { name: "Coder" })).toBeTruthy();

    const skills = await screen.findByRole("list", { name: "Skills" });
    fireEvent.click(within(skills).getByRole("checkbox", { name: "triage" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        agent: coder.id,
        skills: ["bb-review", "triage"],
      }),
    );

    const mcps = await screen.findByRole("list", { name: "MCPs" });
    expect(within(mcps).queryByRole("checkbox", { name: "off" })).toBeNull();
    fireEvent.click(within(mcps).getByRole("checkbox", { name: "notion" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        agent: coder.id,
        mcpServers: [],
      }),
    );

    fireEvent.change(screen.getByRole("textbox", { name: "Instructions" }), {
      target: { value: "Ship small diffs." },
    });
    const instructions = screen
      .getByRole("heading", { name: "Instructions" })
      .closest("section");
    if (instructions === null) throw new Error("instructions section missing");
    fireEvent.click(within(instructions).getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith({
        agent: coder.id,
        instructions: "Ship small diffs.",
      }),
    );
  });

  it("explains that no checked skills means every skill", async () => {
    renderRoutes("/agents/BB", [makeAgent(), coder]);
    expect(await screen.findByRole("heading", { name: "BB" })).toBeTruthy();
    expect(
      screen.getByText("None checked: the agent can use every skill."),
    ).toBeTruthy();
    expect(
      screen.getByText("None checked: the agent sees every enabled MCP."),
    ).toBeTruthy();
  });

  it("deletes an agent after confirming and returns to the list", async () => {
    const { remove } = renderRoutes("/agents/Coder", [makeAgent(), coder]);
    expect(await screen.findByRole("heading", { name: "Coder" })).toBeTruthy();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Coder actions" }),
      { button: 0, ctrlKey: false },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));
    await waitFor(() =>
      expect(remove).toHaveBeenCalledWith({ agent: coder.id }),
    );
    await waitFor(() => expect(location()).toBe("/agents"));
  });

  it("shows a missing agent", async () => {
    renderRoutes("/agents/missing", [makeAgent()]);
    expect(await screen.findByText("That agent is gone.")).toBeTruthy();
  });
});
