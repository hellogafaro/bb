// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppToastContent } from "./app-toast";

afterEach(() => {
  cleanup();
});

describe("AppToastContent", () => {
  it("keeps text details behind Show more on a single row with actions", () => {
    render(
      <AppToastContent
        action={{ label: "View log", onClick: vi.fn() }}
        cancel={{ label: "Dismiss", onClick: vi.fn() }}
        description="A deliberately long detail"
        notificationId="notification-1"
        title="A deliberately long visual bell title"
        tone="error"
      />,
    );

    expect(
      screen.getByTestId("app-toast-title").classList.contains("truncate"),
    ).toBe(true);
    expect(screen.queryByText("A deliberately long detail")).toBeNull();
    expect(screen.getByRole("button", { name: "Show more" })).toBeDefined();
    expect(screen.getByRole("button", { name: "View log" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Dismiss" })).toBeDefined();
    expect(
      screen.getByRole("button", { name: "Dismiss notification" }),
    ).toBeDefined();
  });

  it("shows a custom description inline after the title", () => {
    const onOpen = vi.fn();
    render(
      <AppToastContent
        description={
          <button type="button" onClick={onOpen}>
            Archived thread
          </button>
        }
        notificationId="notification-2"
        title="Thread archived"
        tone="success"
      />,
    );

    const description = screen.getByTestId("app-toast-description");
    expect(
      description.contains(
        screen.getByRole("button", { name: "Archived thread" }),
      ),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
  });

  it("uses the working-status loading glyph", () => {
    const { container } = render(
      <AppToastContent title="Creating commit" tone="loading" />,
    );

    expect(container.querySelector('[data-icon="Loading"]')).not.toBeNull();
  });

  it("neutralizes Sonner margins on custom toast icons", () => {
    const { container } = render(
      <AppToastContent title="Thread archived" tone="success" />,
    );

    expect(
      container.querySelector<SVGElement>('[data-icon="CircleCheck"]')?.style
        .margin,
    ).toBe("0px");
    expect(
      container.querySelector<SVGElement>('[data-icon="X"]')?.style.margin,
    ).toBe("0px");
  });

  it("dismisses from the visible close control", () => {
    const onDismiss = vi.fn();
    render(
      <AppToastContent
        onDismiss={onDismiss}
        title="Plugin settings saved"
        tone="success"
      />,
    );

    screen.getByRole("button", { name: "Dismiss notification" }).click();

    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
