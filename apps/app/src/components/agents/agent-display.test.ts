import { describe, expect, it } from "vitest";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { agentOptionDetail, formatAgentModel } from "./agent-display";

describe("formatAgentModel", () => {
  it("reads model ids as product names", () => {
    expect(formatAgentModel("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(formatAgentModel("gpt-5.5")).toBe("GPT 5.5");
    expect(formatAgentModel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(formatAgentModel("o3-mini")).toBe("o3 Mini");
  });
});

describe("agentOptionDetail", () => {
  it("joins provider, model, and the provider's reasoning label", () => {
    const providers = [
      makeProviderInfo({
        id: "claude-code",
        displayName: "Claude Code",
        reasoningLevels: [{ id: "high", label: "Deep" }],
      }),
    ];
    expect(
      agentOptionDetail(
        {
          providerId: "claude-code",
          model: "claude-opus-5-5",
          reasoningLevel: "high",
        },
        providers,
      ),
    ).toBe("Claude Code · Claude Opus 5.5 · Deep");
    expect(
      agentOptionDetail(
        { providerId: "codex", model: null, reasoningLevel: "medium" },
        undefined,
      ),
    ).toBe("codex · Default model · Medium");
  });
});
