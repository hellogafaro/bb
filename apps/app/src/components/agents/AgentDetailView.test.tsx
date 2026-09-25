// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Agent, AvailableModel } from "@bb/domain";
import type { SystemExecutionOptionsResponse } from "@bb/server-contract";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { AgentDetailView } from "./AgentDetailView";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    agents: { list: vi.fn(), update: vi.fn(), remove: vi.fn() },
    providers: { list: vi.fn() },
    system: { executionOptions: vi.fn() },
  },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useIndexedAppCommandHandlers: () => undefined,
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

vi.mock("@/hooks/queries/mcp-queries", () => ({
  useMcpServers: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/skills-queries", () => ({
  useProjectSkills: () => ({ data: { skills: [] } }),
}));

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_coder0001",
    name: "Coder",
    description: "",
    providerId: "codex",
    model: null,
    reasoningLevel: "medium",
    skills: [],
    mcpServers: [],
    instructions: "",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function availableModel(
  model: string,
  displayName: string,
  isDefault = false,
): AvailableModel {
  return {
    id: model,
    model,
    displayName,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "low", description: "Low" },
      { reasoningEffort: "medium", description: "Medium" },
      { reasoningEffort: "high", description: "High" },
    ],
    defaultReasoningEffort: "medium",
    isDefault,
  };
}

const providers = [
  makeProviderInfo({ id: "codex", displayName: "Codex" }),
  makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
];

const modelsByProvider: Record<string, AvailableModel[]> = {
  codex: [
    availableModel("gpt-5.5", "GPT-5.5", true),
    availableModel("gpt-5.2", "GPT-5.2"),
  ],
  "claude-code": [availableModel("claude-opus-4-7", "Claude Opus 4.7", true)],
};

function renderDetail(agent: Agent) {
  vi.mocked(sdk.agents.list).mockResolvedValue([agent]);
  vi.mocked(sdk.agents.update).mockImplementation(
    async ({ agent: _ref, ...update }) =>
      ({
        ...agent,
        ...update,
      }) as Agent,
  );
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <AgentDetailView agentRef={agent.id} />
    </MemoryRouter>,
    { wrapper },
  );
}

async function openPicker() {
  const trigger = await screen.findByRole("button", {
    name: "Provider, model and reasoning",
  });
  await waitFor(() => expect(trigger.textContent).toContain("5.5"));
  fireEvent.click(trigger);
}

beforeEach(() => {
  vi.mocked(sdk.providers.list).mockResolvedValue(providers);
  vi.mocked(sdk.system.executionOptions).mockImplementation(
    async (args) =>
      ({
        providers,
        models: modelsByProvider[args?.providerId ?? "codex"] ?? [],
        selectedOnlyModels: [],
        permissionCeiling: "full",
        modelLoadError: null,
      }) satisfies SystemExecutionOptionsResponse,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AgentDetailView model section", () => {
  it("shows the shared model picker on the provider default model", async () => {
    renderDetail(makeAgent());
    await openPicker();
    expect(screen.getByTitle("Claude Code")).not.toBeNull();
    expect(screen.getByText(/5\.2/)).not.toBeNull();
    expect(screen.getByText("Full")).not.toBeNull();
  });

  it("saves a chosen model with the provider and reasoning", async () => {
    renderDetail(makeAgent({ reasoningLevel: "high" }));
    await openPicker();
    fireEvent.click(screen.getByText(/5\.2/));
    await waitFor(() =>
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        providerId: "codex",
        model: "gpt-5.2",
        reasoningLevel: "high",
      }),
    );
  });

  it("saves a reasoning change without pinning the default model", async () => {
    renderDetail(makeAgent());
    await openPicker();
    fireEvent.click(screen.getByText("High"));
    await waitFor(() =>
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        providerId: "codex",
        model: null,
        reasoningLevel: "high",
      }),
    );
  });

  it("switches provider to its default model", async () => {
    renderDetail(makeAgent({ model: "gpt-5.2" }));
    const trigger = await screen.findByRole("button", {
      name: "Provider, model and reasoning",
    });
    await waitFor(() => expect(trigger.textContent).toContain("5.2"));
    fireEvent.click(trigger);
    fireEvent.click(screen.getByTitle("Claude Code"));
    await waitFor(() =>
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        providerId: "claude-code",
        model: null,
        reasoningLevel: "medium",
      }),
    );
  });
});
