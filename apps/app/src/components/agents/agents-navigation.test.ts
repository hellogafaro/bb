import { describe, expect, it } from "vitest";
import {
  getAgentDetailRoutePath,
  getAgentsRoutePath,
  isRoutePath,
} from "@/lib/route-paths";
import { resolveAgentsRoute } from "./agents-navigation";

describe("agents navigation", () => {
  it("builds and resolves agent routes under settings", () => {
    expect(getAgentsRoutePath()).toBe("/settings/agents");
    expect(getAgentDetailRoutePath("Code Reviewer")).toBe(
      "/settings/agents/Code%20Reviewer",
    );
    expect(resolveAgentsRoute("/settings/agents")).toEqual({ agentRef: null });
    expect(resolveAgentsRoute("/settings/agents/Code%20Reviewer")).toEqual({
      agentRef: "Code Reviewer",
    });
    expect(resolveAgentsRoute("/settings/agents/a/b")).toBeNull();
    expect(resolveAgentsRoute("/agents")).toBeNull();
    expect(resolveAgentsRoute("/settings/skills")).toBeNull();
    for (const path of [
      "/settings/agents",
      "/settings/agents/agent_x",
      "/agents",
      "/agents/agent_x",
    ]) {
      expect(isRoutePath({ path })).toBe(true);
    }
  });
});
