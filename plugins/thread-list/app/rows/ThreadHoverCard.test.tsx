// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeSidebarThread } from "../model/fixtures.js";
import { toSidebarThread } from "../model/sidebar-thread.js";
import { ThreadHoverCard } from "./ThreadHoverCard.js";

const sdk = vi.hoisted(() => ({
  threads: { defaultExecutionOptions: vi.fn(async () => null) },
  providers: { models: vi.fn(async () => ({ models: [] })) },
}));
vi.mock("@get-bb/plugin-sdk/app", () => ({
  useSdk: () => sdk,
  experimental_useProviders: () => ({ providers: [] }),
  experimental_ProviderIcon: () => null,
}));
vi.mock("../model/use-sidebar-data.js", () => ({
  useSidebarProjectName: () => "Project",
}));

const thread = toSidebarThread(
  makeSidebarThread({
    id: "hover-thread",
    title: "Hover detail title",
    displayTitle: "Hover detail title",
  }),
);

function Row({
  suppressed = false,
  draggable = false,
}: {
  suppressed?: boolean;
  draggable?: boolean;
}) {
  return (
    <ThreadHoverCard thread={thread} suppressed={suppressed}>
      <div data-testid="row" role={draggable ? "button" : undefined}>
        <a href="/thread">Open thread</a>
        <button type="button">Thread actions</button>
      </div>
    </ThreadHoverCard>
  );
}

async function advance(ms = 500) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("ThreadHoverCard menu suppression", () => {
  it("allows the row link to open details when the draggable row has button semantics", async () => {
    render(<Row draggable />);
    fireEvent.focus(screen.getByRole("link", { name: "Open thread" }));
    await advance();
    expect(screen.getByText("Hover detail title")).toBeTruthy();
  });

  it("does not revive an open card when menu suppression ends", async () => {
    const { rerender } = render(<Row />);
    fireEvent.pointerEnter(screen.getByTestId("row"), { pointerType: "mouse" });
    await advance();
    expect(screen.getByText("Hover detail title")).toBeTruthy();
    rerender(<Row suppressed />);
    await advance();
    expect(screen.queryByText("Hover detail title")).toBeNull();
    rerender(<Row />);
    await advance();
    expect(screen.queryByText("Hover detail title")).toBeNull();
    fireEvent.pointerLeave(screen.getByTestId("row"), { pointerType: "mouse" });
    fireEvent.pointerEnter(screen.getByTestId("row"), { pointerType: "mouse" });
    await advance();
    expect(screen.getByText("Hover detail title")).toBeTruthy();
  });

  it("ignores menu-button focus restored after selecting a menu action", async () => {
    const { rerender } = render(<Row suppressed />);
    rerender(<Row />);
    fireEvent.focus(screen.getByRole("button", { name: "Thread actions" }));
    await advance();
    expect(screen.queryByText("Hover detail title")).toBeNull();
    fireEvent.focus(screen.getByRole("link", { name: "Open thread" }));
    await advance();
    expect(screen.getByText("Hover detail title")).toBeTruthy();
  });

  it("discards a pending hover timer across a quickly opened and closed menu", async () => {
    const { rerender } = render(<Row />);
    fireEvent.pointerEnter(screen.getByTestId("row"), { pointerType: "mouse" });
    await advance(100);
    rerender(<Row suppressed />);
    rerender(<Row />);
    await advance();
    expect(screen.queryByText("Hover detail title")).toBeNull();
  });
});
