import { describe, expect, it } from "vitest";
import { formatAgentModel } from "./agent-display";

describe("formatAgentModel", () => {
  it("reads model ids as product names", () => {
    expect(formatAgentModel("claude-opus-5-5")).toBe("Claude Opus 5.5");
    expect(formatAgentModel("gpt-5.5")).toBe("GPT 5.5");
    expect(formatAgentModel("claude-sonnet-5")).toBe("Claude Sonnet 5");
    expect(formatAgentModel("o3-mini")).toBe("o3 Mini");
  });
});
