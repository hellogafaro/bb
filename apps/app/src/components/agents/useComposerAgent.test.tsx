// @vitest-environment jsdom

import { cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, ReasoningLevel } from "@bb/domain";
import { resolveComposerAgent, useApplyComposerAgent } from "./useComposerAgent";

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
});

describe("resolveComposerAgent", () => {
  it("uses the remembered agent for the project, else the default", () => {
    expect(resolveComposerAgent([bb, coder], coder.id)).toBe(coder);
    expect(resolveComposerAgent([bb, coder], undefined)).toBe(bb);
    expect(resolveComposerAgent([bb, coder], "agent_deleted01")).toBe(bb);
    expect(resolveComposerAgent([], undefined)).toBeNull();
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
