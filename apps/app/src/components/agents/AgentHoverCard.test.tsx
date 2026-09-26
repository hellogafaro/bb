// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { Agent } from "@bb/domain";
import {
  makeProviderInfo,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import {
  AgentHoverCardContent,
  agentHoverCardEnvironmentLabel,
  agentHoverCardThreadStatusLabel,
  type AgentHoverCardThread,
} from "./AgentHoverCard";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
  return {
    id: "agent_coder0001",
    name: "Coder",
    description: "",
    providerId: "claude-code",
    model: "claude-opus-4-1",
    reasoningLevel: "high",
    skills: ["research", "git-operations"],
    mcpServers: [],
    instructions: "",
    mascot: "frog",
    color: 3,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

const providers = [
  makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
];

afterEach(() => {
  cleanup();
});

describe("AgentHoverCardContent", () => {
  it("renders the agent summary line, scope counts, and mascot", () => {
    const { container } = render(
      <AgentHoverCardContent agent={makeAgent()} providers={providers} />,
    );
    expect(screen.getByText("Coder")).not.toBeNull();
    expect(
      screen.getByText("Claude Code · Claude Opus 4.1 · High"),
    ).not.toBeNull();
    expect(screen.getByText("2 skills · all MCPs")).not.toBeNull();
    const mascot = container.querySelector('[data-agent-mascot="frog"]');
    expect(mascot).not.toBeNull();
    expect(mascot?.classList.contains("size-4")).toBe(true);
    expect(
      container.querySelector("[data-agent-hover-card-thread]"),
    ).toBeNull();
  });

  it("renders the compact thread block when a thread is given", () => {
    const thread: AgentHoverCardThread = {
      title: "Ship hover cards",
      projectName: "BB",
      projectColor: 2,
      environmentLabel: "feature/hover-cards",
      statusLabel: "Thread working",
      lastActivityAt: Date.now() - 5 * 60_000,
    };
    const { container } = render(
      <AgentHoverCardContent
        agent={makeAgent()}
        providers={providers}
        thread={thread}
      />,
    );
    const block = container.querySelector("[data-agent-hover-card-thread]");
    expect(block).not.toBeNull();
    const text = block?.textContent ?? "";
    expect(text).toContain("Ship hover cards");
    expect(text).toContain("BB");
    expect(text).toContain("feature/hover-cards");
    expect(text).toContain("Thread working");
    expect(text).toContain("5m");
    expect(block?.querySelector('[data-project-color-dot="2"]')).not.toBeNull();
  });

  it("uses a custom mascot node when provided", () => {
    const { container } = render(
      <AgentHoverCardContent
        agent={makeAgent()}
        providers={providers}
        mascot={<span data-testid="custom-mascot" />}
      />,
    );
    expect(screen.getByTestId("custom-mascot")).not.toBeNull();
    expect(container.querySelector("[data-agent-mascot]")).toBeNull();
  });
});

describe("agentHoverCardThreadStatusLabel", () => {
  it("maps working, idle, and archived threads to labels", () => {
    expect(
      agentHoverCardThreadStatusLabel(
        makeThreadListEntry({ runtime: { displayStatus: "active" } }),
        false,
      ),
    ).toBe("Thread working");
    expect(
      agentHoverCardThreadStatusLabel(
        makeThreadListEntry({ hasPendingInteraction: true }),
        false,
      ),
    ).toBe("Thread needs user input");
    expect(
      agentHoverCardThreadStatusLabel(
        makeThreadListEntry({
          lastReadAt: 10,
          updatedAt: 5,
          latestAttentionAt: 5,
        }),
        false,
      ),
    ).toBe("Idle");
    expect(
      agentHoverCardThreadStatusLabel(
        makeThreadListEntry({ archivedAt: 1 }),
        false,
      ),
    ).toBe("Archived");
    expect(
      agentHoverCardThreadStatusLabel(
        makeThreadListEntry({
          lastReadAt: 10,
          updatedAt: 5,
          latestAttentionAt: 5,
        }),
        true,
      ),
    ).toBe("Thread has unsubmitted draft");
  });
});

describe("agentHoverCardEnvironmentLabel", () => {
  it("joins environment and branch, collapsing duplicates", () => {
    expect(
      agentHoverCardEnvironmentLabel({
        environmentName: "hover-cards",
        environmentBranchName: "feature/hover-cards",
      }),
    ).toBe("hover-cards · feature/hover-cards");
    expect(
      agentHoverCardEnvironmentLabel({
        environmentName: "main",
        environmentBranchName: "main",
      }),
    ).toBe("main");
    expect(
      agentHoverCardEnvironmentLabel({
        environmentName: null,
        environmentBranchName: "main",
      }),
    ).toBe("main");
    expect(
      agentHoverCardEnvironmentLabel({
        environmentName: null,
        environmentBranchName: null,
      }),
    ).toBeNull();
  });
});
