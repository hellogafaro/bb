// @vitest-environment jsdom

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BUILT_IN_SIDEBAR_NAVIGATION_KEYS,
  DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER,
} from "@/components/plugin/pluginNavSidebarOrder";
import { BuiltInSidebarNavigation } from "./BuiltInSidebarNavigation";

vi.mock("@/components/plugin/PluginNavSidebarItems", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@/components/plugin/PluginNavSidebarItems")
    >();
  return {
    ResourceNavSidebarItem: actual.ResourceNavSidebarItem,
    PluginNavSidebarItems: ({
      builtInEntries = [],
    }: {
      builtInEntries?: Array<{ id: string; content: ReactNode }>;
    }) => (
      <div>
        {builtInEntries.map((entry) => (
          <div key={entry.id} data-testid={`entry-${entry.id}`}>
            {entry.content}
          </div>
        ))}
      </div>
    ),
  };
});
vi.mock("./SidebarPrimaryActions", () => ({
  ProjectListNewThreadAction: () => <button type="button">New thread</button>,
  ProjectListSearchAction: () => <button type="button">Search</button>,
}));

function Pathname() {
  return <span data-testid="pathname">{useLocation().pathname}</span>;
}

function renderNavigation(initialEntry: string, onNavigate = vi.fn()) {
  render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <BuiltInSidebarNavigation
        onNavigate={onNavigate}
        onNewChat={vi.fn()}
        onSearch={vi.fn()}
        splitEnabled={false}
      />
      <Pathname />
    </MemoryRouter>,
  );
  return onNavigate;
}

afterEach(() => {
  cleanup();
});

describe("BuiltInSidebarNavigation", () => {
  it("lists New thread, Search, and Threads without Customize or Agents", () => {
    renderNavigation("/");

    const entries = screen
      .getAllByTestId(/^entry-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(entries).toEqual([
      "entry-new-thread",
      "entry-search-threads",
      "entry-threads",
    ]);
    expect(screen.queryByRole("button", { name: "Customize" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
  });

  it("opens /threads from the Threads entry", () => {
    const onNavigate = renderNavigation("/");

    fireEvent.click(screen.getByRole("button", { name: "Threads" }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("pathname").textContent).toBe("/threads");
  });

  it("marks Threads active on its route, including the archived tab", () => {
    renderNavigation("/threads?status=archived");

    expect(
      screen
        .getByRole("button", { name: "Threads" })
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("leaves Threads inactive on other routes", () => {
    renderNavigation("/settings/agents");

    expect(
      screen
        .getByRole("button", { name: "Threads" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("orders Threads right after Search by default", () => {
    expect(DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER.slice(0, 3)).toEqual([
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.newThread,
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.searchThreads,
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.threads,
    ]);
    expect(DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER).not.toContain(
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.skills,
    );
    expect(DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER).not.toContain(
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.agents,
    );
  });
});
