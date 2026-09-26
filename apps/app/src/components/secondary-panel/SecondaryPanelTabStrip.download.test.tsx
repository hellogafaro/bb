// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SecondaryPanelTabStrip,
  type SecondaryPanelTabStripProps,
} from "./SecondaryPanelTabStrip";

function makeTab(
  label: string,
  downloadUrl: string | null,
): SecondaryPanelTabStripProps["tabs"][number] {
  return {
    downloadUrl,
    label,
    leadingVisual: null,
    statusLabel: null,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    renderContent: () => null,
    tab: { id: label, kind: "new-tab" as const },
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("SecondaryPanelTabStrip file tab menu", () => {
  it("downloads a file tab from its context menu and hides Download for other tabs", () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push(this);
      },
    );
    render(
      <SecondaryPanelTabStrip
        activeTabId="report.pdf"
        isPanelOpen
        onReorderTab={vi.fn()}
        tabs={[
          makeTab(
            "report.pdf",
            "/api/v1/threads/t/worktree/files/report.pdf?download=1",
          ),
          makeTab("New tab", null),
        ]}
        usesDesktopChrome={false}
      />,
    );

    fireEvent.contextMenu(screen.getByText("report.pdf"));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(clicked[0]?.getAttribute("href")).toBe(
      "/api/v1/threads/t/worktree/files/report.pdf?download=1",
    );
    expect(clicked[0]?.download).toBe("report.pdf");

    fireEvent.contextMenu(screen.getByText("New tab"));
    expect(screen.queryByRole("menuitem", { name: "Download" })).toBeNull();
  });
});
