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
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "./CommandPalette";
import { makeThreadListEntry } from "@bb/test-helpers/domain-fixtures";

const test = vi.hoisted(() => ({
  handlers: new Map<
    string,
    (invocation: { target: EventTarget | null }) => boolean
  >(),
  navigate: vi.fn(),
  query: vi.fn(),
  dispatch: vi.fn(),
}));
let currentClient: QueryClient;

vi.mock("./AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    isCommandAvailable: () => true,
    dispatch: test.dispatch,
    getShortcutCommand: () => null,
  }),
  useAppCommandShortcuts: () => new Map(),
  useAppCommandHandler: (
    id: string,
    handler: (invocation: { target: EventTarget | null }) => boolean,
  ) => {
    test.handlers.set(id, handler);
  },
  useIndexedAppCommandHandlers: () => {},
}));
vi.mock("@/lib/sdk", () => ({ sdk: { search: { query: test.query } } }));
vi.mock("@/components/ui/app-route-anchor", () => ({
  useRouteNavigate: () => test.navigate,
}));
vi.mock("@/lib/plugin-slots", () => {
  const slots = { commandPaletteActions: [] };
  return { usePluginSlots: () => slots };
});
vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({
    data: {
      projects: [],
      personalProject: { id: "personal", name: "Personal", threads: [] },
    },
  }),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: [] }),
}));
vi.mock("@/hooks/useHostDaemon", () => ({
  useLocalHostDaemonAccess: () => ({ accessState: "unavailable" }),
  useHostDaemon: () => ({ hasDaemon: false }),
}));
vi.mock("@/lib/bb-desktop", () => ({ getBbDesktopInfo: () => null }));

function setup() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  currentClient = client;
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <button type="button" data-testid="origin">
          Origin
        </button>
        <CommandPalette threadId={null} projectId={null} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const origin = screen.getByTestId("origin");
  origin.focus();
  act(() => {
    test.handlers.get("palette.open")?.({ target: origin });
  });
  return origin;
}

function result(overrides: Record<string, unknown> = {}) {
  return {
    id: "thread:t1",
    kind: "thread",
    label: "Thread title",
    subtitle: "Project",
    matchClass: 1,
    highlights: [],
    destination: "/projects/p1/threads/t1",
    threadId: "t1",
    projectId: "p1",
    archived: false,
    status: "idle",
    updatedAt: 1,
    thread: makeThreadListEntry({ id: "t1" }),
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  test.handlers.clear();
  test.query.mockReset();
  test.navigate.mockReset();
  test.dispatch.mockReset();
  localStorage.clear();
});

describe("global Search", () => {
  it("opens the same empty panel from the compatibility alias and focuses one input", () => {
    setup();
    expect(screen.getByRole("dialog", { name: "Search" })).toBeTruthy();
    const input = screen.getByRole("combobox", { name: "Search" });
    expect(input.getAttribute("placeholder")).toBe("Search anything…");
    fireEvent.change(input, { target: { value: "theme" } });
    act(() => {
      test.handlers.get("thread.search")?.({ target: input });
    });
    expect((input as HTMLInputElement).value).toBe("theme");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText("Search threads")).toBeNull();
  });

  it("shows local settings while remote results load and keeps a user-selected row when they arrive", async () => {
    let resolve: (value: unknown) => void = () => {};
    test.query.mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "theme" } });
    const settings = await screen.findByRole("group", { name: "Settings" });
    expect(within(settings).getAllByRole("option").length).toBeGreaterThan(0);
    fireEvent.keyDown(input, { key: "ArrowDown" });
    const selected = screen
      .getAllByRole("option")
      .find((option) => option.getAttribute("aria-selected") === "true");
    const selectedText = selected?.textContent;
    await act(async () => {
      resolve({
        query: "theme",
        groups: [
          {
            kind: "threads",
            results: [
              result({
                id: "thread:theme",
                label: "Theme discussion",
                matchClass: 1,
              }),
            ],
          },
        ],
      });
    });
    expect(
      screen
        .getAllByRole("option")
        .find((option) => option.getAttribute("aria-selected") === "true")
        ?.textContent,
    ).toBe(selectedText);
  });

  it("opens a message result at its anchor and marks archived rows", async () => {
    test.query.mockResolvedValue({
      query: "message",
      groups: [
        {
          kind: "threads",
          results: [
            result({
              archived: true,
              messageAnchor: 42,
              snippet: "matched message",
            }),
          ],
        },
      ],
    });
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "message" } });
    const row = await screen.findByRole("option", { name: /Thread title/ });
    expect(row.textContent).toContain("Archived");
    fireEvent.click(row);
    await waitFor(() =>
      expect(test.navigate).toHaveBeenCalledWith(expect.any(String), {
        state: { searchMessageSeq: 42, searchThreadId: "t1" },
      }),
    );
  });

  it("shows pending interaction status for a remote thread outside the sidebar", async () => {
    test.query.mockResolvedValue({
      query: "thread",
      groups: [
        {
          kind: "threads",
          results: [
            result({
              thread: makeThreadListEntry({
                id: "t1",
                hasPendingInteraction: true,
              }),
            }),
          ],
        },
      ],
    });
    setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), {
      target: { value: "thread" },
    });
    const row = await screen.findByRole("option", { name: /Thread title/ });
    expect(
      within(row).getByRole("img", { name: /needs user input/i }),
    ).toBeTruthy();
  });

  it("does not activate a result while confirming IME composition", async () => {
    test.query.mockResolvedValue({
      query: "message",
      groups: [{ kind: "threads", results: [result()] }],
    });
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "message" } });
    await screen.findByRole("option", { name: /Thread title/ });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(test.navigate).not.toHaveBeenCalled();
  });

  it("ignores results from an earlier query and keeps the new query active", async () => {
    const pending = new Map<string, (value: unknown) => void>();
    test.query.mockImplementation(
      ({ query }: { query: string }) =>
        new Promise((resolve) => {
          pending.set(query, resolve);
        }),
    );
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "first" } });
    await waitFor(() => expect(pending.has("first")).toBe(true));
    fireEvent.change(input, { target: { value: "second" } });
    await waitFor(() => expect(pending.has("second")).toBe(true));
    await act(async () => {
      pending.get("first")?.({
        query: "first",
        groups: [
          {
            kind: "threads",
            results: [result({ id: "thread:old", label: "Old thread" })],
          },
        ],
      });
    });
    expect(screen.queryByRole("option", { name: /Old thread/ })).toBeNull();
    await act(async () => {
      pending.get("second")?.({
        query: "second",
        groups: [
          {
            kind: "threads",
            results: [result({ id: "thread:new", label: "New thread" })],
          },
        ],
      });
    });
    expect(
      await screen.findByRole("option", { name: /New thread/ }),
    ).toBeTruthy();
  });

  it("expands only the requested group and drops a late page after the query changes", async () => {
    let resolvePage: (value: unknown) => void = () => {};
    test.query.mockImplementation(
      ({ query, cursor }: { query: string; cursor?: string }) => {
        if (cursor)
          return new Promise((resolve) => {
            resolvePage = resolve;
          });
        return Promise.resolve({
          query,
          groups: [
            { kind: "threads", results: [result()], nextCursor: "next" },
          ],
        });
      },
    );
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "thread" } });
    const more = await screen.findByRole("option", {
      name: /Show more threads/,
    });
    fireEvent.click(more);
    await waitFor(() =>
      expect(test.query).toHaveBeenCalledWith(
        expect.objectContaining({ cursor: "next" }),
      ),
    );
    fireEvent.change(input, { target: { value: "other" } });
    await act(async () => {
      resolvePage({
        query: "thread",
        groups: [
          {
            kind: "threads",
            results: [result({ id: "thread:late", label: "Late thread" })],
          },
        ],
      });
    });
    expect(screen.queryByRole("option", { name: /Late thread/ })).toBeNull();
  });

  it("discards expanded pages and their cursor when the base results refresh", async () => {
    let refreshed = false;
    test.query.mockImplementation(({ cursor }: { cursor?: string }) => {
      if (cursor === "old-next")
        return Promise.resolve({
          query: "thread",
          groups: [
            {
              kind: "threads",
              results: [result({ id: "thread:stale", label: "Stale thread" })],
            },
          ],
        });
      if (cursor === "new-next")
        return Promise.resolve({
          query: "thread",
          groups: [
            {
              kind: "threads",
              results: [
                result({ id: "thread:continued", label: "Continued thread" }),
              ],
            },
          ],
        });
      return Promise.resolve({
        query: "thread",
        groups: [
          {
            kind: "threads",
            results: [
              result({
                id: refreshed ? "thread:fresh" : "thread:original",
                label: refreshed ? "Fresh thread" : "Original thread",
              }),
            ],
            nextCursor: refreshed ? "new-next" : "old-next",
          },
        ],
      });
    });
    setup();
    fireEvent.change(screen.getByRole("combobox", { name: "Search" }), {
      target: { value: "thread" },
    });
    fireEvent.click(
      await screen.findByRole("option", { name: /Show more threads/ }),
    );
    await screen.findByRole("option", { name: /Stale thread/ });
    refreshed = true;
    await act(async () => {
      await currentClient.invalidateQueries({ queryKey: ["global-search"] });
    });
    await screen.findByRole("option", { name: /Fresh thread/ });
    expect(screen.queryByRole("option", { name: /Stale thread/ })).toBeNull();
    fireEvent.click(screen.getByRole("option", { name: /Show more threads/ }));
    await screen.findByRole("option", { name: /Continued thread/ });
    expect(test.query).toHaveBeenCalledWith(
      expect.objectContaining({ cursor: "new-next" }),
    );
  });

  it.each([{ ctrlKey: true }, { metaKey: true }])(
    "opens threads normally with modified Enter (%j)",
    async (modifier) => {
      test.query.mockResolvedValue({
        query: "thread",
        groups: [{ kind: "threads", results: [result()] }],
      });
      setup();
      const input = screen.getByRole("combobox", { name: "Search" });
      fireEvent.change(input, { target: { value: "thread" } });
      await screen.findByRole("option", { name: /Thread title/ });
      fireEvent.keyDown(input, { key: "Enter", ...modifier });
      await waitFor(() =>
        expect(test.navigate).toHaveBeenCalledWith("/projects/p1/threads/t1", {
          state: undefined,
        }),
      );
    },
  );

  it("selects the next thread in its group when the selected thread disappears", async () => {
    let response = [
      result({ id: "thread:first", label: "First thread" }),
      result({ id: "thread:second", label: "Second thread" }),
      result({ id: "thread:third", label: "Third thread" }),
    ];
    test.query.mockImplementation(async () => ({
      query: "thread",
      groups: [{ kind: "threads", results: response }],
    }));
    setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "thread" } });
    const second = await screen.findByRole("option", { name: /Second thread/ });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(second.getAttribute("aria-selected")).toBe("true");
    response = [response[0]!, response[2]!];
    await act(async () => {
      await currentClient.invalidateQueries({ queryKey: ["global-search"] });
    });
    await waitFor(() =>
      expect(
        screen
          .getByRole("option", { name: /Third thread/ })
          .getAttribute("aria-selected"),
      ).toBe("true"),
    );
  });

  it("restores the invoking element's focus before navigating", async () => {
    test.query.mockResolvedValue({
      query: "thread",
      groups: [{ kind: "threads", results: [result()] }],
    });
    const origin = setup();
    const input = screen.getByRole("combobox", { name: "Search" });
    fireEvent.change(input, { target: { value: "thread" } });
    fireEvent.click(
      await screen.findByRole("option", { name: /Thread title/ }),
    );
    await waitFor(() => expect(test.navigate).toHaveBeenCalled());
    expect(document.activeElement).toBe(origin);
  });
});
