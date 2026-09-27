// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { SidebarProvider } from "@/components/ui/sidebar";
import { ResourceSidebar } from "./ResourceSidebar";

afterEach(cleanup);

function renderSidebarAt(path: string, appRoutePath = "/") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SidebarProvider>
        <ResourceSidebar
          appRoutePath={appRoutePath}
          isResizing={false}
          onResizeMouseDown={() => {}}
        />
      </SidebarProvider>
    </MemoryRouter>,
  );
}

const row = (name: string) => screen.getByRole("link", { name });

describe("Plugins sidebar", () => {
  it("owns only the Plugins pages and the app back target", () => {
    renderSidebarAt("/plugins", "/projects/proj_one");

    expect(screen.getByText("Plugins")).toBeTruthy();
    expect(row("Browse plugins").getAttribute("href")).toBe("/plugins");
    expect(row("Installed plugins").getAttribute("href")).toBe(
      "/plugins?view=installed",
    );
    expect(row("Browse plugins").querySelector("svg")).toBeNull();
    expect(row("Installed plugins").querySelector("svg")).toBeNull();
    expect(screen.queryByText("Skills")).toBeNull();
    expect(screen.queryByRole("link", { name: "Browse skills" })).toBeNull();
    expect(screen.queryByRole("link", { name: "My skills" })).toBeNull();
    expect(row("Back to app").getAttribute("href")).toBe("/projects/proj_one");
  });

  it.each([
    ["/plugins", "Browse plugins"],
    ["/plugins?view=installed", "Installed plugins"],
    ["/plugins/github", "Browse plugins"],
    ["/plugins/github?view=installed", "Installed plugins"],
  ])("marks %s as %s", (path, expected) => {
    renderSidebarAt(path);

    expect(row(expected).getAttribute("aria-current")).toBe("page");
  });
});
