// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FileReadResult } from "@bb/sdk/browser";
import { TooltipProvider } from "@bb/shared-ui/tooltip";
import { TEXT_FILE_PREVIEW_MAX_BYTES } from "@bb/client-core";
import { appToast } from "@/components/ui/app-toast";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  FileDocumentStore,
  FileDocumentStoreContext,
  type PollTiming,
} from "./file-document-store";
import { FileEditor } from "./FileEditor";
import { FilesTransportContext, type FilesTransport } from "./files-transport";
import { FILES_COPY } from "./files-copy";

vi.mock("@/lib/plugin-code-theme", () => ({
  useCodeTheme: () => ({ mode: "dark", name: "test", theme: null }),
}));

const PATH = "/repo/src/app.ts";

class MissingError extends Error {}
class TooLargeError extends Error {}

const LEASE_BASE_URL = "/api/v1/file-previews/lease-1";

function recordDownloads(order: string[] = []): string[] {
  vi.spyOn(sdk.files, "createPreview").mockResolvedValue({
    baseUrl: LEASE_BASE_URL,
    expiresAtMs: Date.now() + 60_000,
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(
    function (this: HTMLAnchorElement) {
      order.push(`download:${this.getAttribute("href")}`);
    },
  );
  return order;
}

function openFileActions() {
  fireEvent.pointerDown(
    screen.getByRole("button", { name: FILES_COPY.fileActions }),
    { button: 0, ctrlKey: false },
  );
}

class ImmediateIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

function readResult(content: string, sha256: string): FileReadResult {
  return {
    path: PATH,
    content,
    contentEncoding: "utf8",
    sizeBytes: content.length,
    sha256,
  };
}

function fakeDisk(content: string, sha256: string) {
  const disk: { current: { content: string; sha256: string } | null } = {
    current: { content, sha256 },
  };
  const transport: FilesTransport = {
    read: vi.fn(async () => {
      if (disk.current === null) throw new MissingError("gone");
      return readResult(disk.current.content, disk.current.sha256);
    }),
    readIfChanged: vi.fn(async (_location, sha) => {
      if (disk.current === null) throw new MissingError("gone");
      if (disk.current.sha256 === sha) {
        const { content: _content, ...metadata } = readResult("", sha);
        return { ...metadata, notModified: true as const };
      }
      return readResult(disk.current.content, disk.current.sha256);
    }),
    write: vi.fn(async (_location, next, expectedSha256) => {
      const current = disk.current?.sha256 ?? null;
      if (expectedSha256 !== current) {
        return { outcome: "conflict" as const, currentSha256: current };
      }
      disk.current = { content: next, sha256: `sha:${next}` };
      return {
        outcome: "written" as const,
        sha256: `sha:${next}`,
        sizeBytes: next.length,
      };
    }),
    remove: vi.fn(async () => {
      disk.current = null;
    }),
    listDirectory: vi.fn(async () => []),
    search: vi.fn(async () => []),
    isMissing: (error) => error instanceof MissingError,
    isTooLarge: (error) => error instanceof TooLargeError,
  };
  return { disk, transport };
}

function timing(ms: number): PollTiming {
  return { fastMs: ms, slowMs: ms, recentChangeMs: 0 };
}

function editorTree(
  transport: FilesTransport,
  store: FileDocumentStore,
  tabs = 1,
  path = PATH,
  htmlPreviewUrl: string | null = null,
) {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return (
    <Wrapper>
      <TooltipProvider>
        <FilesTransportContext.Provider value={transport}>
          <FileDocumentStoreContext.Provider value={store}>
            {Array.from({ length: tabs }, (_, index) => (
              <FileEditor
                key={index}
                source={{ kind: "host", hostId: "host-1", path }}
                displayPath={path}
                copyPath={path}
                lineRange={null}
                isPanelOpen
                htmlPreviewUrl={htmlPreviewUrl}
              />
            ))}
          </FileDocumentStoreContext.Provider>
        </FilesTransportContext.Provider>
      </TooltipProvider>
    </Wrapper>
  );
}

function renderEditor(
  transport: FilesTransport,
  store: FileDocumentStore,
  tabs = 1,
) {
  return render(editorTree(transport, store, tabs));
}

async function editorViews(count: number): Promise<EditorView[]> {
  const nodes = await waitFor(() => {
    const found = [...document.querySelectorAll<HTMLElement>(".cm-content")];
    if (found.length < count) throw new Error("editors not mounted");
    return found;
  });
  return nodes.map((node) => {
    const view = EditorView.findFromDOM(node);
    if (view === null) throw new Error("no editor view");
    return view;
  });
}

async function editorView(): Promise<EditorView> {
  const content = await waitFor(() => {
    const node = document.querySelector<HTMLElement>(".cm-content");
    if (node === null) throw new Error("editor not mounted");
    return node;
  });
  const view = EditorView.findFromDOM(content);
  if (view === null) throw new Error("no editor view");
  return view;
}

function type(view: EditorView, text: string) {
  act(() => {
    view.dispatch({
      changes: { from: view.state.doc.length, insert: text },
    });
  });
}

describe("FileEditor", () => {
  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", ImmediateIntersectionObserver);
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("shows the too-large card with Download when the read is rejected for size", async () => {
    const { transport } = fakeDisk("", "s1");
    transport.read = vi.fn(async () => {
      throw new TooLargeError("File is too large");
    });
    const downloads = recordDownloads();
    const probe = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe(`${LEASE_BASE_URL}/app.ts`);
      expect(new Headers(init?.headers).get("range")).toBe("bytes=0-0");
      return new Response(null, {
        status: 206,
        headers: {
          "content-range": "bytes 0-0/31457280",
          "content-type": "text/plain; charset=utf-8",
        },
      });
    });
    vi.stubGlobal("fetch", probe);
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);

    expect(
      await screen.findByText("This file is too large to preview."),
    ).toBeTruthy();
    expect(await screen.findByText("text/plain · 30 MB")).toBeTruthy();
    expect(probe).toHaveBeenCalledTimes(1);
    expect(document.querySelector(".cm-content")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: FILES_COPY.download }));
    await waitFor(() =>
      expect(downloads).toEqual([`download:${LEASE_BASE_URL}/app.ts`]),
    );
  });

  it("shows the too-large card instead of the editor for text over the preview budget", async () => {
    const { transport } = fakeDisk("x", "s1");
    transport.read = vi.fn(async () => ({
      ...readResult("x", "s1"),
      mimeType: "text/plain",
      sizeBytes: TEXT_FILE_PREVIEW_MAX_BYTES + 1,
    }));
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);

    expect(
      await screen.findByText("This file is too large to preview."),
    ).toBeTruthy();
    expect(screen.getByText("text/plain · 10 MB")).toBeTruthy();
    expect(document.querySelector(".cm-content")).toBeNull();
  });

  it("saves unsaved edits before downloading the file", async () => {
    const { disk, transport } = fakeDisk("draft", "s1");
    const order = recordDownloads();
    const write = transport.write;
    transport.write = vi.fn(async (...args: Parameters<typeof write>) => {
      order.push(`write:${args[1]}`);
      return write(...args);
    });
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, " edited");

    openFileActions();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: FILES_COPY.download }),
    );

    await waitFor(() =>
      expect(order).toEqual([
        "write:draft edited",
        `download:${LEASE_BASE_URL}/app.ts`,
      ]),
    );
    expect(disk.current?.content).toBe("draft edited");
  });

  it("does not download stale bytes when saving the unsaved edits fails", async () => {
    const { transport } = fakeDisk("draft", "s1");
    const downloads = recordDownloads();
    const toastError = vi.spyOn(appToast, "error");
    transport.write = vi.fn(async () => {
      throw new Error("disk full");
    });
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, " edited");

    openFileActions();
    fireEvent.click(
      await screen.findByRole("menuitem", { name: FILES_COPY.download }),
    );

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(FILES_COPY.downloadFailed),
    );
    expect(transport.write).toHaveBeenCalledTimes(1);
    expect(downloads).toEqual([]);
  });

  it("saves edits with the sha of the file it loaded", async () => {
    const { disk, transport } = fakeDisk("const a = 1;", "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, "\n");
    act(() => view.contentDOM.focus());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
    });
    await waitFor(() => expect(disk.current?.content).toBe("const a = 1;\n"));
    expect(transport.write).toHaveBeenCalledWith(
      expect.anything(),
      "const a = 1;\n",
      "s1",
    );
  });

  it("offers Overwrite when the file changes on disk under unsaved edits", async () => {
    const { disk, transport } = fakeDisk("one", "s1");
    const store = new FileDocumentStore(transport, timing(20));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, " mine");
    disk.current = { content: "theirs", sha256: "s2" };
    const overwrite = await screen.findByRole("button", {
      name: FILES_COPY.overwrite,
    });
    expect(screen.getByRole("alert").textContent).toContain(
      FILES_COPY.diskConflict,
    );
    act(() => overwrite.click());
    await waitFor(() => expect(disk.current?.content).toBe("one mine"));
    expect(transport.write).toHaveBeenLastCalledWith(
      expect.anything(),
      "one mine",
      "s2",
    );
  });

  it("reloads a clean buffer when the file changes on disk", async () => {
    const { disk, transport } = fakeDisk("one", "s1");
    const store = new FileDocumentStore(transport, timing(20));
    renderEditor(transport, store);
    const view = await editorView();
    disk.current = { content: "two", sha256: "s2" };
    await waitFor(() => expect(view.state.doc.toString()).toBe("two"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recreates a deleted file from the unsaved buffer", async () => {
    const { disk, transport } = fakeDisk("keep", "s1");
    const store = new FileDocumentStore(transport, timing(20));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, " me");
    disk.current = null;
    const recreate = await screen.findByRole("button", {
      name: FILES_COPY.recreate,
    });
    act(() => recreate.click());
    await waitFor(() => expect(disk.current?.content).toBe("keep me"));
    expect(transport.write).toHaveBeenLastCalledWith(
      expect.anything(),
      "keep me",
      null,
    );
  });

  it("saves unsaved edits when the tab closes", async () => {
    const { disk, transport } = fakeDisk("draft", "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    const { unmount } = renderEditor(transport, store);
    const view = await editorView();
    type(view, " done");
    unmount();
    await waitFor(() => expect(disk.current?.content).toBe("draft done"));
  });

  it("autosaves five seconds after the last edit", async () => {
    const { disk, transport } = fakeDisk("draft", "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store);
    const view = await editorView();
    vi.useFakeTimers();
    try {
      type(view, " one");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_000);
      });
      type(view, " two");
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4_999);
      });
      expect(transport.write).not.toHaveBeenCalled();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(disk.current?.content).toBe("draft one two");
    } finally {
      vi.useRealTimers();
    }
  });

  it("disables Reload and Overwrite while a write is in flight", async () => {
    const { disk, transport } = fakeDisk("one", "s1");
    const store = new FileDocumentStore(transport, timing(20));
    renderEditor(transport, store);
    const view = await editorView();
    type(view, " mine");
    disk.current = { content: "theirs", sha256: "s2" };
    const overwrite = await screen.findByRole("button", {
      name: FILES_COPY.overwrite,
    });
    let release: () => void = () => undefined;
    const write = transport.write;
    vi.mocked(transport.write).mockImplementationOnce(
      (...args) =>
        new Promise((resolve) => {
          release = () => resolve(write(...args));
        }),
    );
    act(() => overwrite.click());
    type(view, " more");
    disk.current = { content: "third", sha256: "s3" };
    const reload = await screen.findByRole("button", {
      name: FILES_COPY.reload,
    });
    expect(reload.hasAttribute("disabled")).toBe(true);
    expect(
      screen
        .getByRole("button", { name: FILES_COPY.overwrite })
        .hasAttribute("disabled"),
    ).toBe(true);
    await act(async () => release());
    await waitFor(() => expect(reload.hasAttribute("disabled")).toBe(false));
  });

  it("shares one read between two tabs and keeps both in sync after a save", async () => {
    const { disk, transport } = fakeDisk("same", "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    renderEditor(transport, store, 2);
    const [first, second] = await editorViews(2);
    if (first === undefined || second === undefined) throw new Error("tabs");
    expect(transport.read).toHaveBeenCalledTimes(1);
    type(first, "!");
    act(() => first.contentDOM.focus());
    act(() => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "s", ctrlKey: true }),
      );
    });
    await waitFor(() => expect(disk.current?.content).toBe("same!"));
    await waitFor(() => expect(second.state.doc.toString()).toBe("same!"));
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("keeps unsaved edits across a close when the file changed on disk", async () => {
    const { disk, transport } = fakeDisk("base", "s1");
    const store = new FileDocumentStore(transport, timing(20));
    const { unmount } = renderEditor(transport, store);
    const view = await editorView();
    type(view, " mine");
    disk.current = { content: "theirs", sha256: "s2" };
    await screen.findByRole("button", { name: FILES_COPY.overwrite });
    unmount();
    expect(transport.write).not.toHaveBeenCalled();
    renderEditor(transport, store);
    const reopened = await editorView();
    await waitFor(() =>
      expect(reopened.state.doc.toString()).toBe("base mine"),
    );
    expect(
      await screen.findByRole("button", { name: FILES_COPY.overwrite }),
    ).toBeTruthy();
    expect(disk.current?.content).toBe("theirs");
  });

  it("toggles a clean Markdown file between views without marking it dirty", async () => {
    const source = "# Title\n\n* item\n";
    const { transport } = fakeDisk(source, "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    render(editorTree(transport, store, 1, "/repo/README.md"));
    await waitFor(() =>
      expect(document.querySelector(".ProseMirror h1")).not.toBeNull(),
    );
    act(() => screen.getByRole("button", { name: FILES_COPY.source }).click());
    const view = await editorView();
    expect(view.state.doc.toString()).toBe(source);
    act(() => screen.getByRole("button", { name: FILES_COPY.source }).click());
    await waitFor(() =>
      expect(document.querySelector(".ProseMirror h1")).not.toBeNull(),
    );
    expect(screen.queryByLabelText(FILES_COPY.unsaved)).toBeNull();
  });

  it("renders the HTML file header the same as Markdown: file icon, path, Code toggle, and file actions, no Preview/Raw control", async () => {
    const { transport } = fakeDisk("<h1>Hi</h1>", "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    render(
      editorTree(
        transport,
        store,
        1,
        "/repo/index.html",
        "https://example.test/preview/index.html",
      ),
    );

    const codeToggle = await screen.findByRole("button", {
      name: FILES_COPY.source,
    });
    expect(codeToggle.getAttribute("aria-pressed")).toBe("false");
    expect(
      screen.getByRole("button", { name: FILES_COPY.fileActions }),
    ).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText("Preview")).toBeNull();
    expect(screen.queryByText("Raw")).toBeNull();

    const iframe = document.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toBe(
      "https://example.test/preview/index.html",
    );
    expect(iframe?.getAttribute("sandbox")).toBe("allow-scripts");
    expect(document.querySelector(".cm-content")).toBeNull();

    openFileActions();
    expect(
      screen.queryByRole("menuitem", { name: FILES_COPY.openInEditor }),
    ).toBeNull();
    expect(
      screen.getByRole("menuitem", { name: FILES_COPY.copyContents }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: FILES_COPY.download }),
    ).toBeTruthy();
  });

  it("toggles a clean HTML file between the rendered preview and source without marking it dirty", async () => {
    const source = "<h1>Hi</h1>";
    const { transport } = fakeDisk(source, "s1");
    const store = new FileDocumentStore(transport, timing(60_000));
    render(
      editorTree(
        transport,
        store,
        1,
        "/repo/index.html",
        "https://example.test/preview/index.html",
      ),
    );
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());

    act(() => screen.getByRole("button", { name: FILES_COPY.source }).click());
    const view = await editorView();
    expect(view.state.doc.toString()).toBe(source);
    expect(document.querySelector("iframe")).toBeNull();

    act(() => screen.getByRole("button", { name: FILES_COPY.source }).click());
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    expect(screen.queryByLabelText(FILES_COPY.unsaved)).toBeNull();
  });
});
