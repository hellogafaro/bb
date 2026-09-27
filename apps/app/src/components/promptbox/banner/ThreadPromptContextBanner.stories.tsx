import { useState, type ReactNode } from "react";
import type { ThreadPullRequest } from "@bb/domain";
import type { PullRequestMergeMethod } from "@bb/server-contract";
import {
  ThreadPromptContextBanner,
  type ThreadPromptArchivedSection,
  type ThreadPromptContextBannerExpandedSection,
  type ThreadPromptEnvironmentGoneSection,
  type ThreadPromptParentThreadSection,
  type ThreadPromptChildThreadsSection,
} from "@/components/promptbox/banner/ThreadPromptContextBanner";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";

export default {
  title: "promptbox/banner/Context Banner",
};

const noop = () => {};

type PromptStageSize = "desktop" | "mobile";

function PromptStage({
  children,
  size,
}: {
  children: ReactNode;
  size: PromptStageSize;
}) {
  return (
    <div
      data-promptbox-shell=""
      className={size === "desktop" ? "min-w-0 flex-1" : "w-[20rem] shrink-0"}
    >
      {children}
    </div>
  );
}

const parentThreadFixture: ThreadPromptParentThreadSection = {
  parentThreadTitle: "Parent thread",
  href: "/projects/proj-1/threads/thr_parent_demo",
  relationship: "parent",
};

const forkedFromFixture: ThreadPromptParentThreadSection = {
  parentThreadTitle: "Investigate flaky test",
  href: "/projects/proj-1/threads/thr_source_demo",
  relationship: "fork",
};

const sideChatFromFixture: ThreadPromptParentThreadSection = {
  parentThreadTitle: "Investigate flaky test",
  href: "/projects/proj-1/threads/thr_source_demo",
  relationship: "side-chat",
};

const childThreadsFixture: ThreadPromptChildThreadsSection = {
  items: [
    {
      id: "thr_a",
      title: "Investigate Safari auth flake on staging",
      href: "/projects/proj-1/threads/thr_a",
      hasPendingInteraction: false,
    },
    {
      id: "thr_b",
      title: "Review PR #4521 reviewer comments",
      href: "/projects/proj-1/threads/thr_b",
      hasPendingInteraction: false,
    },
    {
      id: "thr_c",
      title: "Refactor email pipeline retry logic",
      href: "/projects/proj-1/threads/thr_c",
      hasPendingInteraction: false,
    },
    {
      id: "thr_d",
      title: "Backfill workspace-status invalidation cache",
      href: "/projects/proj-1/threads/thr_d",
      hasPendingInteraction: false,
    },
  ],
};

const childThreadsPendingFixture: ThreadPromptChildThreadsSection = {
  items: [
    {
      id: "thr_blocked",
      title: "Install workspace tools",
      href: "/projects/proj-1/threads/thr_blocked",
      hasPendingInteraction: true,
    },
  ],
};

const childThreadsMixedFixture: ThreadPromptChildThreadsSection = {
  items: childThreadsFixture.items.map((item, index) =>
    index === 1 ? { ...item, hasPendingInteraction: true } : item,
  ),
};

const childThreadsLargeFixture: ThreadPromptChildThreadsSection = {
  items: Array.from({ length: 12 }, (_, i) => ({
    id: `thr_large_${i}`,
    title: `Child work item ${i + 1} that is busy doing thing-${i}`,
    href: `/projects/proj-1/threads/thr_large_${i}`,
    hasPendingInteraction: i === 1,
  })),
};

function buildPullRequestFixture(
  overrides: Partial<ThreadPullRequest> = {},
): ThreadPullRequest {
  const base: ThreadPullRequest = {
    number: 128,
    title: "Show pull request status in the prompt context banner",
    state: "open",
    url: "https://github.com/acme/bb/pull/128",
    baseRefName: "main",
    headRefName: "bb/pr-context-banner",
    updatedAt: "2026-06-16T12:30:00Z",
    checks: {
      state: "failing",
      totalCount: 3,
      passedCount: 1,
      failedCount: 1,
      pendingCount: 1,
    },
    review: {
      state: "review_requested",
      reviewRequestCount: 1,
    },
    mergeability: {
      state: "mergeable",
      mergeStateStatus: "CLEAN",
      mergeable: "MERGEABLE",
    },
    attention: "checks_failed",
  };

  return {
    ...base,
    ...overrides,
    checks: overrides.checks
      ? { ...base.checks, ...overrides.checks }
      : base.checks,
    review: overrides.review
      ? { ...base.review, ...overrides.review }
      : base.review,
    mergeability: overrides.mergeability
      ? { ...base.mergeability, ...overrides.mergeability }
      : base.mergeability,
  };
}

const pullRequestFixture = buildPullRequestFixture();
const mergedPullRequestFixture = buildPullRequestFixture({
  number: 134,
  state: "merged",
  checks: {
    state: "passing",
    totalCount: 3,
    passedCount: 3,
    failedCount: 0,
    pendingCount: 0,
  },
  attention: "merged",
});

const pullRequestStateRows: readonly {
  label: string;
  hint: string;
  pullRequest: ThreadPullRequest;
}[] = [
  {
    label: "open · checks passing",
    hint: "happy path",
    pullRequest: buildPullRequestFixture({
      number: 128,
      checks: {
        state: "passing",
        totalCount: 3,
        passedCount: 3,
        failedCount: 0,
        pendingCount: 0,
      },
      attention: "ready_to_merge",
    }),
  },
  {
    label: "open · checks pending",
    hint: "running checks",
    pullRequest: buildPullRequestFixture({
      number: 129,
      checks: {
        state: "pending",
        totalCount: 3,
        passedCount: 1,
        failedCount: 0,
        pendingCount: 2,
      },
      attention: "checks_pending",
    }),
  },
  {
    label: "open · checks failing",
    hint: "failing checks",
    pullRequest: buildPullRequestFixture({
      number: 130,
      checks: {
        state: "failing",
        totalCount: 3,
        passedCount: 1,
        failedCount: 1,
        pendingCount: 1,
      },
      attention: "checks_failed",
    }),
  },
  {
    label: "draft · checks pending",
    hint: "draft PR",
    pullRequest: buildPullRequestFixture({
      number: 131,
      state: "draft",
      checks: {
        state: "pending",
        totalCount: 2,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 2,
      },
      mergeability: {
        state: "draft",
        mergeStateStatus: "DRAFT",
        mergeable: "UNKNOWN",
      },
      attention: "draft",
    }),
  },
  {
    label: "open · review requested",
    hint: "human attention",
    pullRequest: buildPullRequestFixture({
      number: 132,
      checks: {
        state: "passing",
        totalCount: 3,
        passedCount: 3,
        failedCount: 0,
        pendingCount: 0,
      },
      review: {
        state: "review_requested",
        reviewRequestCount: 2,
      },
      attention: "review_requested",
    }),
  },
  {
    label: "open · blocked",
    hint: "merge blocked",
    pullRequest: buildPullRequestFixture({
      number: 133,
      checks: {
        state: "unknown",
        totalCount: 0,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      },
      mergeability: {
        state: "blocked",
        mergeStateStatus: "BLOCKED",
        mergeable: "UNKNOWN",
      },
      attention: "blocked",
    }),
  },
  {
    label: "merged",
    hint: "terminal state",
    pullRequest: mergedPullRequestFixture,
  },
  {
    label: "closed",
    hint: "terminal state",
    pullRequest: buildPullRequestFixture({
      number: 135,
      state: "closed",
      checks: {
        state: "unknown",
        totalCount: 0,
        passedCount: 0,
        failedCount: 0,
        pendingCount: 0,
      },
      attention: "closed",
    }),
  },
];

interface RowConfig {
  archived?: ThreadPromptArchivedSection | null;
  environmentGone?: ThreadPromptEnvironmentGoneSection | null;
  parentThread?: ThreadPromptParentThreadSection | null;
  childThreads?: ThreadPromptChildThreadsSection | null;
  pullRequest?: ThreadPullRequest | null;
  pullRequestActions?: boolean;
  pullRequestMergeMethod?: PullRequestMergeMethod;
  initiallyExpandedSection?: ThreadPromptContextBannerExpandedSection | null;
}

function ContextBannerPreview({
  archived = null,
  environmentGone = null,
  parentThread = null,
  childThreads = null,
  pullRequest = null,
  pullRequestActions = false,
  pullRequestMergeMethod = "merge",
  initiallyExpandedSection = null,
  size,
}: RowConfig & { size: PromptStageSize }) {
  const [expandedSection, setExpandedSection] =
    useState<ThreadPromptContextBannerExpandedSection | null>(
      initiallyExpandedSection,
    );
  return (
    <PromptStage size={size}>
      <ThreadPromptContextBanner
        archivedSection={archived}
        environmentGoneSection={environmentGone}
        parentThreadSection={parentThread}
        childThreadsSection={childThreads}
        pullRequestSection={
          pullRequest
            ? {
                pullRequest,
                ...(pullRequestActions
                  ? {
                      actions: {
                        onMarkReady: noop,
                        onMerge: noop,
                        selectedMergeMethod: pullRequestMergeMethod,
                      },
                    }
                  : {}),
              }
            : null
        }
        expandedSection={expandedSection}
        onToggleSection={(next) =>
          setExpandedSection((previous) => (previous === next ? null : next))
        }
      />
    </PromptStage>
  );
}

function Row(props: RowConfig) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <ContextBannerPreview {...props} size="desktop" />
      <ContextBannerPreview {...props} size="mobile" />
    </div>
  );
}

const archivedFixture: ThreadPromptArchivedSection = {
  archivedAt: 1_731_456_000_000,
  onUnarchive: noop,
};

const destroyedEnvironmentFixture: ThreadPromptEnvironmentGoneSection = {
  status: "destroyed",
};

const restorableEnvironmentFixture: ThreadPromptEnvironmentGoneSection = {
  status: "destroyed",
  onRestore: noop,
};

export function Overview() {
  return (
    <StoryCard>
      <StoryRow
        label="archived thread"
        hint="archive icon + 'Thread is archived' with a filled unarchive action pinned to the far right"
      >
        <Row archived={archivedFixture} />
      </StoryRow>
      <StoryRow
        label="archived + child thread"
        hint="archived row plus parent context; action is hidden because archived is not the only segment"
      >
        <Row archived={archivedFixture} parentThread={parentThreadFixture} />
      </StoryRow>
      <StoryRow
        label="archived thread (with other context, all suppressed)"
        hint="archived takes precedence — child work is hidden, so the unarchive action remains available"
      >
        <Row archived={archivedFixture} childThreads={childThreadsFixture} />
      </StoryRow>
      <StoryRow
        label="environment archived"
        hint="archived-environment row suppresses childThreads"
      >
        <Row environmentGone={destroyedEnvironmentFixture} />
      </StoryRow>
      <StoryRow
        label="environment archived (restorable)"
        hint="the workspace can be rebuilt on its branch, so a filled restore action is pinned to the far right"
      >
        <Row environmentGone={restorableEnvironmentFixture} />
      </StoryRow>
      <StoryRow
        label="environment archived + child thread"
        hint="archived-environment row plus parent context"
      >
        <Row
          environmentGone={destroyedEnvironmentFixture}
          parentThread={parentThreadFixture}
        />
      </StoryRow>
      <StoryRow
        label="environment archived (with other context, all suppressed)"
        hint="archived environment takes precedence — child work is hidden"
      >
        <Row
          environmentGone={destroyedEnvironmentFixture}
          childThreads={childThreadsFixture}
        />
      </StoryRow>
      <StoryRow label="child thread (alone)" hint="inline parent link">
        <Row parentThread={parentThreadFixture} />
      </StoryRow>
      <StoryRow
        label="forked thread (alone)"
        hint={'renders "Forked from …" instead of "Parent …"'}
      >
        <Row parentThread={forkedFromFixture} />
      </StoryRow>
      <StoryRow
        label="side-chat thread (alone)"
        hint={'renders "Side chat of …"'}
      >
        <Row parentThread={sideChatFromFixture} />
      </StoryRow>
      <StoryRow
        label="parent thread with a child waiting for approval"
        hint="the parent banner names the blocked child and drops the active shimmer"
      >
        <Row childThreads={childThreadsPendingFixture} />
      </StoryRow>
      <StoryRow
        label="parent thread with active children (collapsed)"
        hint="the primary child mirrors other background-work banners without an animated flash; click to expand the child list"
      >
        <Row childThreads={childThreadsFixture} />
      </StoryRow>
      <StoryRow
        label="active child + pull request"
        hint="long child titles stay within the shared stack; pull request actions remain available"
      >
        <Row
          childThreads={childThreadsFixture}
          pullRequest={pullRequestFixture}
          pullRequestActions
        />
      </StoryRow>
      <StoryRow
        label="parent thread with active children (expanded)"
        hint="list of children with status + pending-approval marker on item 2"
      >
        <Row
          childThreads={childThreadsMixedFixture}
          initiallyExpandedSection="childThreads"
        />
      </StoryRow>
      <StoryRow
        label="parent thread with many children (scrollable)"
        hint="max-h-40 caps the list; rest scrolls"
      >
        <Row
          childThreads={childThreadsLargeFixture}
          initiallyExpandedSection="childThreads"
        />
      </StoryRow>
      <StoryRow
        label="metadata + pull request"
        hint="relationship metadata renders first, then GitHub PR"
      >
        <Row
          parentThread={forkedFromFixture}
          pullRequest={pullRequestFixture}
        />
      </StoryRow>
      {pullRequestStateRows.map(({ label, hint, pullRequest }) => (
        <StoryRow key={label} label={`pull request — ${label}`} hint={hint}>
          <Row pullRequest={pullRequest} pullRequestActions />
        </StoryRow>
      ))}
    </StoryCard>
  );
}

export const MachineRemovalHistory = () => (
  <StoryCard>
    <StoryRow label="Machine removed">
      <Row environmentGone={{ status: "removed" }} />
    </StoryRow>
    <StoryRow label="Removal in progress">
      <Row environmentGone={{ status: "removing" }} />
    </StoryRow>
    <StoryRow label="Cleanup failed">
      <Row environmentGone={{ status: "cleanup-failed" }} />
    </StoryRow>
  </StoryCard>
);
