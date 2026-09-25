// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import type { Agent } from "@bb/domain";
import type { ThreadListIndicatorState } from "@bb/client-core";
import { afterEach, describe, expect, it } from "vitest";
import { ThreadStatusMascot } from "./ThreadStatusMascot";

afterEach(cleanup);

const agent: Agent = {
  id: "agent_default01",
  name: "BB",
  description: "",
  providerId: "codex",
  model: null,
  reasoningLevel: "medium",
  skills: [],
  mcpServers: [],
  instructions: "",
  mascot: "ghost",
  color: 3,
  createdAt: 1,
  updatedAt: 1,
};

const IDLE: ThreadListIndicatorState = {
  hasPendingInteraction: false,
  hasUnsubmittedDraft: false,
  hasUnreadError: false,
  hasUnreadSuccess: false,
  isBackgroundAgentActive: false,
  isBackgroundCommandActive: false,
  isGoalActive: false,
  isPlanModeActive: false,
  isRuntimeActive: false,
  isWorkflowActive: false,
  queuedWork: "none",
};

function tone(container: HTMLElement): string | null {
  return (
    container
      .querySelector("[data-thread-status-mascot]")
      ?.getAttribute("data-thread-status-mascot") ?? null
  );
}

describe("ThreadStatusMascot", () => {
  it.each<[Partial<ThreadListIndicatorState>, string]>([
    [{}, "idle"],
    [{ isRuntimeActive: true }, "working"],
    [{ isBackgroundCommandActive: true }, "working"],
    [{ isWorkflowActive: true }, "working"],
    [{ hasUnreadError: true }, "error"],
    [{ queuedWork: "failed" }, "error"],
    [{ hasPendingInteraction: true }, "waiting"],
    [{ hasUnsubmittedDraft: true }, "idle"],
    [{ hasUnreadSuccess: true }, "idle"],
  ])("maps %o to %s", (state, expected) => {
    const { container } = render(
      <ThreadStatusMascot {...IDLE} {...state} agent={agent} />,
    );
    expect(tone(container)).toBe(expected);
  });

  it("stays hidden from assistive tech when idle and labels active states", () => {
    const { container } = render(
      <ThreadStatusMascot {...IDLE} agent={agent} />,
    );
    expect(
      container
        .querySelector("[data-thread-status-mascot]")
        ?.getAttribute("aria-hidden"),
    ).toBe("true");
    cleanup();
    render(<ThreadStatusMascot {...IDLE} isRuntimeActive agent={agent} />);
    expect(
      screen.getByRole("img").getAttribute("data-thread-status-mascot"),
    ).toBe("working");
  });

  it("shrinks for compact rows and labels archived threads", () => {
    const { container } = render(
      <ThreadStatusMascot {...IDLE} agent={agent} archived size="compact" />,
    );
    const status = screen.getByLabelText("Archived thread");
    expect(status.classList.contains("size-3.5")).toBe(true);
    expect(
      container
        .querySelector("[data-agent-mascot]")
        ?.classList.contains("size-3"),
    ).toBe(true);
  });

  it("keeps the status glyph without an agent or while a plugin status shows", () => {
    const { container } = render(
      <ThreadStatusMascot {...IDLE} hasUnreadError agent={null} />,
    );
    expect(container.querySelector("[data-thread-status-mascot]")).toBeNull();
    expect(
      container.querySelector('[data-status-ring="failed"]'),
    ).not.toBeNull();
    cleanup();
    const plugin = render(
      <ThreadStatusMascot
        {...IDLE}
        agent={agent}
        pluginStatus={{ tone: "success", icon: "check", label: "Deployed" }}
      />,
    );
    expect(
      plugin.container.querySelector("[data-thread-status-mascot]"),
    ).toBeNull();
    expect(screen.getByLabelText("Deployed")).not.toBeNull();
  });
});
