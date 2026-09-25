// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@bb/domain";
import type { SidebarBootstrapResponse } from "@bb/server-contract";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";
import { makeProjectWithThreadsResponse } from "@/test/fixtures/projects";
import { sidebarNavigationQueryKey } from "@/hooks/queries/query-keys";
import { SidebarProvider } from "@/components/ui/sidebar";
import {
  collapsedStatusSectionsAtom,
  collapsedThreadIdsAtom,
} from "../sidebarCollapsedAtoms";
import { StatusThreadList } from "./StatusThreadList";

const mocks = vi.hoisted(() => ({
  snooze: vi.fn(),
  unsnooze: vi.fn(),
  markUnread: vi.fn(),
  togglePin: vi.fn(),
  scheduleUiPreferenceWrite: vi.fn(),
}));

function offlineSdk(path = "sdk"): unknown {
  return new Proxy(function sdkStub() {}, {
    apply: () => Promise.reject(new Error(`test: ${path} is offline`)),
    get: (_target, key) =>
      typeof key === "string" && key !== "then"
        ? offlineSdk(`${path}.${key}`)
        : undefined,
  });
}

vi.mock("@/lib/sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/sdk")>();
  const offline = offlineSdk() as Record<string, unknown>;
  return {
    ...actual,
    sdk: new Proxy(offline, {
      get: (target, key) =>
        key === "threads"
          ? new Proxy(target.threads as Record<string, unknown>, {
              get: (threads, method) =>
                method === "snooze"
                  ? mocks.snooze
                  : method === "unsnooze"
                    ? mocks.unsnooze
                    : method === "markUnread"
                      ? mocks.markUnread
                      : threads[method as string],
            })
          : target[key as string],
    }),
  };
});

vi.mock("@/lib/ws", () => ({
  wsManager: new Proxy(
    {},
    {
      get: (_target, key) =>
        key === "onPluginSignal" ? () => () => {} : () => undefined,
    },
  ),
}));

vi.mock("@/lib/ui-preferences/ui-preferences-sync", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/lib/ui-preferences/ui-preferences-sync")
  >()),
  scheduleUiPreferenceWrite: mocks.scheduleUiPreferenceWrite,
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    generateTitle: vi.fn(),
    generatingTitleIds: new Set<string>(),
    renameThreadAsync: vi.fn(),
    requestDelete: vi.fn(),
    requestRename: vi.fn(),
    togglePin: mocks.togglePin,
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
  }),
}));

const NOW = Date.UTC(2026, 8, 25, 10, 0, 0);
const HOUR_MS = 60 * 60 * 1_000;

let sequence = 0;
function thread(overrides: Parameters<typeof makeThreadListEntry>[0] = {}) {
  sequence += 1;
  return makeThreadListEntry({
    id: `thr_${sequence}`,
    projectId: "proj_app",
    title: `Thread ${sequence}`,
    titleFallback: null,
    createdAt: NOW - 10 * HOUR_MS,
    updatedAt: NOW - HOUR_MS,
    latestAttentionAt: NOW - HOUR_MS,
    lastReadAt: NOW - HOUR_MS,
    ...overrides,
  });
}

function bootstrap(threads: ThreadListEntry[]): SidebarBootstrapResponse {
  return {
    sections: [],
    projects: [
      makeProjectWithThreadsResponse({
        id: "proj_app",
        name: "App",
        threads: threads.filter((entry) => entry.projectId === "proj_app"),
      }),
    ],
    personalProject: makeProjectWithThreadsResponse({
      id: PERSONAL_PROJECT_ID,
      name: "Personal",
      threads: threads.filter(
        (entry) => entry.projectId === PERSONAL_PROJECT_ID,
      ),
    }),
  };
}

let navigateTo: (path: string) => void = () => undefined;
function NavigationProbe() {
  const navigate = useNavigate();
  navigateTo = (path) => {
    void navigate(path);
  };
  return null;
}

function renderList(
  threads: ThreadListEntry[],
  { path = "/", store = createStore() } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  queryClient.setQueryData(sidebarNavigationQueryKey(), bootstrap(threads));
  const view = render(
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <MemoryRouter initialEntries={[path]}>
          <NavigationProbe />
          <TooltipProvider>
            <SidebarProvider>
              <StatusThreadList onNavigate={() => undefined} />
            </SidebarProvider>
          </TooltipProvider>
        </MemoryRouter>
      </JotaiProvider>
    </QueryClientProvider>,
  );
  return { ...view, queryClient, store };
}

function section(container: HTMLElement, id: string): HTMLElement {
  const element = container.querySelector<HTMLElement>(
    `[data-sidebar-section-id="${id}"]`,
  );
  if (!element) throw new Error(`missing section ${id}`);
  return element;
}

function rowLink(name: string): HTMLElement {
  return screen.getByRole("link", { name: `Open ${name}` });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"], now: NOW });
  mocks.snooze.mockReset();
  mocks.unsnooze.mockReset();
  mocks.markUnread.mockReset();
  mocks.togglePin.mockReset();
  mocks.scheduleUiPreferenceWrite.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

describe("StatusThreadList", () => {
  it("shows Pinned, Waiting, Ready, Working, Done, and Snoozed in order with counts", () => {
    const threads = [
      thread({ title: "Done one" }),
      thread({ title: "Snoozed one", snoozedUntil: NOW + HOUR_MS }),
      thread({ title: "Ready one", lastReadAt: 0 }),
      thread({
        title: "Working one",
        status: "active",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
      thread({ title: "Waiting one", hasPendingInteraction: true }),
      thread({ title: "Pinned one", pinnedAt: NOW - HOUR_MS }),
      thread({ title: "Done two" }),
    ];
    const { container } = renderList(threads);

    expect(
      [...container.querySelectorAll("[data-sidebar-section-id]")].map(
        (element) => element.getAttribute("data-sidebar-section-id"),
      ),
    ).toEqual([
      "pinned",
      "section:status-waiting",
      "section:status-ready",
      "section:status-working",
      "section:status-done",
      "section:status-snoozed",
    ]);
    expect(section(container, "pinned").textContent).toContain("Pinned1");
    expect(section(container, "section:status-done").textContent).toContain(
      "Done2",
    );
    for (const entry of threads) {
      expect(
        screen.getAllByRole("link", { name: `Open ${entry.title}` }),
      ).toHaveLength(1);
    }
    expect(
      within(section(container, "section:status-snoozed")).getByRole("link", {
        name: "Open Snoozed one",
      }),
    ).toBeDefined();
    expect(
      within(section(container, "pinned")).getByRole("link", {
        name: "Open Pinned one",
      }),
    ).toBeDefined();
  });

  it("omits empty sections and shows an empty state with no threads", () => {
    const { container, unmount } = renderList([thread({ title: "Only" })]);
    expect(
      [...container.querySelectorAll("[data-sidebar-section-id]")].map(
        (element) => element.getAttribute("data-sidebar-section-id"),
      ),
    ).toEqual(["section:status-done"]);
    unmount();
    renderList([]);
    expect(screen.getByText("No threads")).toBeDefined();
  });

  it("hides archived and hidden threads", () => {
    renderList([
      thread({ title: "Visible" }),
      thread({ title: "Archived", archivedAt: NOW - HOUR_MS }),
      thread({ title: "Hidden", visibility: "hidden" }),
    ]);
    expect(rowLink("Visible")).toBeDefined();
    expect(screen.queryByRole("link", { name: "Open Archived" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Open Hidden" })).toBeNull();
  });

  it("nests child threads under their parent and collapses them with the chevron", () => {
    const parent = thread({ title: "Parent" });
    const child = thread({ title: "Child", parentThreadId: parent.id });
    const { store } = renderList([parent, child]);

    expect(rowLink("Child")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Collapse Parent threads" }));

    expect(store.get(collapsedThreadIdsAtom)).toEqual([parent.id]);
    expect(screen.queryByRole("link", { name: "Open Child" })).toBeNull();
    expect(
      screen.getByRole("button", { name: "Expand Parent threads" }),
    ).toBeDefined();
  });

  it("persists a collapsed status section through ui preferences", () => {
    const { container, store } = renderList([thread({ title: "Done one" })]);

    fireEvent.click(screen.getByRole("button", { name: "Collapse Done section" }));

    expect(store.get(collapsedStatusSectionsAtom)).toEqual(["done"]);
    expect(mocks.scheduleUiPreferenceWrite).toHaveBeenCalledWith(
      "sidebar.collapsedStatusSections",
      expect.any(Function),
    );
    expect(
      within(section(container, "section:status-done")).queryByRole("link"),
    ).toBeNull();
  });

  it("reveals the section of a thread the user navigates to", async () => {
    const target = thread({ title: "Target" });
    const store = createStore();
    store.set(collapsedStatusSectionsAtom, ["done", "ready"]);
    renderList([target, thread({ title: "Other", lastReadAt: 0 })], { store });

    act(() => navigateTo(`/projects/proj_app/threads/${target.id}`));

    await waitFor(() =>
      expect(store.get(collapsedStatusSectionsAtom)).toEqual(["ready"]),
    );
    expect(rowLink("Target")).toBeDefined();
  });

  it("snoozes a thread from the row's quick action and moves it to Snoozed", async () => {
    const quiet = thread({ title: "Quiet" });
    mocks.snooze.mockImplementation(({ until }: { until: number }) =>
      Promise.resolve({ ...quiet, snoozedUntil: until }),
    );
    const { container } = renderList([quiet]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Snooze thread" }),
      { button: 0 },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: /In 1 hour/ }));

    await waitFor(() =>
      expect(mocks.snooze).toHaveBeenCalledWith({
        threadId: quiet.id,
        until: NOW + HOUR_MS,
      }),
    );
    await waitFor(() =>
      expect(
        within(section(container, "section:status-snoozed")).getByRole("link", {
          name: "Open Quiet",
        }),
      ).toBeDefined(),
    );
  });

  it("wakes a snoozed thread from the row menu", async () => {
    const sleeping = thread({
      title: "Sleeping",
      snoozedUntil: NOW + 2 * HOUR_MS,
    });
    mocks.unsnooze.mockImplementation(() =>
      Promise.resolve({ ...sleeping, snoozedUntil: null }),
    );
    const { container } = renderList([sleeping]);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Unsnooze · wakes in 2h" }),
    );

    await waitFor(() =>
      expect(mocks.unsnooze).toHaveBeenCalledWith({ threadId: sleeping.id }),
    );
    await waitFor(() =>
      expect(
        within(section(container, "section:status-done")).getByRole("link", {
          name: "Open Sleeping",
        }),
      ).toBeDefined(),
    );
  });

  it("does not offer snooze on pinned threads or working threads", () => {
    renderList([
      thread({ title: "Pinned", pinnedAt: NOW }),
      thread({
        title: "Busy",
        status: "active",
        runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
      }),
      thread({ title: "Idle" }),
    ]);
    expect(screen.getAllByRole("button", { name: "Snooze thread" })).toHaveLength(
      2,
    );
  });

  it("pins from the row's quick action", () => {
    const loose = thread({ title: "Loose" });
    renderList([loose]);
    fireEvent.click(screen.getByRole("button", { name: "Pin thread" }));
    expect(mocks.togglePin).toHaveBeenCalledWith(
      expect.objectContaining({ id: loose.id }),
    );
  });

  it("keeps an opened unread thread in Ready for five seconds and marks it unread if left sooner", async () => {
    const unread = thread({ title: "Fresh", lastReadAt: 0 });
    const { container, queryClient } = renderList([unread]);
    mocks.markUnread.mockResolvedValue({ ...unread, lastReadAt: null });

    act(() => navigateTo(`/projects/proj_app/threads/${unread.id}`));
    act(() => {
      queryClient.setQueryData(
        sidebarNavigationQueryKey(),
        bootstrap([{ ...unread, lastReadAt: NOW }]),
      );
    });

    expect(
      within(section(container, "section:status-ready")).getByRole("link", {
        name: "Open Fresh",
      }),
    ).toBeDefined();

    act(() => navigateTo("/"));

    await waitFor(() =>
      expect(mocks.markUnread).toHaveBeenCalledWith(
        expect.objectContaining({ threadId: unread.id }),
      ),
    );
  });
});
