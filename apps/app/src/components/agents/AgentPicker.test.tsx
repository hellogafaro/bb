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

function hoverCard(): HTMLElement | null {
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
  it("shows the agent summary after the open delay on pointer hover", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    expect(trigger.querySelector("[title]")).toBeNull();

    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS - 1);
    });
    expect(hoverCard()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const card = hoverCard();
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain("BB");
    expect(card?.textContent).toContain("Codex · Default model · Medium");
    expect(card?.textContent).toContain("all skills · 1 MCP");

    fireEvent.pointerLeave(trigger, { pointerType: "mouse" });
    fireEvent.mouseLeave(trigger);
    act(() => {
      vi.advanceTimersByTime(0);
    });
    expect(hoverCard()).toBeNull();
  });

  it("does not open on keyboard focus", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(hoverCard()).toBeNull();
  });

  it("closes the hover card when the picker opens", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(hoverCard()).not.toBeNull();

    fireEvent.click(trigger);
    expect(hoverCard()).toBeNull();
    expect(screen.getByRole("listbox", { name: "Agents" })).not.toBeNull();
  });

  it("shows the hover card for a read-only trigger", () => {
    vi.useFakeTimers();
    renderPicker();
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    expect(trigger.hasAttribute("disabled")).toBe(true);
    hover(trigger.parentElement as HTMLElement);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(hoverCard()?.textContent).toContain(
      "Codex · Default model · Medium",
    );
  });

  it("skips the hover card on compact viewports", () => {
    vi.useFakeTimers();
    renderPicker({ compact: true, onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(hoverCard()).toBeNull();
  });
});
