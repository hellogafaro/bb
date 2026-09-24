// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { ThreadTimelineSurfaceProps } from "@/components/thread/timeline/ThreadTimelineSurface";

vi.mock("@/components/thread/timeline/ThreadTimelineSurface", () => ({
  ThreadTimelineSurface: (props: ThreadTimelineSurfaceProps) => (
    <div data-testid="timeline">
      <span data-testid="plugin-panel-opener">
        {props.onOpenPluginPanel === undefined ? "missing" : "available"}
      </span>
      <span data-testid="navigation-target">
        {props.timelineNavigationTargetRowId ?? "none"}
      </span>
    </div>
  ),
}));

const { ThreadTimelinePane } = await import("./ThreadTimelinePane");

afterEach(cleanup);

it("forwards pane callbacks to the timeline without an outline", () => {
  render(
    <ThreadTimelinePane
      activeThinking={null}
      canSpawnChild={false}
      contextBoundarySeq={null}
      footer={null}
      hasOlderTimelineRows={false}
      isLoadingOlderTimelineRows={false}
      isStopping={false}
      isThreadTimelinePending={false}
      onLoadOlderRows={() => undefined}
      onOpenPluginPanel={() => true}
      projectId="proj_1"
      resolveMentionLink={() => null}
      showOngoingIndicator={false}
      stoppingAnchorAt={0}
      threadId="thr_1"
      threadRuntimeDisplayStatus="idle"
      timelineError={false}
      timelineRows={[]}
      unreadDividerAutoScroll={false}
      unreadDividerPlacement={null}
      workspaceRootPath={undefined}
    />,
  );

  expect(screen.getByTestId("plugin-panel-opener").textContent).toBe(
    "available",
  );
  expect(screen.getByTestId("navigation-target").textContent).toBe("none");
  expect(document.querySelector("[data-thread-toc]")).toBeNull();
});
