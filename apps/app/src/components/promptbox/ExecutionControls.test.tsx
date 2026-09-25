// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import type { Agent } from "@bb/domain";
import { sdk } from "@/lib/sdk";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";

function makeExecutionControlsProps(
  providerOnChange?: (value: string) => void,
): ExecutionControlsProps {
  return {
    provider: {
      options: [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude Code" },
      ],
      selectedId: "codex",
      onChange: providerOnChange,
      hasMultiple: true,
    },
    model: {
      active: null,
      selected: "gpt-5",
      options: [{ value: "gpt-5", label: "GPT-5" }],
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      loadError: null,
      onChange: vi.fn(),
    },
    reasoning: {
      value: "medium",
      options: [{ value: "medium", label: "Medium" }],
      onChange: vi.fn(),
    },
  };
}

function renderExecutionControls(props: ExecutionControlsProps) {
  const { wrapper } = createQueryClientTestHarness();
  return render(<ExecutionControls {...props} />, { wrapper });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function makeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: "agent_default01",
    name: "BB",
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

function stubAgents() {
  vi.spyOn(sdk.agents, "list").mockResolvedValue([
    makeAgent({}),
    makeAgent({
      id: "agent_coder0001",
      name: "Coder",
      providerId: "claude-code",
      model: "opus",
    }),
  ]);
  vi.spyOn(sdk.providers, "list").mockResolvedValue([
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
    makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
  ]);
}

describe("ExecutionControls agent picker", () => {
  it("replaces the model picker with an agent picker and switches agents", async () => {
    stubAgents();
    const onChange = vi.fn();
    renderExecutionControls({
      ...makeExecutionControlsProps(vi.fn()),
      agent: { agentId: null, onChange },
    });

    const trigger = await screen.findByRole("button", { name: "Agent" });
    await waitFor(() => expect(trigger.textContent).toBe("BB"));
    expect(
      screen.queryByRole("button", { name: "Provider, model and reasoning" }),
    ).toBeNull();
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    expect(await screen.findByText("Claude Code · Opus")).toBeTruthy();
    fireEvent.click(screen.getByRole("menuitem", { name: /Coder/ }));
    expect(onChange).toHaveBeenCalledWith("agent_coder0001");
  });

  it("shows a thread's fixed agent as disabled", async () => {
    stubAgents();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      agent: { agentId: "agent_coder0001" },
    });
    const trigger = await screen.findByRole("button", { name: "Agent" });
    await waitFor(() =>
      expect(trigger.querySelector("[title]")?.getAttribute("title")).toBe(
        "Coder · Claude Code · Opus",
      ),
    );
    expect(trigger.textContent).toBe("Coder");
    expect(trigger.hasAttribute("disabled")).toBe(true);
  });

  it("falls back to the default agent when the thread's agent is gone", async () => {
    stubAgents();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      agent: { agentId: "agent_deleted01" },
    });
    const trigger = await screen.findByRole("button", { name: "Agent" });
    await waitFor(() => expect(trigger.textContent).toBe("BB"));
  });
});

describe("ExecutionControls", () => {
  it("hides provider tabs when the provider is locked", () => {
    renderExecutionControls(makeExecutionControlsProps());

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );

    expect(screen.queryByText("Model")).not.toBeNull();
    expect(screen.queryByTitle("Claude Code")).toBeNull();
  });

  it("shows provider tabs when provider changes are allowed", () => {
    renderExecutionControls(makeExecutionControlsProps(vi.fn()));

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );

    expect(screen.queryByTitle("Claude Code")).not.toBeNull();
  });

  it("keeps showing the known model when model options fail to load", () => {
    const props = makeExecutionControlsProps();
    renderExecutionControls({
      ...props,
      model: {
        ...props.model,
        active: { model: "o4-mini" },
        options: [],
        loadFailed: true,
        loadError: { providerId: "codex", code: "failed" },
      },
    });

    const trigger = screen.getByRole("button", {
      name: "Provider, model and reasoning",
    });

    expect(trigger.textContent).toContain("o4-mini");
    expect(trigger.textContent).not.toContain("Failed to load models");
  });

  it("maps disabled fast mode to the explicit default service tier", () => {
    const onServiceTierChange = vi.fn();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      serviceTier: {
        value: "fast",
        onChange: onServiceTierChange,
        supported: true,
      },
    });

    fireEvent.click(
      screen.getByRole("button", {
        name: "Provider, model and reasoning",
      }),
    );
    fireEvent.click(screen.getByRole("switch", { name: "Fast mode" }));

    expect(onServiceTierChange).toHaveBeenCalledWith("default");
  });
});
