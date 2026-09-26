import { describe, expect, it } from "vitest";
import { agentModelForThread } from "./thread-agent.js";

const agent = {
  model: "gpt-5.5",
  reasoningLevel: "high" as const,
  secondaryModel: "gpt-5.2",
  secondaryReasoningLevel: "low" as const,
};

describe("agentModelForThread", () => {
  it("uses the primary model for root threads", () => {
    expect(agentModelForThread(agent, false)).toEqual({
      model: "gpt-5.5",
      reasoningLevel: "high",
    });
  });

  it("uses the secondary model and reasoning for child threads", () => {
    expect(agentModelForThread(agent, true)).toEqual({
      model: "gpt-5.2",
      reasoningLevel: "low",
    });
  });

  it("falls back to primary reasoning when only the secondary model is set", () => {
    expect(
      agentModelForThread({ ...agent, secondaryReasoningLevel: null }, true),
    ).toEqual({ model: "gpt-5.2", reasoningLevel: "high" });
  });

  it("keeps the primary model for child threads without a secondary model", () => {
    expect(
      agentModelForThread(
        { ...agent, secondaryModel: null, secondaryReasoningLevel: "low" },
        true,
      ),
    ).toEqual({ model: "gpt-5.5", reasoningLevel: "high" });
  });
});
