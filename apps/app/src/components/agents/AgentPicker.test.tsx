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
  systemExecutionOptionsQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import { AGENT_PICKER_TOOLTIP_DELAY_MS, AgentPicker } from "./AgentPicker";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_default01",
    name: "BB",
    description: "",
    providerId: "codex",
    model: null,
    reasoningLevel: "medium",
    secondaryModel: null,
    secondaryReasoningLevel: null,
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

function makeModel(model: string, displayName: string, isDefault = false) {
  return {
    id: model,
    model,
    displayName,
    description: "",
    supportedReasoningEfforts: [
      { reasoningEffort: "medium" as const, description: "" },
      { reasoningEffort: "high" as const, description: "" },
    ],
    defaultReasoningEffort: "medium" as const,
    isDefault,
  };
}

function renderPicker({
  compact = false,
  onChange,
  disabled,
  withCatalog = false,
}: {
  compact?: boolean;
  onChange?: (agentId: string) => void;
  disabled?: boolean;
  withCatalog?: boolean;
} = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  const provider = makeProviderInfo({
    id: "codex",
    displayName: "Codex",
    strings: {
      signInHint: "",
      expiredHint: "",
      installUrl: "",
      brandPrefix: "GPT-",
    },
  });
  queryClient.setQueryData(agentsQueryKey(), [makeAgent()]);
  queryClient.setQueryData(systemProvidersQueryKey(), [provider]);
  if (withCatalog) {
    queryClient.setQueryData(
      systemExecutionOptionsQueryKey({
        environmentId: null,
        hostId: null,
        providerId: "codex",
      }),
      {
        providers: [provider],
        permissionCeiling: "full",
        models: [
          makeModel("gpt-5-codex", "GPT-5 Codex (Preview)", true),
          makeModel("gpt-5", "GPT-5"),
        ],
        selectedOnlyModels: [],
        modelLoadError: null,
      },
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <CompactViewportOverrideProvider isCompactViewport={compact}>
        <AgentPicker agentId={null} onChange={onChange} disabled={disabled} />
      </CompactViewportOverrideProvider>
    </QueryClientProvider>,
  );
}

function tooltip(): HTMLElement | null {
  return document.querySelector("[data-agent-picker-tooltip]");
}

function hover(element: HTMLElement) {
  fireEvent.pointerMove(element, { pointerType: "mouse" });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("AgentPicker tooltip", () => {
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
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS - 1);
    });
    expect(tooltip()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const content = tooltip();
    expect(content).not.toBeNull();
    const label = content?.querySelector("[data-agent-model-label]");
    expect(label?.textContent).toBe("Default modelMedium");
    expect(content?.textContent).not.toContain("BB");
    expect(content?.querySelector("[data-agent-mascot]")).toBeNull();
    expect(content?.textContent).not.toContain("MCP");
  });

  it("shows the catalog default model the way the Agents model picker does", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn(), withCatalog: true });
    hover(screen.getByRole("button", { name: "Agent: BB" }));
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS);
    });
    const label = tooltip()?.querySelector("[data-agent-model-label]");
    expect(label?.textContent).toBe("5 CodexPreviewMedium");
    expect(label?.textContent).not.toContain("Default model");
  });

  it("does not open on keyboard focus", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    fireEvent.focus(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS * 2);
    });
    expect(tooltip()).toBeNull();
  });

  it("closes the tooltip when the picker opens", () => {
    vi.useFakeTimers();
    renderPicker({ onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS);
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
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS);
    });
    expect(tooltip()?.textContent).toContain("Default model");
  });

  it("skips the tooltip on compact viewports", () => {
    vi.useFakeTimers();
    renderPicker({ compact: true, onChange: vi.fn() });
    const trigger = screen.getByRole("button", { name: "Agent: BB" });
    hover(trigger);
    act(() => {
      vi.advanceTimersByTime(AGENT_PICKER_TOOLTIP_DELAY_MS * 2);
    });
    expect(tooltip()).toBeNull();
  });
});
