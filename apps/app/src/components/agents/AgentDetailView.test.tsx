// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { AvailableModel } from "@bb/domain";
import type { AgentResponse } from "@bb/server-contract";
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
    system: { config: vi.fn(), executionOptions: vi.fn() },
  },
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandContext: () => undefined,
  useAppCommandHandler: () => undefined,
  useIndexedAppCommandHandlers: () => undefined,
  useAppCommandShortcut: () => null,
  useIsAppCommandModifierHeld: () => false,
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("@/components/ui/app-toast", () => ({ appToast: toast }));

vi.mock("@/hooks/queries/mcp-queries", () => ({
  useMcpServers: () => ({ data: [] }),
}));

vi.mock("@/hooks/queries/skills-queries", () => ({
  useProjectSkills: () => ({ data: { skills: [] } }),
}));

function makeAgent(overrides: Partial<AgentResponse> = {}): AgentResponse {
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
    mascot: "robot",
    color: 1,
    createdAt: 1,
    updatedAt: 1,
    homePath: "/home/me/.bb/agents/coder",
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

function renderDetail(agent: AgentResponse) {
  let current = agent;
  vi.mocked(sdk.agents.list).mockImplementation(async () => [current]);
  vi.mocked(sdk.agents.update).mockImplementation(
    async ({ agent: _ref, ...update }) => {
      current = { ...current, ...update } as AgentResponse;
      return current;
    },
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

describe("AgentDetailView appearance", () => {
  it("shows the mascot in the header and saves a picked mascot and color", async () => {
    renderDetail(makeAgent({ mascot: "cat", color: 3 }));
    const heading = await screen.findByRole("heading", { name: "Coder" });
    expect(
      heading.parentElement?.querySelector('[data-agent-mascot="cat"]'),
    ).not.toBeNull();

    const mascots = screen.getByRole("radiogroup", { name: "Icon" });
    const options = Array.from(mascots.querySelectorAll('[role="radio"]'));
    expect(options).toHaveLength(10);
    expect(
      screen.getByRole("radio", { name: "cat" }).getAttribute("aria-checked"),
    ).toBe("true");
    fireEvent.click(screen.getByRole("radio", { name: "rocket" }));
    await waitFor(() =>
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        mascot: "rocket",
      }),
    );

    const colors = screen.getByRole("radiogroup", { name: "Color" });
    expect(colors.querySelectorAll('[role="radio"]')).toHaveLength(8);
    fireEvent.click(screen.getByRole("radio", { name: "Color 7" }));
    await waitFor(() =>
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        color: 7,
      }),
    );
  });
});

describe("AgentDetailView header and sections", () => {
  it("shows a framed avatar without a subtitle, permissions, or files", async () => {
    renderDetail(makeAgent({ color: 3 }));
    const heading = await screen.findByRole("heading", { name: "Coder" });
    const frame = heading.parentElement?.querySelector("span.size-8");
    expect(frame?.querySelector('[data-agent-mascot="robot"]')).not.toBeNull();
    expect(frame?.getAttribute("style")).toContain("--agent-color-3");
    expect(screen.queryByText(/permissions/i)).toBeNull();
    expect(screen.queryByText("Permissions")).toBeNull();
    expect(screen.queryByRole("heading", { name: "Files" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
    expect(screen.getByRole("radiogroup", { name: "Icon" })).toBeTruthy();
    expect(screen.getByRole("radiogroup", { name: "Color" })).toBeTruthy();
  });

  it("autosaves the profile after typing stops and toasts once", async () => {
    vi.useFakeTimers();
    try {
      renderDetail(makeAgent());
      await vi.waitFor(() => screen.getByRole("heading", { name: "Coder" }));
      const name = screen.getByDisplayValue("Coder");
      fireEvent.change(name, { target: { value: "Cod" } });
      fireEvent.change(name, { target: { value: "Code" } });
      fireEvent.change(name, { target: { value: "Code Reviewer" } });
      await vi.advanceTimersByTimeAsync(400);
      expect(sdk.agents.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(300);
      expect(sdk.agents.update).toHaveBeenCalledTimes(1);
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        name: "Code Reviewer",
      });
      await vi.waitFor(() =>
        expect(toast.success).toHaveBeenCalledWith("Agent updated"),
      );
      expect(toast.success).toHaveBeenCalledTimes(1);
      expect(screen.getByDisplayValue("Code Reviewer")).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not save an empty name", async () => {
    vi.useFakeTimers();
    try {
      renderDetail(makeAgent());
      await vi.waitFor(() => screen.getByRole("heading", { name: "Coder" }));
      fireEvent.change(screen.getByDisplayValue("Coder"), {
        target: { value: "   " },
      });
      await vi.advanceTimersByTimeAsync(1000);
      expect(sdk.agents.update).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("offers no All switch and shows the empty state without skills", async () => {
    renderDetail(makeAgent());
    await screen.findByRole("heading", { name: "Coder" });
    expect(screen.getByText("No skills yet.")).toBeTruthy();
    expect(screen.queryByRole("switch")).toBeNull();
    expect(screen.queryByRole("button", { name: "Select all" })).toBeNull();
  });

  it("coalesces edits across sections into one debounced save", async () => {
    vi.useFakeTimers();
    try {
      renderDetail(makeAgent({ instructions: "Old" }));
      await vi.waitFor(() => screen.getByRole("heading", { name: "Coder" }));
      fireEvent.change(screen.getByDisplayValue("Coder"), {
        target: { value: "Reviewer" },
      });
      fireEvent.click(screen.getByRole("radio", { name: "Color 4" }));
      fireEvent.change(screen.getByRole("textbox", { name: "Instructions" }), {
        target: { value: "New rules" },
      });
      await vi.advanceTimersByTimeAsync(500);
      expect(sdk.agents.update).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(sdk.agents.update).toHaveBeenCalledTimes(1);
      expect(sdk.agents.update).toHaveBeenCalledWith({
        agent: "agent_coder0001",
        name: "Reviewer",
        color: 4,
        instructions: "New rules",
      });
      await vi.waitFor(() => expect(toast.success).toHaveBeenCalledTimes(1));
    } finally {
      vi.useRealTimers();
    }
  });
});
