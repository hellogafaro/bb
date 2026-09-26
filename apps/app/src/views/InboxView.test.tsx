// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { PERSONAL_PROJECT_ID, type PendingInteraction } from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InboxView } from "./InboxView";

const mocks = vi.hoisted(() => ({
  markRead: vi.fn(),
  markUnread: vi.fn(),
  resolve: vi.fn(),
  toastSuccess: vi.fn(),
  interactions: [] as PendingInteraction[],
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: navigationFixture }),
}));

vi.mock("@/hooks/queries/agent-queries", () => ({
  useAgents: () => ({ data: [] }),
  resolveThreadAgent: () => null,
}));

vi.mock("@/hooks/queries/inbox-queries", () => ({
  useInboxInteractions: () => ({ data: mocks.interactions, isPending: false }),
  useInboxSummaries: () => ({
    data: {
      byThread: new Map([
        [
          "thr_alpha",
          {
            threadId: "thr_alpha",
            goal: "Ship the alpha fix",
            state: "Patch is ready",
            needs: null,
            sourceVersion: 1,
            updatedAt: 1,
          },
        ],
      ]),
      pending: new Set<string>(),
    },
    isPending: false,
  }),
  useThreadOutput: () => ({ isPending: false, data: { output: "Done." } }),
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMarkThreadRead: () => ({ mutate: mocks.markRead }),
  useMarkThreadUnread: () => ({ mutate: mocks.markUnread }),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({ mutate: mocks.resolve }),
}));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { success: mocks.toastSuccess, error: vi.fn() },
}));

vi.mock("@/components/plugin/PluginThreadChat", () => ({
  PluginThreadChat: ({ threadId }: { threadId: string }) => (
    <div data-testid={`chat-${threadId}`}>
      <div
        className="ProseMirror"
        contentEditable
        suppressContentEditableWarning
      />
    </div>
  ),
}));

vi.mock(
  "@/components/thread/pending-interactions/ThreadPendingInteractionBanner",
  () => ({
    ThreadPendingInteractionBanner: () => <div data-testid="banner" />,
  }),
);

const alpha = makeThreadListEntry({
  id: "thr_alpha",
  title: "Alpha",
  projectId: PERSONAL_PROJECT_ID,
  lastReadAt: null,
  latestAttentionAt: 300,
  updatedAt: 300,
});
const beta = makeThreadListEntry({
  id: "thr_beta",
  title: "Beta",
  projectId: PERSONAL_PROJECT_ID,
  lastReadAt: null,
  latestAttentionAt: 200,
  updatedAt: 200,
});
const readThread = makeThreadListEntry({
  id: "thr_read",
  title: "Already read",
  projectId: PERSONAL_PROJECT_ID,
  lastReadAt: 500,
  latestAttentionAt: 100,
  updatedAt: 100,
});

const navigationFixture = {
  sections: [],
  projects: [],
  personalProject: {
    id: PERSONAL_PROJECT_ID,
    name: "Personal",
    threads: [beta, readThread, alpha],
  },
} as unknown as SidebarBootstrapResponse;

function renderInbox() {
  return render(
    <MemoryRouter>
      <TooltipProvider>
        <InboxView />
      </TooltipProvider>
    </MemoryRouter>,
  );
}

function selectedCard(): HTMLElement | null {
  return document.querySelector("[data-inbox-card][data-selected]");
}

beforeEach(() => {
  mocks.interactions = [];
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("InboxView", () => {
  it("lists unread threads newest first and opens the first one", () => {
    renderInbox();
    const cards = document.querySelectorAll("[data-inbox-card]");
    expect(
      [...cards].map((card) => card.getAttribute("data-inbox-card")),
    ).toEqual(["thr_alpha", "thr_beta"]);
    expect(selectedCard()?.getAttribute("data-inbox-card")).toBe("thr_alpha");
    expect(screen.getByTestId("chat-thr_alpha")).toBeTruthy();
    expect(screen.queryByTestId("chat-thr_beta")).toBeNull();
    expect(screen.getByText("Ship the alpha fix")).toBeTruthy();
    expect(screen.getByText("Patch is ready")).toBeTruthy();
    expect(screen.queryByText("Everything that needs you")).toBeNull();
  });

  it("moves the selection with the arrow keys and marks the selected thread done with undo", () => {
    renderInbox();
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(selectedCard()?.getAttribute("data-inbox-card")).toBe("thr_beta");
    expect(screen.getByTestId("chat-thr_beta")).toBeTruthy();
    fireEvent.keyDown(window, { key: "k" });
    expect(selectedCard()?.getAttribute("data-inbox-card")).toBe("thr_alpha");

    fireEvent.keyDown(window, { key: "e" });
    expect(mocks.markRead).toHaveBeenCalledWith({ threadId: "thr_alpha" });
    expect(mocks.toastSuccess).toHaveBeenCalledWith(
      "Marked as done",
      expect.objectContaining({ description: "Alpha" }),
    );
    const options = mocks.toastSuccess.mock.calls[0]?.[1] as {
      action: { label: string; onClick: () => void };
    };
    expect(options.action.label).toBe("Undo");
    options.action.onClick();
    expect(mocks.markUnread).toHaveBeenCalledWith({ threadId: "thr_alpha" });
  });

  it("focuses the reply editor on R and ignores navigation keys while typing", () => {
    renderInbox();
    fireEvent.keyDown(window, { key: "r" });
    const editor = document.querySelector<HTMLElement>(".ProseMirror");
    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor as HTMLElement, { key: "j" });
    expect(selectedCard()?.getAttribute("data-inbox-card")).toBe("thr_alpha");
    fireEvent.keyDown(editor as HTMLElement, { key: "e" });
    expect(mocks.markRead).not.toHaveBeenCalled();
  });

  it("selects a card on click and hides the done button while an approval is pending", () => {
    mocks.interactions = [
      {
        id: "pi_1",
        threadId: "thr_beta",
        turnId: "turn_1",
        originKind: "provider",
        status: "pending",
        payload: {
          kind: "approval",
          subject: {
            kind: "command",
            itemId: "item_1",
            command: "rm -rf build",
            cwd: "/tmp",
          },
          reason: null,
          availableDecisions: ["allow_once", "deny"],
        },
        resolution: null,
        createdAt: 1,
        updatedAt: 1,
      } as unknown as PendingInteraction,
    ];
    renderInbox();
    expect(screen.getAllByRole("button", { name: "Mark done" })).toHaveLength(
      1,
    );
    fireEvent.click(screen.getByText("Beta"));
    expect(selectedCard()?.getAttribute("data-inbox-card")).toBe("thr_beta");
    fireEvent.keyDown(window, { key: "a" });
    expect(mocks.resolve).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: "thr_beta",
        interactionId: "pi_1",
        resolution: expect.objectContaining({ decision: "allow_once" }),
      }),
    );
  });
});
