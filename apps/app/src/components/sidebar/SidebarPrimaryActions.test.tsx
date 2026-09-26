// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProjectListSearchAction } from "./SidebarPrimaryActions";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  modifierHeld: false,
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: (command: string) =>
    command === "palette.open"
      ? { ariaKeyshortcuts: "Meta+K", label: "⌘K" }
      : null,
  useIsAppCommandModifierHeld: () => mocks.modifierHeld,
}));

afterEach(() => {
  mocks.modifierHeld = false;
  cleanup();
  mocks.dispatch.mockReset();
});

describe("ProjectListSearchAction", () => {
  it("reveals the reserved trailing Search shortcut on hover or focus without changing activation", () => {
    const onSearch = vi.fn();
    render(<ProjectListSearchAction onSearch={onSearch} />);

    const button = screen.getByRole("button", {
      name: "Search (⌘K)",
    });
    const shortcut = screen.getByText("⌘K");
    const label = screen.getByText("Search");

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
    expect(shortcut.tagName).toBe("KBD");
    expect(shortcut.getAttribute("aria-hidden")).toBe("true");
    expect(label.classList.contains("flex-1")).toBe(true);
    const shortcutSlot = shortcut.parentElement;
    expect(shortcutSlot?.lastElementChild).toBe(shortcut);
    expect(button.classList.contains("group/search")).toBe(true);
    expect(shortcutSlot?.classList.contains("opacity-0")).toBe(true);
    expect(
      shortcutSlot?.classList.contains("group-hover/search:opacity-100"),
    ).toBe(true);
    expect(
      shortcutSlot?.classList.contains(
        "group-focus-visible/search:opacity-100",
      ),
    ).toBe(true);
    expect(
      shortcutSlot?.classList.contains("max-md:pointer-coarse:hidden"),
    ).toBe(true);
    expect(button.classList.contains("pr-1")).toBe(false);

    fireEvent.click(button);

    expect(onSearch).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("palette.open", button);
  });

  it("shows the search shortcut while the command modifier is held", () => {
    mocks.modifierHeld = true;
    render(<ProjectListSearchAction />);
    const shortcutSlot = screen.getByText("⌘K").parentElement;
    expect(shortcutSlot?.classList.contains("opacity-100")).toBe(true);
    expect(shortcutSlot?.classList.contains("opacity-0")).toBe(false);
  });
});
