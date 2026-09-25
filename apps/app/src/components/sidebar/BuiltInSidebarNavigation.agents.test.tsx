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

afterEach(() => {
  cleanup();
});

describe("BuiltInSidebarNavigation agents entry", () => {
  it("lists Agents after Customize and opens /agents", () => {
    const onNavigate = vi.fn();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <BuiltInSidebarNavigation
          onNavigate={onNavigate}
          onNewChat={vi.fn()}
          onSearch={vi.fn()}
          splitEnabled={false}
        />
        <Pathname />
      </MemoryRouter>,
    );

    const entries = screen
      .getAllByTestId(/^entry-/)
      .map((element) => element.getAttribute("data-testid"));
    expect(entries).toEqual([
      "entry-new-thread",
      "entry-search-threads",
      "entry-skills",
      "entry-agents",
    ]);

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    expect(onNavigate).toHaveBeenCalledOnce();
    expect(screen.getByTestId("pathname").textContent).toBe("/agents");
  });

  it("orders Agents right after Automations by default", () => {
    expect(DEFAULT_BUILT_IN_SIDEBAR_NAVIGATION_ORDER.slice(-2)).toEqual([
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.automations,
      BUILT_IN_SIDEBAR_NAVIGATION_KEYS.agents,
    ]);
    expect(BUILT_IN_SIDEBAR_NAVIGATION_KEYS.agents).toBe("__bb__/agents");
  });
});
