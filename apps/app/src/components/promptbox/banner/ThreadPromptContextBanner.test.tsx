// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ThreadPullRequest } from "@bb/domain";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/promptbox/banner/ChildThreadPanel", () => ({
  ChildThreadPanel: ({ threadId }: { threadId: string }) => (
    <div data-testid="child-thread-panel" data-thread-id={threadId} />
  ),
}));
import {
  isThreadDisplayStatusBannerActive,
  ThreadPromptContextBanner,
} from "./ThreadPromptContextBanner";

const noop = () => {};

const pullRequestFixture: ThreadPullRequest = {
  number: 128,
  title: "Show pull request status in the prompt context banner",
  state: "open",
  url: "https://github.com/acme/bb/pull/128",
  baseRefName: "main",
  headRefName: "bb/pr-context-banner",
  updatedAt: "2026-06-16T12:30:00Z",
  checks: {
    state: "passing",
    totalCount: 1,
    passedCount: 1,
    failedCount: 0,
    pendingCount: 0,
  },
  review: {
    state: "none",
    reviewRequestCount: 0,
  },
  mergeability: {
    state: "mergeable",
    mergeStateStatus: "CLEAN",
    mergeable: "MERGEABLE",
  },
  attention: "ready_to_merge",
};

const parentThreadFixture = {
  parentThreadTitle: "Plan the release",
  href: "/threads/thr_parent",
  relationship: "parent" as const,
};

afterEach(cleanup);

describe("ThreadPromptContextBanner", () => {
  it("renders the archived read-only status without an action", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={{ archivedAt: 1_731_456_000_000 }}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Thread is archived");
    expect(markup).toContain('role="status"');
    expect(markup).not.toContain("<button");
  });

  it.each([
    ["removed", "Machine removed"],
    ["removing", "Machine removal in progress"],
    ["cleanup-failed", "Machine cleanup failed"],
    ["destroyed", "Environment unavailable"],
  ] as const)(
    "collapses the %s explanation behind its status toggle by default",
    (status, label) => {
      const toggled: string[] = [];
      render(
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={{ status }}
          parentThreadSection={null}
          childThreadsSection={null}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={(section) => toggled.push(section)}
        />,
      );
      const toggle = screen.getByRole("button", { name: label });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText(/history|machine settings/)).toBeNull();
      expect(screen.queryByText("Provision")).toBeNull();
      toggle.click();
      expect(toggled).toEqual(["status"]);
    },
  );

  it("shows the machine removal explanation once the status is expanded", () => {
    render(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={{ status: "cleanup-failed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection="status"
        onToggleSection={noop}
      />,
    );
    expect(
      screen
        .getByRole("button", { name: "Machine cleanup failed" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      screen.getByText(
        "This thread is unavailable while machine cleanup is pending. Retry cleanup in machine settings.",
      ),
    ).toBeDefined();
  });

  it.each([
    {
      label: "archived",
      archivedSection: { archivedAt: 1_731_456_000_000 },
      environmentGoneSection: null,
      expectedLabel: "Thread is archived",
    },
    {
      label: "environment archived",
      archivedSection: null,
      environmentGoneSection: { status: "destroyed" as const },
      expectedLabel: "Environment unavailable",
    },
  ])(
    "keeps the $label read-only status visible in compact mode",
    ({ archivedSection, environmentGoneSection, expectedLabel }) => {
      const markup = renderToStaticMarkup(
        <MemoryRouter>
          <ThreadPromptContextBanner
            archivedSection={archivedSection}
            environmentGoneSection={environmentGoneSection}
            parentThreadSection={{
              parentThreadTitle: "Parent thread",
              href: "/threads/thr_parent",
              relationship: "parent",
            }}
            childThreadsSection={null}
            pullRequestSection={null}
            expandedSection={null}
            onToggleSection={noop}
          />
        </MemoryRouter>,
      );

      expect(markup).toContain(expectedLabel);
      expect(markup).not.toContain(
        `data-promptbox-hide-compact="">${expectedLabel}`,
      );
    },
  );

  it("offers unarchiving first when an archived thread also lost its environment", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={{
          archivedAt: 1_731_456_000_000,
          onUnarchive: noop,
        }}
        environmentGoneSection={{ status: "destroyed" }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).not.toContain("Thread is archived");
    expect(markup).toContain(">Unarchive<");
  });

  it("offers restoring the workspace once the thread is live again", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={{ status: "destroyed", onRestore: noop }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Environment unavailable");
    expect(markup).toContain(">Restore workspace<");
  });

  it("shows the restore action as pending while it runs", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={{
          status: "destroyed",
          onRestore: noop,
          restorePending: true,
        }}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={null}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain(">Restoring...<");
    expect(markup).toContain("disabled");
  });

  it("labels a standalone pull request without non-actionable attention text", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{ pullRequest: pullRequestFixture }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).not.toContain("PR #128 · Open");
    expect(markup).not.toContain("· Ready to merge");
    expect(markup).not.toContain('alt="Checks success"');
  });

  it("uses the selected pull request merge method as the action label", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: pullRequestFixture,
          actions: {
            onMerge: noop,
            selectedMergeMethod: "squash",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("Squash merge");
  });

  it("does not label standalone pending checks", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            checks: {
              state: "pending",
              totalCount: 1,
              passedCount: 0,
              failedCount: 0,
              pendingCount: 1,
            },
            attention: "checks_pending",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).not.toContain("PR #128 · Open");
    expect(markup).not.toContain("· Checks pending");
    expect(markup).not.toContain('alt="Checks pending"');
  });

  it("keeps useful standalone terminal pull request state labels", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            state: "closed",
            attention: "closed",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128 · Closed");
  });

  it("summarizes child work without flashing the banner", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_child",
                title: "Investigate failing checks",
                href: "/threads/thr_child",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Child threads"');
    expect(markup).toContain(
      "1 child thread · 1 active: Investigate failing checks",
    );
    expect(markup).toContain("Active:");
    expect(markup).toContain("Investigate failing checks");
    expect(markup).toContain('data-icon="UserRound"');
    expect(markup).toContain("animate-shine-icon");
    expect(markup).not.toContain("animate-shine font-medium");
  });

  it("summarizes additional active child threads", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_primary",
                title: "Investigate failing checks",
                href: "/threads/thr_primary",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
              {
                id: "thr_other",
                title: "Review the release notes",
                href: "/threads/thr_other",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(
      "2 child threads · 2 active: Investigate failing checks",
    );
    expect(markup).toContain("+1 more");
  });

  it("lets combined child and context cards shrink inside the composer stack", () => {
    render(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_child",
                title: "Host-owned SourceCode and Diff renderers",
                href: "/threads/thr_child",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={{ pullRequest: pullRequestFixture }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    const childCard = screen.getByRole("region", { name: "Child threads" });
    const contextCard = screen.getByRole("region", {
      name: "Thread context before sending",
    });

    expect(childCard.parentElement).toBe(contextCard.parentElement);
    expect(childCard.parentElement?.classList.contains("min-w-0")).toBe(true);
  });

  it("uses neutral active copy for a child waiting for a host", () => {
    expect(isThreadDisplayStatusBannerActive("waiting-for-host")).toBe(true);

    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_waiting",
                title: "Waiting for build host",
                href: "/threads/thr_waiting",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(
      "1 child thread · 1 active: Waiting for build host",
    );
    expect(markup).toContain("Active:");
    expect(markup).not.toContain("Running");
  });

  it("labels a child blocked on approval instead of active work", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_blocked",
                title: "Install workspace tools",
                href: "/threads/thr_blocked",
                projectId: "proj-1",
                providerId: "codex",
                state: "needs-input",
                hasPendingInteraction: true,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain(
      "1 child thread · 1 needs input: Install workspace tools",
    );
    expect(markup).toContain("Needs input:");
    expect(markup).toContain("Install workspace tools");
    expect(markup).toContain('data-icon="CircleQuestion"');
    expect(markup).not.toContain("Active:");
    expect(markup).not.toContain("animate-shine-icon");
  });

  it("keeps finished children listed and puts them after live ones", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_done",
                title: "Write release notes",
                href: "/threads/thr_done",
                projectId: "proj-1",
                providerId: "codex",
                state: "done",
                hasPendingInteraction: false,
              },
              {
                id: "thr_active",
                title: "Run the test suite",
                href: "/threads/thr_active",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection="childThreads"
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain("2 child threads · 1 active: Run the test suite");
    expect(markup).toContain('data-icon="Check"');
    expect(markup.indexOf("Run the test suite")).toBeLessThan(
      markup.indexOf("Write release notes"),
    );
  });

  it("expands a child row into its read-only panel and keeps an open link", () => {
    render(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={null}
          childThreadsSection={{
            items: [
              {
                id: "thr_child",
                title: "Investigate failing checks",
                href: "/projects/proj-1/threads/thr_child",
                projectId: "proj-1",
                providerId: "codex",
                state: "active",
                hasPendingInteraction: false,
              },
            ],
          }}
          pullRequestSection={null}
          expandedSection="childThreads"
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("child-thread-panel")).toBeNull();
    const row = screen.getByRole("button", {
      name: "Active: Investigate failing checks",
    });
    fireEvent.click(row);
    const panel = screen.getByTestId("child-thread-panel");
    expect(panel.getAttribute("data-thread-id")).toBe("thr_child");
    expect(row.getAttribute("aria-expanded")).toBe("true");
    expect(
      screen
        .getByRole("link", { name: "Open Investigate failing checks" })
        .getAttribute("href"),
    ).toBe("/projects/proj-1/threads/thr_child");

    fireEvent.click(row);
    expect(screen.queryByTestId("child-thread-panel")).toBeNull();
  });

  it("labels standalone actionable pull request attention", () => {
    const markup = renderToStaticMarkup(
      <ThreadPromptContextBanner
        archivedSection={null}
        environmentGoneSection={null}
        parentThreadSection={null}
        childThreadsSection={null}
        pullRequestSection={{
          pullRequest: {
            ...pullRequestFixture,
            checks: {
              state: "failing",
              totalCount: 1,
              passedCount: 0,
              failedCount: 1,
              pendingCount: 0,
            },
            attention: "checks_failed",
          },
        }}
        expandedSection={null}
        onToggleSection={noop}
      />,
    );

    expect(markup).toContain("PR #128");
    expect(markup).toContain("· Checks failing");
    expect(markup).not.toContain("Checks failure");
  });

  it("keeps the pull request action visible beside other context segments", () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ThreadPromptContextBanner
          archivedSection={null}
          environmentGoneSection={null}
          parentThreadSection={parentThreadFixture}
          childThreadsSection={null}
          pullRequestSection={{
            pullRequest: pullRequestFixture,
            actions: {
              onMerge: noop,
              selectedMergeMethod: "rebase",
            },
          }}
          expandedSection={null}
          onToggleSection={noop}
        />
      </MemoryRouter>,
    );

    expect(markup).toContain('aria-label="Pull request 128');
    expect(markup).toContain("Rebase and merge");
  });

  it.each([
    {
      label: "checked open",
      pullRequest: pullRequestFixture,
      expectedMinWidthClass: "min-w-13",
    },
    {
      label: "merged",
      pullRequest: {
        ...pullRequestFixture,
        state: "merged" as const,
        attention: "merged" as const,
      },
      expectedMinWidthClass: "min-w-8",
    },
    {
      label: "closed",
      pullRequest: {
        ...pullRequestFixture,
        state: "closed" as const,
        attention: "closed" as const,
      },
      expectedMinWidthClass: "min-w-8",
    },
  ])(
    "reserves only the width needed by a $label pull request status pill",
    ({ pullRequest, expectedMinWidthClass }) => {
      render(
        <MemoryRouter>
          <ThreadPromptContextBanner
            archivedSection={null}
            environmentGoneSection={null}
            parentThreadSection={parentThreadFixture}
            childThreadsSection={null}
            pullRequestSection={{ pullRequest }}
            expandedSection={null}
            onToggleSection={noop}
          />
        </MemoryRouter>,
      );

      const pullRequestLink = screen.getByRole("link", {
        name: /Pull request 128:/,
      });
      expect(
        ["min-w-8", "min-w-13"].filter((className) =>
          pullRequestLink.classList.contains(className),
        ),
      ).toEqual([expectedMinWidthClass]);
    },
  );
});
