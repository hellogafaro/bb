// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import {
  agentsQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import {
  AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS,
  AgentPicker,
} from "./AgentPicker";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_default01",
    name: "BB",
    description: "",
    providerId: "codex",
    model: null,
    reasoningLevel: "medium",
    skills: [],
    mcpServers: ["notion"],
    instructions: "",
    mascot: "robot",
    color: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function renderPicker({
  compact = false,
  onChange,
  disabled,
}: {
  compact?: boolean;
  onChange?: (agentId: string) => void;
  disabled?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(agentsQueryKey(), [makeAgent()]);
  queryClient.setQueryData(systemProvidersQueryKey(), [
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
  ]);
  return render(
    <QueryClientProvider client={queryClient}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <AgentPicker agentId={null} onChange={onChange} disabled={disabled} />
      </CompactViewportOverrideProvider>
    </QueryClientProvider>,
  );
}

function tooltip(): HTMLElement | null {
  return document.querySelector("[data-agent-picker-hover-card]");
}

function hover(element: HTMLElement) {
  fireEvent.pointerEnter(element, { pointerType: "mouse" });
  fireEvent.mouseEnter(element);
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentPicker hover card", () => {
  it("shows one model line after the delay on pointer hover", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    expect(trigger.querySelector("[title]")).toBeNull();
    expect(
      trigger
        .querySelector("[data-agent-mascot]")
        ?.classList.contains("size-4"),
    ).toBe(true);

    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS - 1);
    });
    expect(tooltip()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const content = tooltip();
    expect(content).not.toBeNull();
    const footer = content?.querySelector("[data-agent-model-footer]");
    expect(footer?.textContent).toBe("Default modelMedium");
    expect(content?.textContent).not.toContain("BB");
    expect(content?.querySelector("[data-agent-mascot]")).toBeNull();
    expect(content?.textContent).not.toContain("MCP");
  });

  it("does not open on keyboard focus", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(tooltip()).toBeNull();
  });

  it("closes the tooltip when the picker opens", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(tooltip()).not.toBeNull();

    fireEvent.click(trigger);
    expect(tooltip()).toBeNull();
    expect(screen.getByRole("listbox", { name: "Agents" })).not.toBeNull();
  });

  it("keeps hover and the tooltip on a read-only trigger", () => {
    vi.useFakeTimers();
    renderPicker();
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    expect(trigger.className).toContain("disabled:pointer-events-auto");
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(tooltip()?.textContent).toContain("Default model");
  });

  it("skips the tooltip on compact viewports", () => {
    vi.useFakeTimers();
    renderPicker({ compact: true, onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(tooltip()).toBeNull();
  });
});
