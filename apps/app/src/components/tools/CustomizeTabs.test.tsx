// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CustomizeTabs } from "./CustomizeTabs";
import type { CustomizeTab } from "./customize-navigation";

function LocationPath() {
  const location = useLocation();
  return (
    <span data-testid="location">
      {location.pathname}
      {location.search}
    </span>
  );
}

function renderTabs(active: CustomizeTab, initialPath: string) {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <CustomizeTabs active={active} />
      <LocationPath />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe("CustomizeTabs", () => {
  it("marks the active tab", () => {
    renderTabs("mcps", "/customize/mcps");
    expect(
      screen.getByRole("tab", { name: "MCPs" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Skills" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("opens the MCPs tab from Skills", () => {
    renderTabs("skills", "/customize");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCPs" }));
    expect(screen.getByTestId("location").textContent).toBe("/customize/mcps");
  });

  it("opens the Skills tab from an MCP detail", () => {
    renderTabs("mcps", "/customize/mcps/github");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByTestId("location").textContent).toBe("/customize");
  });

  it("stays put when the active tab is pressed again", () => {
    renderTabs("mcps", "/customize/mcps/github");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCPs" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/customize/mcps/github",
    );
  });
});
