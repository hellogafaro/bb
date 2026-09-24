// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";
import { CustomizeTabs, type CustomizeTab } from "./CustomizeTabs";

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
    renderTabs("mcps", "/plugins/mcps/mcps");
    expect(
      screen.getByRole("tab", { name: "MCPs" }).getAttribute("aria-selected"),
    ).toBe("true");
    expect(
      screen.getByRole("tab", { name: "Skills" }).getAttribute("aria-selected"),
    ).toBe("false");
  });

  it("opens the mcps plugin panel from Skills", () => {
    renderTabs("skills", "/skills?view=library");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "MCPs" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/plugins/mcps/mcps",
    );
  });

  it("opens the skills library from MCPs", () => {
    renderTabs("mcps", "/plugins/mcps/mcps");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByTestId("location").textContent).toBe(
      "/skills?view=library",
    );
  });

  it("stays put when the active tab is pressed again", () => {
    renderTabs("skills", "/skills");
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Skills" }));
    expect(screen.getByTestId("location").textContent).toBe("/skills");
  });
});
