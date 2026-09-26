// @vitest-environment jsdom

import type { ReactNode } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import {
  makeProviderInfo,
  makeThreadListEntry,
} from "@bb/test-helpers/domain-fixtures";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { sdk } from "@/lib/sdk";
import { AppRoutes } from "../App";
import { THREADS_PAGE_DESCRIPTION } from "./ThreadsView";

vi.mock("../components/layout/AppLayout", () => ({
  AppLayout: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("./SettingsView", () => ({
  SettingsView: () => <h1>Settings</h1>,
}));
vi.mock("./SplitWorkspaceRoute", () => ({
  default: () => <h1>App workspace</h1>,
}));
const threadActions = {
  unarchiveThread: vi.fn(),
  requestRename: vi.fn(),
};
vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => threadActions,
}));

function LocationPath() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

const waiting = makeThreadListEntry({
  id: "thr_waiting",
  projectId: "proj_test",
  title: "Promote free shipping",
  hasPendingInteraction: true,
  updatedAt: 1_000,
  latestAttentionAt: 1_000,
  lastReadAt: 0,
});
const done = makeThreadListEntry({
  id: "thr_done",
  projectId: "proj_test",
  title: "Define cleanup scope",
  updatedAt: 500,
  latestAttentionAt: 500,
  lastReadAt: 500,
});
const child = makeThreadListEntry({
  id: "thr_child",
  projectId: "proj_test",
  parentThreadId: "thr_done",
  title: "Child research",
  updatedAt: 400,
  latestAttentionAt: 400,
  lastReadAt: 400,
});
const archived = makeThreadListEntry({
  id: "thr_archived",
  projectId: "proj_test",
  title: "Old experiment",
  archivedAt: 900,
  updatedAt: 900,
  latestAttentionAt: 900,
  lastReadAt: 900,
});

function renderRoutes(
  initialPath: string,
  bootstrap: SidebarBootstrapResponse = makeSidebarBootstrapResponse({
    projects: [
      makeProjectWithThreadsResponse({ threads: [waiting, done, child] }),
    ],
  }),
) {
  vi.spyOn(sdk.agents, "list").mockResolvedValue([]);
  vi.spyOn(sdk.providers, "list").mockResolvedValue([
    makeProviderInfo({ id: "codex", displayName: "Codex" }),
  ]);
  const threadList = vi
    .spyOn(sdk.threads, "list")
    .mockResolvedValue([archived]);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 500 })),
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(800);
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(1000);
  const { queryClient, wrapper: QueryClientWrapper } =
    createQueryClientTestHarness();
  queryClient.setQueryData(sidebarNavigationQueryKey(), bootstrap);
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientWrapper>
        <AppRoutes />
        <LocationPath />
      </QueryClientWrapper>
    </MemoryRouter>,
  );
  return { threadList };
}

function location(): string | null {
  return screen.getByTestId("location").textContent;
}

beforeAll(async () => {
  await import("./ThreadsView");
}, 60_000);

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Threads page", () => {
  it("groups active threads by status with nested children", async () => {
    renderRoutes("/threads");
    expect(await screen.findByText("Promote free shipping")).toBeTruthy();
    expect(screen.getByText(THREADS_PAGE_DESCRIPTION)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Waiting/ })).toBeTruthy();
    expect(screen.getByRole("button", { name: /Done/ })).toBeTruthy();
    expect(screen.getByText("Define cleanup scope")).toBeTruthy();
    expect(screen.getByText("Child research")).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: /All threads/ }).textContent,
    ).toContain("3");
    expect(screen.getAllByText("Test project").length).toBe(3);
    const projectPill = screen.getAllByText("Test project")[0]!.parentElement!;
    expect(projectPill.className).toContain("gap-1");
    expect(projectPill.querySelector("[data-project-color-dot]")).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText("Codex").length).toBe(3));
  });

  it("collapses a status group from its header", async () => {
    renderRoutes("/threads");
    expect(await screen.findByText("Define cleanup scope")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Done/ }));
    await waitFor(() =>
      expect(screen.queryByText("Define cleanup scope")).toBeNull(),
    );
    expect(screen.getByText("Promote free shipping")).toBeTruthy();
  });

  it("links rows to the thread route", async () => {
    renderRoutes("/threads");
    const link = await screen.findByRole("link", {
      name: "Promote free shipping",
    });
    expect(link.getAttribute("href")).toBe(
      "/projects/proj_test/threads/thr_waiting",
    );
  });

  it("switches to the archived tab and lists archived threads", async () => {
    const { threadList } = renderRoutes("/threads");
    fireEvent.click(await screen.findByRole("tab", { name: "Archived" }));
    expect(location()).toBe("/threads?status=archived");
    expect(await screen.findByText("Old experiment")).toBeTruthy();
    expect(threadList).toHaveBeenCalledWith(
      expect.objectContaining({ archived: true, offset: 0 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Unarchive thread" }));
    expect(threadActions.unarchiveThread).toHaveBeenCalledWith(archived);
  });

  it("shows the wake time for snoozed threads", async () => {
    const snoozed = makeThreadListEntry({
      id: "thr_snoozed",
      projectId: "proj_test",
      title: "Sleeping thread",
      snoozedUntil: Date.now() + 3 * 60 * 60 * 1000,
      updatedAt: 500,
      latestAttentionAt: 500,
      lastReadAt: 500,
    });
    renderRoutes(
      "/threads",
      makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({ threads: [snoozed] })],
      }),
    );
    expect(await screen.findByText("Sleeping thread")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Snoozed/ })).toBeTruthy();
    expect(screen.getByText("3h").getAttribute("title")).toMatch(/^Wakes /);
  });

  it("shows an empty state without threads", async () => {
    renderRoutes(
      "/threads",
      makeSidebarBootstrapResponse({
        projects: [makeProjectWithThreadsResponse({ threads: [] })],
      }),
    );
    expect(await screen.findByText("No threads yet")).toBeTruthy();
  });

  it("redirects the legacy settings and project archive URLs", async () => {
    for (const legacy of [
      "/settings/archived",
      "/projects/proj_test/archived",
      "/archived",
    ]) {
      renderRoutes(legacy);
      await waitFor(() => expect(location()).toBe("/threads?status=archived"));
      cleanup();
    }
  });
});
