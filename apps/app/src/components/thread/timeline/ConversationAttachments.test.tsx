// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MarkdownLocalFileContextMenuContext,
  type MarkdownLocalFileContextMenuItem,
} from "@/components/ui/markdown-link-routing";
import { ConversationAttachments } from "./ConversationAttachments";

describe("ConversationAttachments", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("opens the preview on click and offers the shared file menu on right click", () => {
    const onOpenLocalFileLink = vi.fn();
    const download = vi.fn();
    const getItems = vi.fn((): MarkdownLocalFileContextMenuItem[] => [
      { id: "download", label: "Download", onSelect: download },
      { id: "copy-path", label: "Copy file path", onSelect: vi.fn() },
    ]);
    render(
      <MarkdownLocalFileContextMenuContext.Provider value={getItems}>
        <ConversationAttachments
          filePaths={["/Users/me/Reports/Q3 plan.pdf"]}
          imageItems={[]}
          onOpenLocalFileLink={onOpenLocalFileLink}
        />
      </MarkdownLocalFileContextMenuContext.Provider>,
    );

    const chip = screen.getByRole("button", { name: "Q3 plan.pdf" });
    fireEvent.click(chip);
    expect(onOpenLocalFileLink).toHaveBeenCalledWith({
      lineRange: null,
      path: "/Users/me/Reports/Q3 plan.pdf",
    });

    fireEvent.contextMenu(chip);
    expect(getItems).toHaveBeenCalledWith({
      lineRange: null,
      path: "/Users/me/Reports/Q3 plan.pdf",
    });
    expect(
      screen.getAllByRole("menuitem").map((item) => item.textContent),
    ).toEqual(["Open preview", "Download", "Copy file path"]);

    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));
    expect(download).toHaveBeenCalledTimes(1);

    fireEvent.contextMenu(chip);
    fireEvent.click(screen.getByRole("menuitem", { name: "Open preview" }));
    expect(onOpenLocalFileLink).toHaveBeenCalledTimes(2);
  });

  it("downloads project attachments from their content url", () => {
    const clicked: HTMLAnchorElement[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
      function (this: HTMLAnchorElement) {
        clicked.push(this);
      },
    );
    render(
      <ConversationAttachments
        filePaths={["uploads/brief.docx"]}
        imageItems={[]}
        projectId="prj_1"
      />,
    );

    fireEvent.contextMenu(screen.getByRole("link", { name: "brief.docx" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Download" }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]?.download).toBe("brief.docx");
    expect(clicked[0]?.getAttribute("href")).toContain(
      "/api/v1/projects/prj_1/attachments/content",
    );
  });
});
