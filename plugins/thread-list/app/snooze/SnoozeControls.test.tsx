// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomSnoozeDialog } from "./SnoozeControls.js";

vi.mock("./snooze-state.js", () => ({ useThreadSnoozeState: () => null }));

function renderDialog(onSnooze = vi.fn(), onClose = vi.fn()) {
  render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <CustomSnoozeDialog
        threadId="thread-snooze"
        onSnooze={onSnooze}
        onClose={onClose}
      />
    </CompactViewportOverrideProvider>,
  );
  return { onSnooze, onClose };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CustomSnoozeDialog", () => {
  it("shows the calendar inline and submits the selected local date and time", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12));
    const { onSnooze, onClose } = renderDialog();
    expect(screen.getByRole("grid")).toBeTruthy();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Tomorrow" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /September 27/ }));
    fireEvent.change(screen.getByLabelText("Time"), {
      target: { value: "14:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    expect(onSnooze).toHaveBeenCalledWith(
      "thread-snooze",
      new Date(2026, 8, 27, 14, 30).getTime(),
    );
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("rejects a time that passed while the dialog was open", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12));
    const { onSnooze, onClose } = renderDialog();
    vi.setSystemTime(new Date(2026, 8, 26, 10));
    fireEvent.click(screen.getByRole("button", { name: "Snooze" }));
    expect(onSnooze).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("disables submission for an empty time and cancels without snoozing", () => {
    const { onSnooze, onClose } = renderDialog();
    fireEvent.change(screen.getByLabelText("Time"), { target: { value: "" } });
    expect(
      screen.getByRole<HTMLButtonElement>("button", {
        name: "Snooze",
      }).disabled,
    ).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onSnooze).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });
});
