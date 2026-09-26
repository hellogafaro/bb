// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarQuickActions } from "./SidebarQuickActions";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(() => true) }));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    getShortcutCommand: () => null,
    isCommandAvailable: () => true,
  }),
}));

afterEach(() => {
  cleanup();
  mocks.dispatch.mockClear();
});

describe("SidebarQuickActions", () => {
  it("runs the palette and new-thread commands without shortcut hints", () => {
    const onAction = vi.fn();
    render(<SidebarQuickActions onAction={onAction} />);
    const search = screen.getByRole("button", { name: "Search" });
    const newThread = screen.getByRole("button", { name: "New thread" });
    expect(document.querySelector("kbd")).toBeNull();

    fireEvent.click(search);
    expect(mocks.dispatch).toHaveBeenCalledWith("palette.open", search);
    fireEvent.click(newThread);
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.new", newThread);
    expect(onAction).toHaveBeenCalledTimes(2);
  });
});
