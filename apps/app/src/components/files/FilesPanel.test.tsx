// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { environmentQueryKey } from "@/hooks/queries/query-keys";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import type { FileEntry } from "./file-paths";
import { FilesPanel } from "./FilesPanel";
import { FilesTransportContext, type FilesTransport } from "./files-transport";

const environment = vi.hoisted(() => ({ path: "/repo" }));

vi.mock("@/lib/sdk", () => ({
  sdk: {
    environments: {
      get: vi.fn(async () => ({
        id: "env-1",
        hostId: "host-1",
        path: environment.path,
      })),
    },
  },
}));

vi.mock("@/hooks/useRealtimeSubscription", () => ({
  useEnvironmentDetailRealtimeSubscription: () => undefined,
}));

const LISTINGS: Record<string, FileEntry[]> = {
  "": [
    { name: ".github", kind: "directory", relativePath: ".github" },
    { name: "src", kind: "directory", relativePath: "src" },
    { name: ".env", kind: "file", relativePath: ".env" },
    { name: "README.md", kind: "file", relativePath: "README.md" },
  ],
  src: [{ name: "app.ts", kind: "file", relativePath: "src/app.ts" }],
};

function transport(): FilesTransport {
  return {
    read: vi.fn(),
    readIfChanged: vi.fn(),
    write: vi.fn(),
    remove: vi.fn(),
    listDirectory: vi.fn(async (_directory, path) => LISTINGS[path] ?? []),
    search: vi.fn(async () => [
      { name: "app.ts", kind: "file" as const, relativePath: "src/app.ts" },
    ]),
    isMissing: () => false,
    isTooLarge: () => false,
  };
}

function renderPanel(
  files: FilesTransport,
  onOpenFile = vi.fn(),
  rootPath = "/repo",
) {
  environment.path = rootPath;
  const { queryClient, wrapper: Wrapper } = createQueryClientTestHarness();
  queryClient.setQueryData(environmentQueryKey("env-1"), {
    id: "env-1",
    hostId: "host-1",
    path: rootPath,
  });
  const view = render(
    <Wrapper>
      <FilesTransportContext.Provider value={files}>
        <FilesPanel environmentId="env-1" isActive onOpenFile={onOpenFile} />
      </FilesTransportContext.Provider>
    </Wrapper>,
  );
  return Object.assign(onOpenFile, { unmount: view.unmount });
}

describe("FilesPanel", () => {
  afterEach(() => cleanup());

  it("lists dotfiles, expands folders, and opens files", async () => {
    const files = transport();
    const onOpenFile = renderPanel(files);
    expect(await screen.findByRole("button", { name: ".github" })).toBeTruthy();
    expect(screen.getByRole("button", { name: ".env" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "src" }));
    fireEvent.click(await screen.findByRole("button", { name: "app.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
    expect(files.listDirectory).toHaveBeenCalledWith(
      { hostId: "host-1", rootPath: "/repo" },
      "src",
      expect.anything(),
    );
  });

  it("searches the workspace and opens a hit", async () => {
    const files = transport();
    const onOpenFile = renderPanel(files);
    fireEvent.change(await screen.findByRole("searchbox"), {
      target: { value: "app" },
    });
    fireEvent.click(await screen.findByRole("button", { name: "src/app.ts" }));
    expect(onOpenFile).toHaveBeenCalledWith("src/app.ts");
    expect(files.search).toHaveBeenCalledWith(
      { hostId: "host-1", rootPath: "/repo" },
      "app",
      expect.anything(),
    );
  });

  it("shows the searching, empty, and failed search states in the dashed panel", async () => {
    const files = transport();
    vi.mocked(files.search)
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("Search backend offline"));
    renderPanel(files);
    const searchbox = await screen.findByRole("searchbox");
    fireEvent.change(searchbox, { target: { value: "nothing" } });
    expect(await screen.findByText("Searching files...")).toBeTruthy();
    expect(
      await screen.findByText("No results match your search."),
    ).toBeTruthy();
    fireEvent.change(searchbox, { target: { value: "broken" } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Search backend offline");
    expect(screen.queryByText("No results match your search.")).toBeNull();
  });

  it("restores expanded folders and refreshes them when the tab mounts again", async () => {
    const files = transport();
    const first = renderPanel(files, vi.fn(), "/restored");
    fireEvent.click(await screen.findByRole("button", { name: "src" }));
    expect(await screen.findByRole("button", { name: "app.ts" })).toBeTruthy();
    first.unmount();
    vi.mocked(files.listDirectory).mockClear();
    renderPanel(files, vi.fn(), "/restored");
    expect(screen.getByRole("button", { name: "app.ts" })).toBeTruthy();
    await waitFor(() =>
      expect(files.listDirectory).toHaveBeenCalledWith(
        { hostId: "host-1", rootPath: "/restored" },
        "src",
        expect.anything(),
      ),
    );
  });
});
