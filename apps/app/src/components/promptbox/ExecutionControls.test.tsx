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
import type { AgentResponse } from "@bb/server-contract";
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

function makeAgent(overrides: Partial<AgentResponse>): AgentResponse {
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
    mascot: "robot",
    color: 1,
    createdAt: 1,
    updatedAt: 1,
    homePath: "/home/me/.bb/agents/coder",
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
      reasoningLevel: "high",
      mascot: "frog",
      color: 4,
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

    const trigger = await screen.findByRole("button", { name: "Agent: BB" });
    expect(trigger.textContent).toBe("BB");
    expect(trigger.querySelector('[data-agent-mascot="robot"]')).not.toBeNull();
    expect(trigger.querySelector("[data-agent-mascot-active]")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Provider, model and reasoning" }),
    ).toBeNull();
    fireEvent.click(trigger);

    const coder = await screen.findByRole("option", { name: /Coder/ });
    expect(coder.textContent).toContain("Claude Code · Opus · High");
    expect(coder.querySelector('[data-agent-mascot="frog"]')).not.toBeNull();
    expect(coder.querySelector("img")).not.toBeNull();
    const current = screen.getByRole("option", { name: /BB/ });
    expect(current.textContent).toContain("Codex · Default model · Medium");
    expect(
      screen.queryByRole("combobox", { name: "Search agents" }),
    ).toBeNull();
    fireEvent.click(coder);
    expect(onChange).toHaveBeenCalledWith("agent_coder0001");
    await waitFor(() =>
      expect(screen.queryByRole("option", { name: /Coder/ })).toBeNull(),
    );
  });

  it("shows a thread's fixed agent as disabled without a chevron", async () => {
    stubAgents();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      agent: { agentId: "agent_coder0001" },
    });
    const trigger = await screen.findByRole("button", { name: "Agent: Coder" });
    expect(trigger.querySelector("[title]")).toBeNull();
    expect(trigger.textContent).toBe("Coder");
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(trigger.className).toContain("disabled:opacity-100");
    expect(trigger.querySelectorAll("svg")).toHaveLength(1);
    expect(trigger.querySelector('[data-agent-mascot="frog"]')).not.toBeNull();
  });

  it("animates the trigger mascot while the thread has a turn in flight", async () => {
    stubAgents();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      agent: { agentId: "agent_coder0001", active: true },
    });
    const trigger = await screen.findByRole("button", { name: "Agent: Coder" });
    const mascot = trigger.querySelector("[data-agent-mascot-active]");
    expect(mascot?.classList.contains("mascot-active")).toBe(true);
  });

  it("falls back to the default agent when the thread's agent is gone", async () => {
    stubAgents();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      agent: { agentId: "agent_deleted01" },
    });
    const trigger = await screen.findByRole("button", { name: "Agent: BB" });
    expect(trigger.textContent).toBe("BB");
  });

  it("searches many agents and picks one with the keyboard", async () => {
    const names = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot"];
    vi.spyOn(sdk.agents, "list").mockResolvedValue(
      names.map((name, index) =>
        makeAgent({
          id: `agent_${name.toLowerCase()}`,
          name,
          createdAt: index,
        }),
      ),
    );
    vi.spyOn(sdk.providers, "list").mockResolvedValue([
      makeProviderInfo({ id: "codex", displayName: "Codex" }),
    ]);
    const onChange = vi.fn();
    renderExecutionControls({
      ...makeExecutionControlsProps(vi.fn()),
      agent: { agentId: null, onChange },
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Agent: Alpha" }),
    );
    const search = await screen.findByRole("combobox", {
      name: "Search agents",
    });
    fireEvent.change(search, { target: { value: "ech" } });
    await waitFor(() =>
      expect(
        screen.getAllByRole("option").map((option) => option.textContent),
      ).toEqual([expect.stringContaining("Echo")]),
    );
    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(search.getAttribute("aria-activedescendant")).toBe(
      screen.getByRole("option", { name: /Echo/ }).id,
    );
    fireEvent.keyDown(search, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("agent_echo");
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
