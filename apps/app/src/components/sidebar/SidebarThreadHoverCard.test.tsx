// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Agent, ThreadListEntry } from "@bb/domain";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import {
  makeProviderInfo,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { ThreadTitleMentionResourcesProvider } from "@/components/thread/ThreadTitleMentions";
import {
  agentsQueryKey,
  systemProvidersQueryKey,
} from "@/hooks/queries/query-keys";
import { SidebarThreadHoverCard } from "./SidebarThreadHoverCard";
import {
  SIDEBAR_THREAD_HOVER_CARD_CLOSE_DELAY_MS,
  SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS,
} from "./sidebarThreadHoverCard";

function makeAgent(overrides: Partial<Agent> = {}): Agent {
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

const bb = makeAgent();
const coder = makeAgent({
  id: "agent_coder0001",
  name: "Coder",
  providerId: "claude-code",
  model: "opus",
  reasoningLevel: "high",
  mascot: "frog",
});

const threadA = makeThreadListEntry({
  id: "thr_a",
  title: "Alpha thread",
  titleFallback: null,
  projectId: "proj_web",
  agentId: bb.id,
});
const threadB = makeThreadListEntry({
  id: "thr_b",
  title: "Beta thread",
  titleFallback: null,
  projectId: "proj_web",
  agentId: coder.id,
  hasPendingInteraction: true,
  environmentName: "beta",
  environmentBranchName: "feature/beta",
});

const threadsById = new Map<string, ThreadListEntry>([
  [threadA.id, threadA],
  [threadB.id, threadB],
]);

function rowRect(top: number): DOMRect {
  return {
    top,
    left: 8,
    right: 248,
    bottom: top + 36,
    width: 240,
    height: 36,
    x: 8,
    y: top,
    toJSON: () => ({}),
  };
}

function ListRows({ onContainer }: { onContainer: (el: HTMLElement) => void }) {
  return (
    <div
      ref={(el) => {
        if (el) onContainer(el);
      }}
      data-testid="list"
    >
      <div data-sidebar-rename-row="" data-testid="header">
        <span>Pinned</span>
      </div>
      <div data-sidebar-rename-row="" data-testid="row-a">
        <a data-sidebar-thread-id="thr_a" data-testid="link-a" />
      </div>
      <div data-sidebar-rename-row="" data-testid="row-b">
        <a data-sidebar-thread-id="thr_b" data-testid="link-b" />
      </div>
    </div>
  );
}

function Harness({
  compact = false,
  children,
}: {
  compact?: boolean;
  children?: ReactNode;
}) {
  const [container, setContainer] = useState<HTMLElement | null>(null);
  return (
    <CompactViewportOverrideProvider isCompactViewport={compact}>
      <ThreadTitleMentionResourcesProvider
        sectionNamesById={new Map()}
        projectNamesById={new Map([["proj_web", "Web App"]])}
        threadById={new Map()}
      >
        <ListRows onContainer={setContainer} />
        <SidebarThreadHoverCard
          container={container}
          threadsById={threadsById}
        />
        {children}
      </ThreadTitleMentionResourcesProvider>
    </CompactViewportOverrideProvider>
  );
}

function renderHarness(compact = false, children?: ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { enabled: false, retry: false } },
  });
  queryClient.setQueryData(agentsQueryKey(), [bb, coder]);
  queryClient.setQueryData(systemProvidersQueryKey(), [
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
    makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
  ]);
  const result = render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/"]}>
        <Harness compact={compact}>{children}</Harness>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const rowA = result.getByTestId("row-a");
  const rowB = result.getByTestId("row-b");
  rowA.getBoundingClientRect = () => rowRect(100);
  rowB.getBoundingClientRect = () => rowRect(140);
  return result;
}

function card(): HTMLElement | null {
  return document.querySelector("[data-sidebar-thread-hover-card]");
}

function pointerOver(target: HTMLElement) {
  fireEvent.pointerOver(target, { pointerType: "mouse", bubbles: true });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("SidebarThreadHoverCard", () => {
  it("opens after the delay and swaps rows without remounting", () => {
    vi.useFakeTimers();
    const view = renderHarness();
    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS - 1);
    });
    expect(card()).toBeNull();
    act(() => {
      vi.advanceTimersByTime(1);
    });
    const first = card();
    expect(first).not.toBeNull();
    expect(first?.textContent).not.toContain("BB");
    expect(first?.textContent).toContain("Alpha thread");
    expect(first?.textContent).toContain("Web App");
    expect(first?.textContent).toContain("Default model");
    expect(first?.textContent).toContain("Medium");
    expect(first?.querySelector("[data-project-color-dot]")).not.toBeNull();
    expect(first?.querySelector("[data-agent-mascot]")).toBeNull();
    expect(first?.style.transform).toBe("translate3d(260px, 100px, 0)");
    expect(first?.style.transition).toBe("transform 120ms ease-out");
    expect(first?.style.zIndex).toBe("50");

    act(() => {
      pointerOver(view.getByTestId("link-b"));
    });
    const second = card();
    expect(second).toBe(first);
    expect(second?.textContent).not.toContain("Coder");
    expect(second?.textContent).toContain("Beta thread");
    expect(second?.textContent).toContain("feature/beta");
    expect(second?.textContent).toContain("Opus");
    expect(second?.textContent).toContain("High");
    expect(second?.textContent).not.toContain("Thread needs user input");
    expect(second?.style.transform).toBe("translate3d(260px, 140px, 0)");
  });

  it("hides after the close delay when leaving the rows and instantly on pointerdown", () => {
    vi.useFakeTimers();
    const view = renderHarness();
    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(card()).not.toBeNull();

    pointerOver(view.getByTestId("header"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_CLOSE_DELAY_MS - 1);
    });
    expect(card()).not.toBeNull();
    act(() => {
      pointerOver(view.getByTestId("link-a"));
    });
    expect(card()?.textContent).toContain("Alpha thread");

    fireEvent.pointerLeave(view.getByTestId("list"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_CLOSE_DELAY_MS);
    });
    expect(card()).toBeNull();

    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(card()).not.toBeNull();
    act(() => {
      fireEvent.pointerDown(view.getByTestId("link-a"));
    });
    expect(card()).toBeNull();

    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(card()).toBeNull();

    pointerOver(view.getByTestId("link-b"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(card()?.textContent).toContain("Beta thread");
  });

  it("hides on scroll and on route navigation", () => {
    vi.useFakeTimers();
    const navigateRef: { current: ((to: string) => void) | null } = {
      current: null,
    };
    function Navigator() {
      const navigate = useNavigate();
      useEffect(() => {
        navigateRef.current = (to) => void navigate(to);
      }, [navigate]);
      return null;
    }
    const view = renderHarness(false, <Navigator />);
    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(card()).not.toBeNull();
    act(() => {
      fireEvent.scroll(view.getByTestId("list"));
    });
    expect(card()).toBeNull();
    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(card()).toBeNull();
    fireEvent.pointerLeave(view.getByTestId("list"));

    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS);
    });
    expect(card()).not.toBeNull();
    act(() => {
      navigateRef.current?.("/threads/thr_b");
    });
    expect(card()).toBeNull();
  });

  it("does nothing on compact viewports", () => {
    vi.useFakeTimers();
    const view = renderHarness(true);
    pointerOver(view.getByTestId("link-a"));
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(card()).toBeNull();
  });

  it("ignores non-mouse pointers", () => {
    vi.useFakeTimers();
    const view = renderHarness();
    fireEvent.pointerOver(view.getByTestId("link-a"), {
      pointerType: "touch",
      bubbles: true,
    });
    act(() => {
      vi.advanceTimersByTime(SIDEBAR_THREAD_HOVER_CARD_OPEN_DELAY_MS * 2);
    });
    expect(card()).toBeNull();
  });
});
