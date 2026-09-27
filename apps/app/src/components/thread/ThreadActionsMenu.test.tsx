// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@bb/shared-ui/hooks/use-compact-viewport";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "./ThreadActionsMenu";
import { useSidebarRename } from "../sidebar/SidebarInlineRename";

const copyToClipboardWithToast = vi.hoisted(() => vi.fn());
const threadActions = vi.hoisted(() => ({
  requestArchive: vi.fn(),
  requestDelete: vi.fn(),
  generateTitle: vi.fn(),
  isGenerating: vi.fn(() => false),
  requestRename: vi.fn(),
  togglePin: vi.fn(),
  toggleRead: vi.fn(),
  unarchiveThread: vi.fn(),
}));

vi.mock("@/lib/clipboard", () => ({
  copyToClipboardWithToast,
}));

vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    ...threadActions,
    generatingTitleIds: new Set(
      threadActions.isGenerating() ? ["thread-1"] : [],
    ),
    renameThread: vi.fn(),
  }),
}));

const thread = makeThreadListEntry({
  id: "thread-1",
  pinnedAt: null,
  sectionId: "sec_planning",
  title: "Move me",
});

function renderWide(children: ReactNode) {
  return render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      {children}
    </CompactViewportOverrideProvider>,
  );
}

function renderCompact(children: ReactNode) {
  return render(
    <CompactViewportOverrideProvider isCompactViewport>
      {children}
    </CompactViewportOverrideProvider>,
  );
}

function InlineRenameMenuHarness({ context = false }: { context?: boolean }) {
  const rename = useSidebarRename({
    kind: "thread",
    id: thread.id,
    name: thread.title ?? "Thread",
    label: "Thread name",
    onSave: async () => {},
  });
  const row = (
    <div data-sidebar-rename-row="" data-testid="thread-row">
      <button type="button" data-sidebar-rename-anchor="">
        Open thread
      </button>
      {rename.editor ?? <span>{thread.title}</span>}
      {!context && (
        <ThreadActionsMenu
          thread={thread}
          onRename={rename.startEditingFromMenu}
          onCloseAutoFocus={rename.onCloseAutoFocus}
        />
      )}
    </div>
  );
  return context ? (
    <ThreadActionsContextMenu
      thread={thread}
      onRename={rename.startEditingFromMenu}
      onCloseAutoFocus={rename.onCloseAutoFocus}
      disabled={rename.isEditing}
    >
      {row}
    </ThreadActionsContextMenu>
  ) : (
    row
  );
}

afterEach(() => {
  cleanup();
  copyToClipboardWithToast.mockReset();
  for (const action of Object.values(threadActions)) {
    action.mockReset();
  }
});

describe("ThreadActionsMenu", () => {
  it.each([false, true])(
    "generates a title from the shared menu (compact: %s)",
    async (compact) => {
      (compact ? renderCompact : renderWide)(
        <ThreadActionsMenu thread={thread} />,
      );
      const trigger = screen.getByRole("button", { name: "Thread actions" });
      if (compact) fireEvent.click(trigger);
      else fireEvent.pointerDown(trigger, { button: 0 });
      const generate = await screen.findByRole("menuitem", {
        name: "Regenerate title",
      });
      expect(generate.querySelector('[data-icon="RotateCcw"]')).not.toBeNull();
      expect(screen.getAllByRole("menuitem").indexOf(generate)).toBe(
        screen
          .getAllByRole("menuitem")
          .indexOf(screen.getByRole("menuitem", { name: "Rename" })) + 1,
      );
      fireEvent.click(generate);
      expect(threadActions.generateTitle).toHaveBeenCalledWith(thread.id);
    },
  );

  it("disables title generation while this thread has a pending request", async () => {
    threadActions.isGenerating.mockReturnValue(true);
    renderWide(<ThreadActionsMenu thread={thread} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    const generate = await screen.findByRole("menuitem", {
      name: "Generating title…",
    });
    expect(generate.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(generate);
    expect(threadActions.generateTitle).not.toHaveBeenCalled();
  });

  it("keeps the existing rename dialog for callers without an inline override", async () => {
    renderWide(<ThreadActionsMenu thread={thread} />);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );

    fireEvent.click(screen.getByRole("menuitem", { name: "Rename" }));

    await waitFor(() => {
      expect(threadActions.requestRename).toHaveBeenCalledWith(thread);
    });
  });

  it.each([
    { compact: false, context: false },
    { compact: false, context: true },
    { compact: true, context: false },
    { compact: true, context: true },
  ])(
    "hands focus to inline rename ($compact, $context)",
    async ({ compact, context }) => {
      (compact ? renderCompact : renderWide)(
        <InlineRenameMenuHarness context={context} />,
      );
      if (context) {
        fireEvent.contextMenu(screen.getByTestId("thread-row"));
      } else {
        const trigger = screen.getByRole("button", { name: "Thread actions" });
        if (compact) fireEvent.click(trigger);
        else fireEvent.pointerDown(trigger, { button: 0 });
      }
      const item = await screen.findByRole("menuitem", { name: "Rename" });
      if (compact) fireEvent.click(item);
      else fireEvent.keyDown(item, { key: "Enter" });
      const input = await screen.findByRole("textbox", { name: "Thread name" });
      await waitFor(() => expect(document.activeElement).toBe(input));
      expect(input).toHaveProperty("value", "Move me");
      expect(threadActions.requestRename).not.toHaveBeenCalled();
    },
  );

  it("copies the canonical thread URL from every menu instance", () => {
    renderWide(<ThreadActionsMenu thread={thread} />);

    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Thread actions" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Copy thread link" }));

    expect(copyToClipboardWithToast).toHaveBeenCalledWith(
      `${window.location.origin}/projects/${thread.projectId}/threads/${thread.id}`,
      {
        successMessage: "Thread link copied",
        errorMessage: "Failed to copy thread link",
      },
    );
  });
});
