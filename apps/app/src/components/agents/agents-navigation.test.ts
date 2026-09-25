import { describe, expect, it } from "vitest";
import {
  getAgentDetailRoutePath,
  getAgentsRoutePath,
  isRoutePath,
} from "@/lib/route-paths";
import {
  isAgentsRoutePath,
  resolveAgentsHeaderMeta,
  resolveAgentsRoute,
} from "./agents-navigation";

describe("agents navigation", () => {
  it("builds and resolves agent routes", () => {
    expect(getAgentsRoutePath()).toBe("/agents");
    expect(getAgentDetailRoutePath("Code Reviewer")).toBe(
      "/agents/Code%20Reviewer",
    );
    expect(resolveAgentsRoute("/agents")).toEqual({ agentRef: null });
    expect(resolveAgentsRoute("/agents/Code%20Reviewer")).toEqual({
      agentRef: "Code Reviewer",
    });
    expect(resolveAgentsRoute("/agents/a/b")).toBeNull();
    expect(resolveAgentsRoute("/customize")).toBeNull();
    expect(isAgentsRoutePath("/agents/agent_x")).toBe(true);
    expect(isRoutePath({ path: "/agents" })).toBe(true);
    expect(isRoutePath({ path: "/agents/agent_x" })).toBe(true);
  });

  it("titles the list Agents and the detail Agents › name", () => {
    expect(resolveAgentsHeaderMeta("/agents")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Agents" }],
    });
    expect(resolveAgentsHeaderMeta("/agents/agent_x", "Coder")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Agents", to: "/agents" }, { label: "Coder" }],
    });
    expect(resolveAgentsHeaderMeta("/agents/agent_x")).toEqual({
      kind: "breadcrumbs",
      breadcrumbs: [{ label: "Agents", to: "/agents" }, { label: "agent_x" }],
    });
    expect(resolveAgentsHeaderMeta("/customize")).toBeNull();
  });
});
