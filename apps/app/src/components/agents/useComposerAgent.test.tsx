// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, ReasoningLevel } from "@bb/domain";
import { agentsQueryKey } from "@/hooks/queries/query-keys";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  resolveComposerAgent,
  useApplyComposerAgent,
  useComposerAgent,
} from "./useComposerAgent";

function makeAgent(overrides: Partial<Agent>): Agent {
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
    mcpServers: [],
    instructions: "",
    mascot: "robot",
    color: 1,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const bb = makeAgent({});
const coder = makeAgent({
  id: "agent_coder0001",
  name: "Coder",
  providerId: "claude-code",
  model: "opus",
  reasoningLevel: "high",
});

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("resolveComposerAgent", () => {
  it("uses the selected agent, else the default", () => {
    expect(resolveComposerAgent([bb, coder], coder.id)).toBe(coder);
    expect(resolveComposerAgent([bb, coder], null)).toBe(bb);
    expect(resolveComposerAgent([bb, coder], "agent_deleted01")).toBe(bb);
    expect(resolveComposerAgent([], null)).toBeNull();
  });
});

describe("useApplyComposerAgent", () => {
  function setup(agent: Agent | null) {
    const setters = {
      setProviderModelReasoning: vi.fn(),
      setReasoningLevel: vi.fn(),
      setSelectedProviderId: vi.fn(),
    };
    const selection: {
      providerId: string;
      model: string;
      reasoningLevel: ReasoningLevel;
    } = { providerId: "codex", model: "gpt-5", reasoningLevel: "medium" };
    const hook = renderHook(
      ({ current }: { current: Agent | null }) =>
        useApplyComposerAgent({ agent: current, selection, ...setters }),
      { initialProps: { current: agent } },
    );
    return { hook, setters };
  }

  it("applies an agent's provider, model, and reasoning once", () => {
    const { hook, setters } = setup(coder);
    expect(setters.setProviderModelReasoning).toHaveBeenCalledWith({
      providerId: "claude-code",
      model: "opus",
      reasoningLevel: "high",
    });
    hook.rerender({ current: { ...coder } });
    expect(setters.setProviderModelReasoning).toHaveBeenCalledTimes(1);
  });

  it("switches only the provider and reasoning for a provider-default model", () => {
    const { setters } = setup(
      makeAgent({ providerId: "claude-code", reasoningLevel: "low" }),
    );
    expect(setters.setSelectedProviderId).toHaveBeenCalledWith("claude-code");
    expect(setters.setReasoningLevel).toHaveBeenCalledWith("low");
    expect(setters.setProviderModelReasoning).not.toHaveBeenCalled();
  });

  it("does nothing without an agent", () => {
    const { setters } = setup(null);
    expect(setters.setProviderModelReasoning).not.toHaveBeenCalled();
    expect(setters.setSelectedProviderId).not.toHaveBeenCalled();
  });
});

describe("useComposerAgent", () => {
  function setup(agents: Agent[] = [bb, coder]) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { enabled: false, retry: false } },
    });
    queryClient.setQueryData(agentsQueryKey(), agents);
    const store = createStore();
    const hook = renderHook(
      ({ projectId }: { projectId: string }) => {
        void projectId;
        return useComposerAgent();
      },
      {
        initialProps: { projectId: "proj_a" },
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            <Provider store={store}>{children}</Provider>
          </QueryClientProvider>
        ),
      },
    );
    return { hook, store, queryClient };
  }

  it("defaults to the first agent when nothing was picked yet", () => {
    const { hook } = setup();
    expect(hook.result.current.selected).toBe(bb);
  });

  it("keeps the user's picked agent selected across a project change", () => {
    const { hook } = setup();
    act(() => hook.result.current.select(coder.id));
    expect(hook.result.current.selected).toBe(coder);

    act(() => hook.rerender({ projectId: "proj_b" }));
    expect(hook.result.current.selected).toBe(coder);

    act(() => hook.rerender({ projectId: "proj_c" }));
    expect(hook.result.current.selected).toBe(coder);
  });

  it("falls back to the deterministic default agent only once the picked agent is actually unavailable", async () => {
    const { hook, queryClient } = setup();
    act(() => hook.result.current.select(coder.id));
    expect(hook.result.current.selected).toBe(coder);

    act(() => hook.rerender({ projectId: "proj_b" }));
    expect(hook.result.current.selected).toBe(coder);

    act(() => queryClient.setQueryData(agentsQueryKey(), [bb]));
    await vi.waitFor(() => expect(hook.result.current.selected).toBe(bb));
  });
});
