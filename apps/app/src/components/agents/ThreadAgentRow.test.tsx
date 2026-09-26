// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { PERSONAL_PROJECT_ID, type Agent } from "@bb/domain";
import {
  makeProviderInfo,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import {
  agentsQueryKey,
  sidebarNavigationQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { ThreadAgentRow } from "./ThreadAgentRow";

const coder: Agent = {
  id: "agent_coder0001",
  name: "Coder",
  description: "",
  providerId: "claude-code",
  model: "opus",
  reasoningLevel: "high",
  skills: [],
  mcpServers: [],
  instructions: "",
  mascot: "frog",
  color: 3,
  createdAt: 1,
  updatedAt: 1,
};

function renderRow({ withEntry }: { withEntry: boolean }) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(agentsQueryKey(), [coder]);
  queryClient.setQueryData(systemProvidersQueryKey(), [
    makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
  ]);
  if (withEntry) {
    queryClient.setQueryData(
      sidebarNavigationQueryKey(),
      makeSidebarBootstrapResponse({
        personalProject: makeProjectWithThreadsResponse({
          id: PERSONAL_PROJECT_ID,
          kind: "personal",
          name: "Personal",
          threads: [
            makeThreadListEntry({
              id: "thr_row",
              projectId: PERSONAL_PROJECT_ID,
              agentId: coder.id,
              hasPendingInteraction: true,
            }),
          ],
        }),
      }),
    );
  }
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <dl>
          <ThreadAgentRow thread={{ id: "thr_row", agentId: coder.id }} />
        </dl>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("ThreadAgentRow", () => {
  it("links the agent name and shows provider, model, and reasoning", () => {
    const { container } = renderRow({ withEntry: false });
    const link = screen.getByRole("link", { name: "Coder" });
    expect(link.getAttribute("href")).toContain("agent");
    expect(screen.getByText("Claude Code · Opus · High")).not.toBeNull();
    const mascot = container.querySelector('[data-agent-mascot="frog"]');
    expect(mascot).not.toBeNull();
    expect(container.querySelector("[data-thread-status-mascot]")).toBeNull();
  });

  it("uses the status-aware mascot when the thread list entry is known", () => {
    const { container } = renderRow({ withEntry: true });
    expect(
      container.querySelector('[data-thread-status-mascot="waiting"]'),
    ).not.toBeNull();
    expect(
      container.querySelector('[data-agent-mascot="frog"]'),
    ).not.toBeNull();
  });
});
